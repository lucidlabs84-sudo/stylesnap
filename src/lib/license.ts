/**
 * License Manager — StyleSnap
 * Pro only ($29 one-time). No free tier.
 *
 * Uses DodoPayments License Key system via secure proxy API.
 * Flow: checkout → payment → license key returned → activate on device → validate periodically
 * Proxy: https://api.lucidlibs.dev
 */
import type { LicenseStatus, UserSettings } from '@/shared/types'
import { DEFAULT_SETTINGS } from '@/shared/types'
import { STORAGE_KEYS, PROXY_BASE_URL } from '@/shared/constants'
import { showError } from './notifications'

/**
 * Wrapper around fetch() for the license API.
 *
 * When called from the content script, a direct fetch() is subject to the host
 * page's CSP (connect-src), which silently blocks our API on strict-CSP sites
 * and breaks activation. So in a content-script context we relay the request
 * through the background service worker (host_permissions, no page CSP) and
 * rebuild a Response from its reply. In the service worker we fetch directly.
 */
export async function proxyFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const inContentScript = typeof window !== 'undefined' && typeof document !== 'undefined'
  if (inContentScript && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'SS_PROXY_FETCH', url, options })
      if (reply && typeof reply.status === 'number') {
        return new Response(reply.body ?? '', { status: reply.status })
      }
      throw new Error(reply?.error || 'No response from background')
    } catch (e) {
      // Fall back to a direct fetch (e.g. background unavailable in dev/demo).
      return fetch(url, { ...options, headers: { ...(options.headers || {}) } })
    }
  }
  return fetch(url, { ...options, headers: { ...(options.headers || {}) } })
}

// ─── Device fingerprint ─────────────────────────────────────────────────────

/** Generate a stable device name from browser info */
function getDeviceName(): string {
  const ua = navigator.userAgent
  const platform = navigator.platform || 'Unknown'
  // Extract OS
  if (ua.includes('Windows')) return `Windows-${platform}`
  if (ua.includes('Mac OS')) return `macOS-${platform}`
  if (ua.includes('Linux')) return `Linux-${platform}`
  return `Device-${platform.slice(0, 20)}`
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getLicenseStatus(): Promise<LicenseStatus> {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.LICENSE,
  ])

  const stored = data[STORAGE_KEYS.LICENSE] as Partial<LicenseStatus> | undefined

  if (stored?.isPro) {
    return {
      isPro:              true,
      email:              stored.email,
      licenseKey:         stored.licenseKey,
      instanceId:         stored.instanceId,
      licenseKeyId:       stored.licenseKeyId,
      customerName:       stored.customerName,
      productName:        stored.productName,
      activationsUsed:    stored.activationsUsed,
      activationsLimit:   stored.activationsLimit,
      licenseStatus:      stored.licenseStatus,
      expiresAt:          stored.expiresAt,
      activatedAt:        stored.activatedAt,
    }
  }

  return { isPro: false }
}

// ─── Checkout (DodoPayments via Proxy) ───────────────────────────────────────

/**
 * Creates a DodoPayments checkout session via our secure proxy.
 * After payment, the return_url will include ?license_key=xxx&email=xxx
 * Returns the hosted checkout URL for the user to complete payment.
 */
