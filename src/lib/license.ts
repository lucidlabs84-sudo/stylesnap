/**
 * License Manager — StyleSnap
 * Free: 20 extractions/day   |   Pro: unlimited ($29 one-time)
 *
 * Uses DodoPayments License Key system via secure proxy API.
 * Flow: checkout → payment → license key returned → activate on device → validate periodically
 * Proxy: https://api.lucidlibs.dev
 *
 * DodoPayments API mapping:
 * - POST /licenses/activate   → public, returns { id, customer, product }
 * - POST /licenses/validate   → public, returns { valid: boolean }
 * - POST /licenses/deactivate → public, 200 on success
 * - GET  /license_keys        → API key required, returns { items: [{ id, key, status, instances_count, ... }] }
 * - GET  /license_key_instances → API key required, returns { items: [{ id, name, created_at }] }
 */
import type { LicenseStatus, UserSettings } from '@/shared/types'
import { DEFAULT_SETTINGS } from '@/shared/types'
import { STORAGE_KEYS, DAILY_FREE_LIMIT, PROXY_BASE_URL } from '@/shared/constants'
import { showError } from './notifications'

/**
 * Wrapper around fetch() that automatically adds the extension ID header.
 * This allows the proxy server to verify the request is coming from our extension.
 */
async function proxyFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const mergedOptions: RequestInit = {
    ...options,
    headers: {
      ...(options.headers || {}),
      'x-extension-id': chrome.runtime.id || '',
    },
  }
  return fetch(url, mergedOptions)
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
    STORAGE_KEYS.USAGE,
  ])

  const stored = data[STORAGE_KEYS.LICENSE] as Partial<LicenseStatus> | undefined
  const usageRec = data[STORAGE_KEYS.USAGE] as { date: string; count: number } | undefined

  const today     = new Date().toISOString().slice(0, 10)
  const dailyUsed = usageRec?.date === today ? (usageRec.count ?? 0) : 0

  if (stored?.isPro) {
    return {
      isPro:              true,
      dailyUsed,
      dailyLimit:         Infinity,
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

  return { isPro: false, dailyUsed, dailyLimit: DAILY_FREE_LIMIT }
}

// ─── Usage tracking ───────────────────────────────────────────────────────────

/** Returns false when free quota exceeded */
export async function recordUsage(): Promise<boolean> {
  const status = await getLicenseStatus()
  if (status.isPro) return true
  if (status.dailyUsed >= status.dailyLimit) return false

  const today = new Date().toISOString().slice(0, 10)
  await chrome.storage.local.set({
    [STORAGE_KEYS.USAGE]: { date: today, count: status.dailyUsed + 1 },
  })
  return true
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
      return_url: chrome.runtime?.getURL('sidepanel/index.html') || 'https://lucidlibs.dev/stylesnap/success',
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
      dailyUsed:        0,
      dailyLimit:       Infinity,
      licenseKey:       key,
      instanceId:       data.instance_id,
      email:            data.customer_email || '',
      customerName:     data.customer_name || '',
      productName:      data.product_name || '',
      activatedAt:      data.created_at || new Date().toISOString(),
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.LICENSE]: payload })
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
      // Refresh stored license data
      const current = await getLicenseStatus()
      const payload: Partial<LicenseStatus> = {
        ...current,
      }
      await chrome.storage.local.set({ [STORAGE_KEYS.LICENSE]: payload })
    }

    return {
      valid: data.valid === true,
    }
  } catch {
    // Network error — trust local cache, don't revoke
    return { valid: true }
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

// ─── Legacy compat (email-based activation) ──────────────────────────────────

/**
 * @deprecated Use activateLicenseKey() instead.
 * Legacy email-based activation — kept for backward compatibility.
 */
export async function activateLicense(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase()
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailPattern.test(normalized)) return false

  try {
    const res = await proxyFetch(`${PROXY_BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalized }),
    })
    const data = await res.json()

    if (!data.valid) return false

    const payload: Partial<LicenseStatus> = {
      isPro:      true,
      dailyUsed:  0,
      dailyLimit: Infinity,
      email:      normalized,
      licenseKey: data.license_key || data.payment_id || `dodo_${Date.now()}`,
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.LICENSE]: payload })
    return true
  } catch {
    return false
  }
}

export async function deactivateLicense(): Promise<void> {
  await deactivateLicenseInstance()
}

// ─── Periodic Validation ─────────────────────────────────────────────────────

/** How often to re-validate the license (ms). Default: 24 hours */
const VALIDATION_INTERVAL = 24 * 60 * 60 * 1000
const LAST_VALIDATION_KEY = 'stylesnap_last_validation'

/**
 * Checks if it's time to re-validate the license.
 * Call this on extension startup or sidepanel open.
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
