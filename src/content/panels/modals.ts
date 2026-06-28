/** Feedback + Upgrade modals. Self-contained (ui + lib only). */
import { $$, stAppend, showToast } from '../ui'
import { detectLang, translations } from '@/lib/i18n-core'
import { activateLicenseKey, createCheckout } from '@/lib/license'
import { submitFeedback } from '@/lib/feedback'

export async function showFeedbackModal() {
  $$('ss-feedback-modal')?.remove()
  $$('ss-feedback-backdrop')?.remove()

  const lang = await detectLang()
  const t = translations[lang] || translations.en

  const modal = document.createElement('div')
  modal.id = 'ss-feedback-modal'
  modal.setAttribute('data-stylesnap', 'true')

  modal.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <span style="font-size:13px;font-weight:600;color:#e2e8f0;">${t.feedback || 'Feedback'}</span>
      <button id="ss-fbm-close" style="background:none;border:none;color:#475569;cursor:pointer;font-size:18px;line-height:1;padding:0;">×</button>
    </div>
    <div style="display:flex;gap:4px;margin-bottom:10px;">
      <button class="ss-fbm-type" data-type="praise" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:5px;color:#94a3b8;cursor:pointer;font-size:10px;padding:5px 2px;">👍 ${t.feedbackPraise || 'Love It'}</button>
      <button class="ss-fbm-type" data-type="bug" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:5px;color:#94a3b8;cursor:pointer;font-size:10px;padding:5px 2px;">🐛 ${t.feedbackBug || 'Bug'}</button>
      <button class="ss-fbm-type" data-type="feature" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:5px;color:#94a3b8;cursor:pointer;font-size:10px;padding:5px 2px;">💡 ${t.feedbackFeature || 'Request'}</button>
      <button class="ss-fbm-type" data-type="general" style="flex:1;background:var(--ss-primary-border);border:1px solid rgba(99,102,241,0.3);border-radius:5px;color:var(--ss-primary-lighter);cursor:pointer;font-size:10px;padding:5px 2px;">💬 ${t.feedbackGeneral || 'Other'}</button>
    </div>
    <textarea id="ss-fbm-msg" placeholder="${t.feedbackPlaceholder || 'Tell us what you think…'}" style="width:100%;height:80px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;font-size:11px;padding:8px;resize:none;box-sizing:border-box;font-family:system-ui,sans-serif;outline:none;display:block;"></textarea>
    <input id="ss-fbm-email" type="email" placeholder="${t.feedbackEmailPlaceholder || 'Email (optional, for replies)'}" style="width:100%;margin-top:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;font-size:11px;padding:7px 8px;box-sizing:border-box;outline:none;display:block;">
    <button id="ss-fbm-submit" style="margin-top:8px;width:100%;background:var(--ss-primary);border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:12px;font-weight:600;padding:9px;transition:opacity 0.15s;">${t.feedbackSubmit || 'Send Feedback'}</button>
    <div style="font-size:10px;color:#475569;text-align:center;margin-top:8px;">${t.feedbackContactHint || 'Need direct help?'} <a href="mailto:hi@lucidlibs.dev" style="color:var(--ss-primary-light);text-decoration:none;">hi@lucidlibs.dev</a></div>
  `

  Object.assign(modal.style, {
    position: 'fixed',
    zIndex: '9999999',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(10, 15, 28, 0.98)',
    border: '1px solid rgba(99, 102, 241, 0.35)',
    borderRadius: '12px',
    padding: '18px',
    width: '300px',
    maxWidth: 'calc(100vw - 32px)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
    fontFamily: 'system-ui, sans-serif',
    color: '#e2e8f0',
  })

  const backdrop = document.createElement('div')
  backdrop.id = 'ss-feedback-backdrop'
  backdrop.setAttribute('data-stylesnap', 'true')
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: '9999998',
    background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)',
  })

  const close = () => { modal.remove(); backdrop.remove() }
  backdrop.addEventListener('click', close)
  modal.querySelector('#ss-fbm-close')?.addEventListener('click', close)

  let fbType = 'general'
  modal.querySelectorAll('.ss-fbm-type').forEach(btn => {
    btn.addEventListener('click', function(this: HTMLElement) {
      fbType = this.dataset.type || 'general'
      modal.querySelectorAll('.ss-fbm-type').forEach(b => {
        ;(b as HTMLElement).style.background = 'rgba(255,255,255,0.06)'
        ;(b as HTMLElement).style.color = '#94a3b8'
        ;(b as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'
      })
      this.style.background = 'var(--ss-primary-border)'
      this.style.color = 'var(--ss-primary-lighter)'
      this.style.borderColor = 'rgba(99,102,241,0.3)'
    })
  })

  modal.querySelector('#ss-fbm-submit')?.addEventListener('click', async function(this: HTMLButtonElement) {
    const msg = (modal.querySelector('#ss-fbm-msg') as HTMLTextAreaElement)?.value?.trim()
    if (!msg) { showToast('Write something first'); return }
    const email = (modal.querySelector('#ss-fbm-email') as HTMLInputElement)?.value?.trim() || undefined
    this.disabled = true; this.textContent = '…'; this.style.opacity = '0.7'
    const result = await submitFeedback({
      type: fbType as 'bug' | 'feature' | 'general' | 'praise',
      message: msg,
      email,
      metadata: { version: chrome.runtime?.getManifest?.()?.version || 'unknown', lang },
    })
    if (result.ok) {
      modal.innerHTML = `<div style="text-align:center;padding:20px 0;">
        <div style="font-size:28px;margin-bottom:8px;">🙌</div>
        <div style="font-size:14px;font-weight:600;color:#e2e8f0;margin-bottom:4px;">${t.feedbackThanks || 'Thank you!'}</div>
        <div style="font-size:11px;color:#64748b;">${t.feedbackThanksDesc || 'We read every message.'}</div>
      </div>`
      setTimeout(close, 2200)
    } else {
      this.disabled = false; this.style.opacity = ''
      this.textContent = t.feedbackSubmit || 'Send Feedback'
      showToast(result.error || t.feedbackError || 'Failed to send')
    }
  })

  stAppend(backdrop)
  stAppend(modal)
  setTimeout(() => (modal.querySelector('#ss-fbm-msg') as HTMLTextAreaElement)?.focus(), 50)
}

// ─── Upgrade Modal ────────────────────────────────────────────────────────────

export async function showUpgradeModal() {
  $$('ss-upgrade-modal')?.remove()
  $$('ss-upgrade-backdrop')?.remove()

  const lang = await detectLang()
  const t = translations[lang] || translations.en

  const modal = document.createElement('div')
  modal.id = 'ss-upgrade-modal'
  modal.setAttribute('data-stylesnap', 'true')

  const features = [
    { icon: '∞', label: t.featUnlimited || 'Unlimited extractions', desc: t.featUnlimitedDesc || 'No daily limits' },
    { icon: '🎨', label: t.featTailwind || 'Tailwind class export', desc: t.featTailwindDesc || '300+ mapping rules' },
    { icon: '⚛️', label: t.featReactVue || 'React / Vue code gen', desc: t.featReactVueDesc || 'Ready-to-paste components' },
    { icon: '🪙', label: t.featTokens || 'Design token export', desc: t.featTokensDesc || 'Full color & spacing system' },
    { icon: '🤖', label: t.featAIFallback || 'AI code fallback', desc: t.featAIFallbackDesc || 'For complex patterns' },
    { icon: '♾️', label: t.featUpdates || 'Lifetime updates', desc: t.featUpdatesDesc || 'Pay once, own forever' },
  ]

  modal.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div>
        <div style="font-size:15px;font-weight:700;color:#e2e8f0;">${t.upgradeModalTitle || 'StyleSnap Pro'}</div>
        <div style="font-size:10px;color:#64748b;margin-top:1px;">${t.oneTime || 'One-time payment · Lifetime access'}</div>
      </div>
      <button id="ss-upgrade-close" style="background:none;border:none;color:#475569;cursor:pointer;font-size:18px;line-height:1;padding:0;flex-shrink:0;">×</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px;">
      ${features.map(f => `
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:8px;">
          <div style="font-size:13px;margin-bottom:2px;">${f.icon} <span style="font-size:11px;font-weight:600;color:#e2e8f0;">${f.label}</span></div>
          <div style="font-size:9px;color:#64748b;line-height:1.4;">${f.desc}</div>
        </div>
      `).join('')}
    </div>
    <div style="background:linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.1));border:1px solid rgba(99,102,241,0.3);border-radius:8px;padding:12px;text-align:center;margin-bottom:10px;">
      <div style="font-size:22px;font-weight:700;color:#e2e8f0;">$29</div>
      <div style="font-size:10px;color:#94a3b8;margin-top:2px;">${t.oneTime || 'One-time · No subscription · Lifetime access'}</div>
    </div>
    <button id="ss-upgrade-cta" style="width:100%;background:linear-gradient(135deg,var(--ss-primary),#8b5cf6);border:none;border-radius:7px;color:#fff;cursor:pointer;font-size:13px;font-weight:700;padding:11px;transition:opacity 0.15s;margin-bottom:8px;">${t.upgradeToPro || 'Upgrade to Pro — $29'}</button>
    <div style="display:flex;align-items:center;gap:4px;margin-bottom:10px;">
      <input id="ss-upgrade-key" type="text" placeholder="${t.licenseKeyLabel || 'License Key'} (PRO-XXXX-…)" style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:5px;color:#e2e8f0;font-size:11px;padding:7px 8px;outline:none;box-sizing:border-box;">
      <button id="ss-upgrade-activate" style="background:#1e293b;border:1px solid rgba(99,102,241,0.4);border-radius:5px;color:var(--ss-primary-light);cursor:pointer;font-size:11px;font-weight:600;padding:7px 10px;white-space:nowrap;">${t.activate || 'Activate'}</button>
    </div>
    <div style="text-align:center;font-size:10px;color:#475569;">
      <span>${t.secure || '🔒 Secure'}</span> · <span>${t.instant || '📧 Instant'}</span> · <span>${t.lifetime || '♾️ Lifetime'}</span>
    </div>
  `

  Object.assign(modal.style, {
    position: 'fixed',
    zIndex: '9999999',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(10, 15, 28, 0.98)',
    border: '1px solid rgba(99, 102, 241, 0.35)',
    borderRadius: '12px',
    padding: '18px',
    width: '340px',
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: '90vh',
    overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
    fontFamily: 'system-ui, sans-serif',
    color: '#e2e8f0',
  })

  // Backdrop
  const backdrop = document.createElement('div')
  backdrop.id = 'ss-upgrade-backdrop'
  backdrop.setAttribute('data-stylesnap', 'true')
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: '9999998',
    background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
  })

  const close = () => { modal.remove(); backdrop.remove() }
  backdrop.addEventListener('click', close)
  modal.querySelector('#ss-upgrade-close')?.addEventListener('click', close)

  modal.querySelector('#ss-upgrade-cta')?.addEventListener('click', async function(this: HTMLButtonElement) {
    const btn = this
    btn.disabled = true; btn.textContent = 'Opening…'; btn.style.opacity = '0.7'
    try {
      const url = await createCheckout()
      window.open(url, '_blank')
      setTimeout(() => {
        btn.disabled = false; btn.style.opacity = ''
        btn.textContent = t.upgradeToPro || 'Upgrade to Pro — $29'
        const keyInput = modal.querySelector('#ss-upgrade-key') as HTMLInputElement | null
        if (keyInput) { keyInput.placeholder = 'Paste license key from email'; keyInput.focus() }
      }, 2000)
    } catch {
      btn.disabled = false; btn.style.opacity = ''
      btn.textContent = t.upgradeToPro || 'Upgrade to Pro — $29'
      showToast(t.checkoutError || 'Checkout unavailable — try again')
    }
  })

  modal.querySelector('#ss-upgrade-activate')?.addEventListener('click', async function(this: HTMLButtonElement) {
    const keyInput = modal.querySelector('#ss-upgrade-key') as HTMLInputElement
    const key = keyInput?.value?.trim()
    if (!key) { showToast('Enter a license key'); return }
    this.disabled = true; this.textContent = '…'
    const result = await activateLicenseKey(key)
    if (result.success) {
      showToast(t.activateSuccess || 'License activated! 🎉')
      close()
    } else {
      this.disabled = false; this.textContent = t.activate || 'Activate'
      showToast(result.error || t.activateFail || 'Activation failed')
    }
  })

  stAppend(backdrop)
  stAppend(modal)
}