export async function createCheckout(email?: string): Promise<string> {
  const res = await proxyFetch(`${PROXY_BASE_URL}/api/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email?.trim() || undefined,
      return_url: 'https://lucidlibs.dev/stylesnap/success',
      cancel_url: 'https://lucidlibs.dev/stylesnap',
    }),
  })

  const data = await res.json()
  if (data.error) {
    throw new Error(data.error)
  }

  return data.checkout_url
}

// ─── License Key Activation (DodoPayments via Proxy) ─────────────────────────

/**
 * Activates a License Key on this device.
 * Creates an activation instance via DodoPayments POST /licenses/activate.
 * DodoPayments returns: { id (instance_id), customer: { email, name }, product: { name, product_id }, created_at }
 * Returns true if activation succeeded.
 */
export async function activateLicenseKey(licenseKey: string): Promise<{
  success: boolean
  error?: string
  limitReached?: boolean
}> {
  const key = licenseKey.trim()
  if (!key) return { success: false, error: 'License key is required.' }

  try {
    const deviceName = getDeviceName()
    const res = await proxyFetch(`${PROXY_BASE_URL}/api/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key: key,
        device_name: deviceName,
      }),
    })
    const data = await res.json()

    if (!data.activated) {
      return {
        success: false,
        error: data.error || 'Activation failed.',
        limitReached: data.limit_reached === true,
      }
    }

    // Store license with full activation info from DodoPayments
    const payload: Partial<LicenseStatus> = {
      isPro:            true,
      licenseKey:       key,
      instanceId:       data.instance_id,
      email:            data.customer_email || '',
      customerName:     data.customer_name || '',
      productName:      data.product_name || '',
      activatedAt:      data.created_at || new Date().toISOString(),
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.LICENSE]: payload })
    // A successful activation is itself a successful server interaction, so seed
    // the validation timestamp. Otherwise the first background validation with
    // no prior timestamp would, on any transient network error, return invalid
    // and wipe the license we just stored.
    await chrome.storage.local.set({
      stylesnap_last_validated_at: Date.now(),
      stylesnap_offline_fail_count: 0,
    })
    return { success: true }

  } catch (err) {
    return { success: false, error: 'Activation service unavailable.' }
  }
}

/**
 * Validates a License Key via DodoPayments POST /licenses/validate.
 * Optionally passes instance_id for instance-specific validation.
 * Used for periodic checks (e.g., every 24h or on startup).
 * DodoPayments returns: { valid: boolean }
 */
export async function validateLicense(licenseKey: string, instanceId?: string): Promise<{
  valid: boolean
}> {
  try {
    const body: Record<string, string> = { license_key: licenseKey.trim() }
    if (instanceId) {
      body.instance_id = instanceId
    }

    const res = await proxyFetch(`${PROXY_BASE_URL}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()

    if (data.valid) {
      // Refresh stored license data and record successful validation timestamp
      const current = await getLicenseStatus()
      const payload: Partial<LicenseStatus> = {
        ...current,
      }
      await chrome.storage.local.set({ [STORAGE_KEYS.LICENSE]: payload })
      await chrome.storage.local.set({
        stylesnap_last_validated_at: Date.now(),
        stylesnap_offline_fail_count: 0,
      })
    }

    return {
      valid: data.valid === true,
    }
  } catch {
    // Network error — allow a 7-day grace period since last successful validation
    const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000
    const stored = await chrome.storage.local.get([
      'stylesnap_last_validated_at',
      'stylesnap_offline_fail_count',
    ])
    const lastValidatedAt = stored['stylesnap_last_validated_at'] as number | undefined
    const failCount = (stored['stylesnap_offline_fail_count'] as number | undefined) ?? 0

    await chrome.storage.local.set({ stylesnap_offline_fail_count: failCount + 1 })

    if (lastValidatedAt && (Date.now() - lastValidatedAt) < GRACE_PERIOD_MS) {
      return { valid: true }
    }
    return { valid: false }
  }
}

/**
 * Deactivates this device's license instance (releases the activation slot).
 * DodoPayments: POST /licenses/deactivate { license_key, license_key_instance_id }
 * Call before uninstalling or when user wants to transfer to another device.
 */
export async function deactivateLicenseInstance(): Promise<boolean> {
  const status = await getLicenseStatus()
  if (!status.isPro || !status.licenseKey || !status.instanceId) {
    // No active instance, just clear local
    await chrome.storage.local.remove(STORAGE_KEYS.LICENSE)
    return true
  }

  try {
    const res = await proxyFetch(`${PROXY_BASE_URL}/api/deactivate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key: status.licenseKey,
        instance_id: status.instanceId,
      }),
    })
    const data = await res.json()

    // Clear local regardless of remote success
    await chrome.storage.local.remove(STORAGE_KEYS.LICENSE)
    return data.deactivated === true
  } catch {
    // Network error — still clear local (user can re-activate later)
    await chrome.storage.local.remove(STORAGE_KEYS.LICENSE)
    return false
  }
}

