/** Settings popup — license, preferences, panel toggles. */
import { $$, stAppend, attachOutsideClose, showToast, CLOSE_X, SVG, closeHintPopups } from '../ui'
import { S, OVERLAY_ID, FLOATING_BTN_ID } from '../state'
import { updateSidePanel, hideSidePanel } from '../side-panel'
import { showFeedbackModal } from './modals'
import { getLicenseStatus, activateLicenseKey, deactivateLicenseInstance, createCheckout } from '@/lib/license'
import { detectLang, translations } from '@/lib/i18n-core'
import { DEFAULT_SETTINGS } from '@/shared/types'
import type { UserSettings } from '@/shared/types'

export async function showSettingsPopup() {
  const existing = $$('stylesnap-settings-popup')
  if (existing) { existing.remove(); return }
  closeHintPopups('stylesnap-settings-popup')

  // Floating popup (not bottom sheet)
  const popup = document.createElement('div')
  popup.id = 'stylesnap-settings-popup'
  popup.setAttribute('data-stylesnap', 'true')
  Object.assign(popup.style, {
    position: 'fixed',
    zIndex: '999994',
    background: 'var(--ss-bg-panel)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '10px',
    padding: '14px',
    minWidth: '280px',
    maxWidth: '300px',
    maxHeight: '80vh',
    overflow: 'hidden auto',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    fontFamily: 'system-ui, sans-serif',
    color: '#e2e8f0',
    fontSize: '12px',
  })

  // Position: prefer below hint bar if visible, else near floating button
  const hint = $$('stylesnap-hint-bar')
  if (hint && window.getComputedStyle(hint).opacity !== '0') {
    const hRect = hint.getBoundingClientRect()
    popup.style.top = `${hRect.bottom + 6}px`
    popup.style.left = '50%'
    popup.style.transform = 'translateX(-50%)'
    popup.style.right = 'auto'
  } else {
    const fb = $$(FLOATING_BTN_ID)
    if (fb) {
      const fbRect = fb.getBoundingClientRect()
      popup.style.right = `${window.innerWidth - fbRect.left + 8}px`
      popup.style.top = `${fbRect.top - 8}px`
      popup.style.transform = 'translateY(-100%)'
    } else {
      popup.style.bottom = '100px'
      popup.style.right = '24px'
      popup.style.transform = 'none'
    }
  }

  // Close function
  const close = () => {
    popup.remove()
  }

  // Load license + settings + AI config
  const [licenseStatus, settingsData] = await Promise.all([
    getLicenseStatus(),
    new Promise<Record<string, unknown>>(res => chrome.storage.local.get(['stylesnap_settings'], r => res(r.stylesnap_settings || {}))),
  ])
  S.licenseIsPro = licenseStatus.isPro

  const settings = { ...DEFAULT_SETTINGS, ...settingsData } as UserSettings
  const lang = await detectLang()
  const t = translations[lang] || translations.en


  const inputStyle = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:5px 8px;color:#e2e8f0;font-size:11px;width:100%;box-sizing:border-box;'
  const btnStyle = 'background:var(--ss-primary);border:none;border-radius:4px;padding:5px 10px;color:#fff;font-size:11px;cursor:pointer;white-space:nowrap;'
  const secondaryBtnStyle = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:4px;padding:5px 10px;color:#e2e8f0;font-size:11px;cursor:pointer;white-space:nowrap;'
  const sectionStyle = 'margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);'

  // License status text
  const proBadge = licenseStatus.isPro
    ? '<span style="background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3);border-radius:3px;padding:1px 6px;font-size:10px;font-weight:600;">PRO</span>'
    : '<span style="background:rgba(148,163,184,0.1);color:#94a3b8;border:1px solid rgba(148,163,184,0.2);border-radius:3px;padding:1px 6px;font-size:10px;">Free</span>'
  const usageText = licenseStatus.isPro
    ? 'Unlimited'
    : `${licenseStatus.dailyUsed}/${licenseStatus.dailyLimit} today`
  const licenseInfo = licenseStatus.isPro
    ? `<div style="font-size:10px;color:#64748b;margin-top:3px;">${licenseStatus.email || ''} ${licenseStatus.instanceId ? '· ' + licenseStatus.instanceId.slice(0, 8) + '...' : ''}</div>`
    : ''

  // SVG icon helpers (all Lucide line style, 14×14, stroke 1.75)
  const svg14i = `${SVG} width="14" height="14" style="flex:none;vertical-align:middle;margin-right:4px;"`
  const iconKey     = `<svg ${svg14i}><path d="M21 2 19 4M11.4 14.6a5 5 0 1 0-6.8-6.8 5 5 0 0 0 6.8 6.8Z"/><circle cx="8" cy="8" r="1.5"/><path d="m21 2-2.6 2.6"/></svg>`
  const iconSlider  = `<svg ${svg14i}><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="10" r="2"/><circle cx="20" cy="14" r="2"/></svg>`
  const chipGroupStyle = 'display:inline-flex;gap:2px;background:rgba(255,255,255,0.04);border-radius:6px;padding:2px;margin-left:auto;'
  const chipStyle = 'background:transparent;border:none;color:#94a3b8;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;white-space:nowrap;transition:all 0.12s;'
  const chipActiveStyle = 'background:var(--ss-primary-border);color:#e2e8f0;'

  // Reusable chip group helper
  const chipGroup = (idBase: string, options: {value: string; label: string}[], selected: string) => {
    return `<div id="${idBase}" style="${chipGroupStyle}">${
      options.map(o => {
        const isActive = o.value === selected
        return `<button data-value="${o.value}" style="${chipStyle}${isActive ? chipActiveStyle : ''}" class="${isActive ? 'active-chip' : ''}" type="button">${o.label}</button>`
      }).join('')
    }</div>`
  }
  const toggleHtml = (id: string, checked: boolean) =>
    `<label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:3px 0;">
      <span style="font-size:11px;color:#cbd5e1;flex:1;margin-right:8px;"><span id="ss-label-${id}"></span></span>
      <div style="position:relative;width:36px;height:20px;flex:none;">
        <input id="${id}" type="checkbox" ${checked ? 'checked' : ''}
          style="position:absolute;opacity:0;width:100%;height:100%;cursor:pointer;z-index:1;margin:0;">
        <div style="width:36px;height:20px;border-radius:10px;background:${checked ? 'var(--ss-primary)' : 'rgba(255,255,255,0.12)'};transition:background 0.15s;display:flex;align-items:center;padding:2px;">
          <div style="width:16px;height:16px;border-radius:50%;background:#fff;transform:translateX(${checked ? '16px' : '0'});transition:transform 0.15s;box-shadow:0 1px 2px rgba(0,0,0,0.2);"></div>
        </div>
      </div>
    </label>`

  // Mail icon for feedback button
  const iconMail = `<svg ${svg14i}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`

  popup.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <span style="display:flex;align-items:center;font-weight:600;font-size:13px;">${iconSlider} Settings</span>
      <div style="display:flex;align-items:center;gap:2px;">
        <button id="ss-btn-feedback" title="Feedback" style="background:none;border:none;color:var(--ss-primary-light);cursor:pointer;padding:2px 4px;border-radius:4px;display:flex;transition:color 0.15s;">${iconMail}</button>
        <button id="ss-settings-close" style="background:none;border:none;color:#64748b;cursor:pointer;padding:2px 4px;border-radius:4px;display:flex;">${CLOSE_X}</button>
      </div>
    </div>

    <!-- License -->
    <div style="font-size:11px;line-height:1.5;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <span style="display:flex;align-items:center;font-weight:600;color:#e2e8f0;">${iconKey} ${t.license}</span>
        ${proBadge}
      </div>
      <div style="font-size:10px;color:#94a3b8;margin-bottom:6px;">${usageText}</div>
      ${licenseInfo}
      ${!licenseStatus.isPro ? `
        <div style="margin-top:6px;display:flex;gap:6px;">
          <input id="ss-license-key" type="text" placeholder="${t.licenseKeyLabel}" style="${inputStyle}flex:1;">
          <button id="ss-license-activate" style="${btnStyle}">${t.activate || 'Activate'}</button>
        </div>
        <button id="ss-license-buy" style="margin-top:6px;${btnStyle}width:100%;">${t.upgrade || 'Upgrade to Pro — $29'}</button>
        <div style="font-size:10px;color:#64748b;margin-top:4px;text-align:center;">
          <a id="ss-license-recover" href="#" style="color:var(--ss-primary-light);text-decoration:none;cursor:pointer;">Lost your license key? Recover</a>
        </div>
      ` : `
        <button id="ss-license-deactivate" style="margin-top:6px;${secondaryBtnStyle}width:100%;">${t.deactivate || 'Deactivate License'}</button>
      `}
    </div>

    <!-- Preferences -->
    <div style="${sectionStyle}">
      <span style="font-weight:600;font-size:11px;color:#e2e8f0;margin-bottom:4px;">${iconSlider} ${t.preferences || 'Preferences'}</span>
      ${toggleHtml('ss-pref-floating-btn', settings.showFloatingBtn !== false)}
      <div id="ss-floating-btn-hint" style="font-size:9px;color:#64748b;margin-top:-2px;margin-bottom:4px;margin-left:2px;${settings.showFloatingBtn !== false ? 'display:none;' : ''}">
        💡 Click the StyleSnap toolbar icon to reopen settings
      </div>
      ${toggleHtml('ss-pref-show-tw', settings.showTailwindOverlay !== false)}
      ${toggleHtml('ss-pref-side-panel', settings.showSidePanel !== false)}
      <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;color:#cbd5e1;white-space:nowrap;">Overlay:</span>
        ${chipGroup('ss-pref-overlay-side', [
          {value: 'right', label: 'Right'},
          {value: 'left', label: 'Left'},
        ], (settings.overlaySide || 'right'))}
      </div>
      <div style="margin-top:6px;font-size:11px;color:#cbd5e1;display:flex;align-items:center;gap:8px;">
        <span style="white-space:nowrap;">${t.assistMode || 'Assist'}:</span>
        ${chipGroup('ss-pref-assist-mode', [
          {value: '0', label: 'Off'},
          {value: '1', label: 'Guidelines'},
          {value: '2', label: 'Grid'},
        ], String(settings.assistMode ?? 1))}
      </div>
      <div style="margin-top:6px;font-size:11px;color:#cbd5e1;display:flex;align-items:center;gap:8px;">
        <span style="white-space:nowrap;">Color:</span>
        ${chipGroup('ss-pref-color-format', [
          {value: 'rgb', label: 'RGB'},
          {value: 'hex', label: 'Hex'},
          {value: 'hsl', label: 'HSL'},
        ], (settings.colorFormat || 'rgb'))}
      </div>
    </div>

    <div style="font-size:10px;color:#475569;text-align:center;padding-top:10px;">
      StyleSnap v1.0.0 · by LucidLibs<br>
      <kbd>G</kbd> cycle mode &nbsp; <kbd>Esc</kbd> exit
    </div>
  `
  stAppend(popup)

  // Set i18n labels for toggles
  const setLabel = (id: string, key: string) => {
    const el = popup.querySelector(`#ss-label-${id}`)
    if (el) el.textContent = (t as Record<string, string>)[key] || key
  }
  setLabel('ss-pref-floating-btn', 'floatingBtn')
  setLabel('ss-pref-show-tw', 'showTailwindOverlay')
  const spLabel = popup.querySelector('#ss-label-ss-pref-side-panel')
  if (spLabel) spLabel.textContent = 'Box Model'
  // ─── Event handlers ────────────────────────────────────────────────

  const savePrefs = () => {
    const fbChecked = (popup.querySelector('#ss-pref-floating-btn') as HTMLInputElement)?.checked
    const twChecked = (popup.querySelector('#ss-pref-show-tw') as HTMLInputElement)?.checked
    const spChecked = (popup.querySelector('#ss-pref-side-panel') as HTMLInputElement)?.checked
    const os = (popup.querySelector('#ss-pref-overlay-side .active-chip') as HTMLElement)?.dataset.value as 'right' | 'left' || 'right'
    const am = parseInt((popup.querySelector('#ss-pref-assist-mode .active-chip') as HTMLElement)?.dataset.value || '1', 10)
    const cform = (popup.querySelector('#ss-pref-color-format .active-chip') as HTMLElement)?.dataset.value as 'rgb' | 'hex' | 'hsl' || 'rgb'
    const newSettings: Partial<UserSettings> = {
      showFloatingBtn: fbChecked,
      showTailwindOverlay: twChecked,
      showSidePanel: spChecked,
      overlaySide: os,
      assistMode: am as 0 | 1 | 2,
      colorFormat: cform,
    }
    S.showSidePanel = spChecked !== false
    chrome.storage.local.get(['stylesnap_settings'], (res) => {
      const cur = res.stylesnap_settings || {}
      chrome.storage.local.set({ stylesnap_settings: { ...cur, ...newSettings } })
    })
  }

  // Toggle switches
  popup.querySelector('#ss-pref-floating-btn')?.addEventListener('change', () => {
    savePrefs()
    // Show/hide the "toolbar icon" hint
    const fbChecked = (popup.querySelector('#ss-pref-floating-btn') as HTMLInputElement)?.checked
    const hint = popup.querySelector('#ss-floating-btn-hint') as HTMLElement | null
    if (hint) hint.style.display = fbChecked ? 'none' : 'block'
  })
  popup.querySelector('#ss-pref-side-panel')?.addEventListener('change', () => {
    savePrefs()
    if (!S.showSidePanel) hideSidePanel()
    else if (S.lockedElement) { const ov = $$(OVERLAY_ID); if (ov) updateSidePanel(S.lockedElement as HTMLElement, ov) }
  })
  popup.querySelector('#ss-pref-show-tw')?.addEventListener('change', savePrefs)

  // Chip group click handlers — replaces old select change listeners
  const bindChipGroup = (groupId: string) => {
    const group = popup.querySelector(`#${groupId}`)
    if (!group) return
    group.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button')
      if (!btn) return
      // Remove active from all, add to clicked
      group.querySelectorAll('button').forEach(b => {
        b.classList.remove('active-chip')
        ;(b as HTMLElement).style.cssText = chipStyle
      })
      btn.classList.add('active-chip')
      btn.style.cssText = chipStyle + chipActiveStyle
      savePrefs()
    })
  }
  bindChipGroup('ss-pref-overlay-side')
  bindChipGroup('ss-pref-assist-mode')
  bindChipGroup('ss-pref-color-format')
  // Close
  popup.querySelector('#ss-settings-close')?.addEventListener('click', close)

  // Click outside to close — leak-proof, auto-cleans on any removal path
  attachOutsideClose(popup, { delay: 200 })

  // License Activate
  popup.querySelector('#ss-license-activate')?.addEventListener('click', async () => {
    const keyInput = popup.querySelector('#ss-license-key') as HTMLInputElement
    const key = keyInput?.value?.trim()
    if (!key) { showToast('Enter a license key'); return }
    showToast('Activating...')
    const result = await activateLicenseKey(key)
    if (result.success) {
      showToast('License activated! 🎉')
      popup.remove()
      // Re-open to show new state
      setTimeout(() => showSettingsPopup(), 400)
    } else {
      showToast(result.error || 'Activation failed')
    }
  })

  // License Buy
  popup.querySelector('#ss-license-buy')?.addEventListener('click', async function(this: HTMLButtonElement) {
    const btn = this
    const original = btn.textContent
    btn.disabled = true
    btn.textContent = 'Opening…'
    btn.style.opacity = '0.7'
    try {
      const url = await createCheckout()
      window.open(url, '_blank')
      // After redirect, prompt to activate
      setTimeout(() => {
        btn.disabled = false
        btn.textContent = original
        btn.style.opacity = ''
        const keyInput = popup.querySelector('#ss-license-key') as HTMLInputElement | null
        if (keyInput) {
          keyInput.placeholder = 'Paste license key from email'
          keyInput.focus()
          showToast('Purchase complete? Paste your license key above.')
        }
      }, 2000)
    } catch {
      btn.disabled = false
      btn.textContent = original
      btn.style.opacity = ''
      showToast('Checkout unavailable — try again later')
    }
  })

  // License Deactivate
  popup.querySelector('#ss-license-deactivate')?.addEventListener('click', async () => {
    showToast('Deactivating...')
    await deactivateLicenseInstance()
    showToast('License deactivated')
    popup.remove()
    setTimeout(() => showSettingsPopup(), 400)
  })

  // License Recover — opens recovery page on website
  popup.querySelector('#ss-license-recover')?.addEventListener('click', (e) => {
    e.preventDefault()
    window.open('https://style.lucidlibs.dev/recover', '_blank')
  })

  // Update toggle visual on click (sync slider position)
  popup.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', function(this: HTMLInputElement) {
      const slider = this.nextElementSibling?.querySelector('div:last-child') as HTMLElement | null
      if (slider) slider.style.transform = `translateX(${this.checked ? '16px' : '0'})`
      // Update background
      const track = this.nextElementSibling as HTMLElement | null
      if (track) track.style.background = this.checked ? 'var(--ss-primary)' : 'rgba(255,255,255,0.12)'
    })
  })

  // Feedback button → open independent modal
  popup.querySelector('#ss-btn-feedback')?.addEventListener('click', () => {
    showFeedbackModal()
  })
}

