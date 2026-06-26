/** Top hint bar — keyboard hints + Design/History/Settings buttons. */
import { $$, stAppend, SVG } from './ui'
import { getLicenseStatus } from '@/lib/license'
import { showUpgradeModal } from './panels/modals'
import { showDesignPopup } from './panels/design'
import { showHistoryPanel } from './panels/history'
import { showSettingsPopup } from './panels/settings'

export function showHintBar() {
  hideHintBar()
  const bar = document.createElement('div')
  bar.id = 'stylesnap-hint-bar'
  bar.setAttribute('data-stylesnap', 'true')
  bar.innerHTML = `
    <style>
      .ss-hint-logo { font-weight:700; color:#818cf8; margin-right:4px; font-size:12px; }
      .ss-hint-item { color:#cbd5e1; }
      .ss-hint-item kbd { display:inline-block; background:rgba(255,255,255,0.1); color:#e2e8f0; padding:1px 5px; border-radius:3px; font-size:10px; font-family:monospace; margin-right:2px; border:1px solid rgba(255,255,255,0.08); }
      .ss-hint-sep { color:rgba(255,255,255,0.12); }
      .ss-hint-close { background:none; border:none; color:rgba(255,255,255,0.25); cursor:pointer; font-size:14px; padding:0 2px; margin-left:4px; line-height:1; transition:color 0.15s; }
      .ss-hint-close:hover { color:rgba(255,255,255,0.6); }
      .ss-hint-settings { background:none; border:none; color:rgba(255,255,255,0.45); cursor:pointer; font-size:13px; padding:0 2px; margin-left:4px; line-height:1; transition:color 0.15s; display:flex; align-items:center; }
      .ss-hint-settings:hover { color:rgba(255,255,255,0.85); }
      .ss-hint-settings svg { width:13px; height:13px; }
      .ss-hint-action { background:none; border:1px solid rgba(255,255,255,0.12); border-radius:3px; color:rgba(255,255,255,0.5); cursor:pointer; font-size:10px; padding:2px 6px; margin-left:6px; transition:all 0.15s; white-space:nowrap; }
      .ss-hint-action:hover { border-color:rgba(99,102,241,0.4); color:#a5b4fc; background:rgba(99,102,241,0.1); }
    </style>
    <span class="ss-hint-logo">StyleSnap</span>
    <span class="ss-hint-item"><kbd>↑↓←→</kbd> DOM</span>
    <span class="ss-hint-sep">·</span>
    <span class="ss-hint-item"><kbd>G</kbd> Assist</span>
    <span class="ss-hint-sep">·</span>
    <span class="ss-hint-item"><kbd>Space</kbd> Compare</span>
    <span class="ss-hint-sep">·</span>
    <span class="ss-hint-item"><kbd>ESC</kbd> Exit</span>
    <span class="ss-hint-sep">·</span>
    <span class="ss-hint-item"><kbd>?</kbd> All</span>
    <button class="ss-hint-action ss-hint-design" title="Colors & Fonts">Design</button>
    <button class="ss-hint-action ss-hint-history" title="Inspection history">History</button>
    <button class="ss-hint-settings" title="Settings"><svg ${SVG}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></button>
    <button class="ss-hint-close" title="Dismiss">&times;</button>
  `
  Object.assign(bar.style, {
    position: 'fixed',
    top: '0',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 14px',
    background: 'rgba(15, 23, 42, 0.92)',
    border: '1px solid rgba(99, 102, 241, 0.25)',
    borderTop: 'none',
    borderRadius: '0 0 10px 10px',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '11px',
    color: '#94a3b8',
    zIndex: '9999992',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    transition: 'opacity 0.3s ease, transform 0.3s ease',
    opacity: '0',
    pointerEvents: 'auto',
    whiteSpace: 'nowrap',
    backdropFilter: 'blur(8px)',
  })

  stAppend(bar)

  const closeBtn = bar.querySelector('.ss-hint-close')!
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    hideHintBar()
  })

  const settingsBtn = bar.querySelector('.ss-hint-settings')!
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    showSettingsPopup()
  })

  const designBtn = bar.querySelector('.ss-hint-design')
  designBtn?.addEventListener('click', (e) => {
    e.stopPropagation()
    showDesignPopup()
  })

  const historyBtn = bar.querySelector('.ss-hint-history')
  historyBtn?.addEventListener('click', (e) => {
    e.stopPropagation()
    showHistoryPanel()
  })

  // Async quota warning for free users
  getLicenseStatus().then(status => {
    if (status.isPro) return
    const used = status.dailyUsed
    const limit = status.dailyLimit
    const pct = used / limit
    if (pct < 0.5) return
    const remaining = limit - used
    const color = pct >= 0.9 ? '#f87171' : '#fbbf24'
    const quotaSpan = document.createElement('span')
    quotaSpan.style.cssText = `margin-left:6px;font-size:10px;color:${color};border:1px solid ${color}33;border-radius:3px;padding:1px 6px;cursor:pointer;`
    quotaSpan.textContent = remaining <= 0 ? '0 left · Upgrade →' : `${remaining}/${limit} left`
    quotaSpan.title = 'Upgrade to Pro for unlimited extractions'
    quotaSpan.addEventListener('click', (e) => { e.stopPropagation(); showUpgradeModal() })
    bar.insertBefore(quotaSpan, bar.querySelector('.ss-hint-action'))
  })

  // Fade in
  requestAnimationFrame(() => {
    bar.style.opacity = '1'
  })
}

export function hideHintBar() {
  const bar = $$('stylesnap-hint-bar')
  if (bar) {
    bar.style.opacity = '0'
    bar.addEventListener('transitionend', () => bar.remove(), { once: true })
    setTimeout(() => bar.remove(), 350)
  }
}