// ─── License Key Details (via admin API) ────────────────────────────────────

/**
 * Fetches detailed license info from DodoPayments /license_keys endpoint.
 * Requires API key (handled by proxy server).
 * Returns: { id, key, status, instances_count, activations_limit, expires_at, ... }
 */
export async function getLicenseKeyDetails(licenseKeyId: string): Promise<{
  success: boolean
  data?: {
    id: string
    key: string
    status: 'active' | 'expired' | 'disabled'
    instances_count: number
    activations_limit: number | null
    expires_at: string | null
    created_at: string
    source: 'auto' | 'import' | 'manual'
    customer_id: string
    product_id: string
  }
  error?: string
}> {
  try {
    // This calls our proxy's admin endpoint which proxies to DodoPayments
    const res = await proxyFetch(`${PROXY_BASE_URL}/api/admin/licenses?id=${encodeURIComponent(licenseKeyId)}`, {
      method: 'GET',
    })
    const data = await res.json()
    if (data.error) {
      return { success: false, error: data.error }
    }
    return { success: true, data }
  } catch {
    return { success: false, error: 'Failed to fetch license details.' }
  }
}

// ─── Periodic Validation ─────────────────────────────────────────────────────

/** How often to re-validate the license (ms). Default: 24 hours */
const VALIDATION_INTERVAL = 24 * 60 * 60 * 1000
const LAST_VALIDATION_KEY = 'stylesnap_last_validation'

/**
 * Checks if it's time to re-validate the license.
 * Call this on extension startup.
 * If the license is invalid, revokes Pro status.
 */
export async function checkAndValidateLicense(): Promise<boolean> {
  const status = await getLicenseStatus()
  if (!status.isPro || !status.licenseKey) return false

  const data = await chrome.storage.local.get(LAST_VALIDATION_KEY)
  const lastValidation = data[LAST_VALIDATION_KEY] as number | undefined
  const now = Date.now()

  // Skip if validated recently
  if (lastValidation && (now - lastValidation) < VALIDATION_INTERVAL) {
    return true
  }

  // Pass instance_id for instance-specific validation
  const result = await validateLicense(status.licenseKey, status.instanceId)

  if (!result.valid) {
    // License revoked — clear Pro status
    showError('License validation failed — Pro features disabled.')
    await chrome.storage.local.remove(STORAGE_KEYS.LICENSE)
    return false
  }

  // Mark validation time
  await chrome.storage.local.set({ [LAST_VALIDATION_KEY]: now })
  return true
}

// ─── URL Parameter Detection ─────────────────────────────────────────────────

/**
 * Check if the current URL contains a license_key parameter
 * (DodoPayments returns this in the return_url after payment).
 * If found, auto-activate the license.
 */
export async function checkUrlForLicenseKey(): Promise<boolean> {
  try {
    const url = new URL(window.location.href)
    const licenseKey = url.searchParams.get('license_key')
    if (!licenseKey) return false

    const result = await activateLicenseKey(licenseKey)
    if (result.success) {
      // Clean up URL params
      url.searchParams.delete('license_key')
      url.searchParams.delete('payment_id')
      url.searchParams.delete('status')
      url.searchParams.delete('email')
      window.history.replaceState({}, '', url.toString())
      return true
    }
    return false
  } catch {
    return false
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<UserSettings> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS)
  return { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] ?? {}) }
}

export async function saveSettings(settings: Partial<UserSettings>): Promise<void> {
  const current = await getSettings()
  await chrome.storage.local.set({
    [STORAGE_KEYS.SETTINGS]: { ...current, ...settings },
  })
}
