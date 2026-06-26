/** Floating action button + onboarding bubble + drag/resize. */
import { $$, stAppend } from './ui'
import { S, isActive, FLOATING_BTN_ID } from './state'
import { detectLang, translations } from '@/lib/i18n-core'
import { setInspectMode, updateModeUI } from './index'

function injectFloatingBtnStyles() {
  if (document.getElementById('stylesnap-btn-style')) return
  const style = document.createElement('style')
  style.id = 'stylesnap-btn-style'
  style.textContent = `
    #stylesnap-floating-btn {
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      padding: 0 !important;
      border-radius: 50% !important;
      cursor: pointer !important;
      z-index: 9999999 !important;
      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s, opacity 0.3s ease !important;
      user-select: none !important;
      border: none !important;
      outline: none !important;
      background: transparent !important;
      overflow: visible !important;
      display: flex !important;
      align-items: center !important;
      box-sizing: border-box !important;
      width: 44px !important;
      height: 44px !important;
      opacity: 0.75 !important;
    }
    #stylesnap-floating-btn:hover,
    #stylesnap-floating-btn.is-active,
    #stylesnap-floating-btn.is-dragging {
      opacity: 1 !important;
    }

    /* ── Inner circle ── */
    #stylesnap-floating-btn-inner {
      position: relative !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 44px !important;
      height: 44px !important;
      background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
      border-radius: 50% !important;
      z-index: 2 !important;
      box-sizing: border-box !important;
      box-shadow: 0 2px 6px rgba(99, 102, 241, 0.15) !important;
      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s !important;
    }
    #stylesnap-floating-btn:hover #stylesnap-floating-btn-inner,
    #stylesnap-floating-btn.is-dragging #stylesnap-floating-btn-inner {
      transform: scale(1.06) translateY(-2px) !important;
    }
    #stylesnap-floating-btn.is-active #stylesnap-floating-btn-inner {
      background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.55) !important;
    }

    /* ── Streaming light ring (active state) ── */
    #stylesnap-floating-btn-ring {
      position: absolute !important;
      top: -2px !important; left: -2px !important;
      width: calc(100% + 4px) !important; height: calc(100% + 4px) !important;
      border-radius: 50% !important;
      overflow: hidden !important;
      z-index: 1 !important;
      pointer-events: none !important;
      opacity: 0 !important;
      transition: opacity 0.25s !important;
    }
    #stylesnap-floating-btn-ring::before {
      content: '' !important;
      position: absolute !important;
      top: 50% !important; left: 50% !important;
      width: 200% !important; height: 200% !important;
      margin-top: -100% !important; margin-left: -100% !important;
      transform-origin: center center !important;
      animation: stylesnap-shimmer 3s linear infinite !important;
      background: conic-gradient(
        from 0deg,
        transparent 0deg,
        rgba(99, 102, 241, 0.15) 20deg,
        rgba(99, 102, 241, 0.5) 30deg,
        #818cf8 36deg,
        #a78bfa 42deg,
        rgba(139, 92, 246, 0.5) 48deg,
        transparent 60deg,
        transparent 130deg,
        rgba(99, 102, 241, 0.15) 140deg,
        rgba(99, 102, 241, 0.5) 150deg,
        #818cf8 156deg,
        #a78bfa 162deg,
        rgba(139, 92, 246, 0.5) 168deg,
        transparent 180deg,
        transparent 250deg,
        rgba(99, 102, 241, 0.15) 260deg,
        rgba(99, 102, 241, 0.5) 270deg,
        #818cf8 276deg,
        #a78bfa 282deg,
        rgba(139, 92, 246, 0.5) 288deg,
        transparent 300deg,
        transparent 360deg
      ) !important;
    }
    #stylesnap-floating-btn.is-active #stylesnap-floating-btn-ring {
      opacity: 1 !important;
    }

    /* ── Mode badge (bottom-right corner of ball) ── */
    .stylesnap-mode-badge {
      position: absolute !important;
      bottom: -1px !important;
      right: -1px !important;
      min-width: 20px !important;
      height: 16px !important;
      background: rgba(99,102,241,0.85) !important;
      border: none !important;
      border-radius: 5px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      z-index: 3 !important;
      pointer-events: none !important;
      padding: 0 5px !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      color: #fff !important;
      line-height: 1 !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
    }
    .stylesnap-mode-badge svg {
      width: 11px !important;
      height: 11px !important;
      color: #fff !important;
    }

    /* ── Logo icon ── */
    .stylesnap-logo-icon {
      width: 26px !important;
      height: 26px !important;
      background: #fff !important;
      color: #6366f1 !important;
      border-radius: 8px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 15px !important;
      font-weight: 900 !important;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important;
      font-family: ui-sans-serif, system-ui, sans-serif !important;
      box-sizing: border-box !important;
      transition: color 0.2s, transform 0.2s !important;
    }
    #stylesnap-floating-btn:active .stylesnap-logo-icon {
      transform: scale(0.9) !important;
    }

    /* ── Compare highlight (Bug 3) ── */
    .stylesnap-compare-highlight {
      outline: 2px dashed #fbbf24 !important;
      outline-offset: 1px !important;
      transition: outline 0.1s ease !important;
    }

    /* ── Rotate animation ── */
    @keyframes stylesnap-shimmer {
      0%   { transform: rotate(0deg); }
      50%  { transform: rotate(180deg); }
      100% { transform: rotate(360deg); }
    }
  `
  document.head.appendChild(style)
}

let _fbInitializing = false
let _fbResizeHandler: (() => void) | null = null
export async function initFloatingButton() {
  // Synchronous re-entrancy guard: the async storage callback below opens a
  // window where a second call (e.g. onExecute's 1500ms retry) could create a
  // duplicate button. Bail immediately if one exists or init is in flight.
  if (_fbInitializing || $$(FLOATING_BTN_ID)) return
  _fbInitializing = true
  chrome.storage.local.get(['stylesnap_settings'], async (res) => {
   try {
    const s = res.stylesnap_settings || {}
    if (s.showFloatingBtn === false) {
      const existing = $$(FLOATING_BTN_ID)
      if (existing) existing.remove()
      return
    }
    if ($$(FLOATING_BTN_ID)) return

    const lang = await detectLang()
    const t = translations[lang] || translations.en

    // restore settings
    if (s.lastUsedMode !== undefined && s.lastUsedMode !== 0) {
      S.lastMode = s.lastUsedMode as number
    }
    S.inspectMode = 0  // always start inactive; user must click to activate

    injectFloatingBtnStyles()

    const btn = document.createElement('button')
    btn.id = FLOATING_BTN_ID
    btn.setAttribute('data-stylesnap', 'true')
    btn.title = t.btnTooltip

    btn.innerHTML = `
      <div id="stylesnap-floating-btn-ring"></div>
      <div id="stylesnap-floating-btn-inner">
        <div class="stylesnap-logo-icon">S</div>
        <div class="stylesnap-mode-badge"></div>
      </div>
    `

    // ─── Drag ───
    let isDragging = false
    let hasMoved = false
    let startX = 0, startY = 0
    let initialRight = 24, initialBottom = 24
    let posCustomized = false  // F6: only persist position once the user has actually moved it

    chrome.storage.local.get(['stylesnap_btn_pos'], (res) => {
      if (res.stylesnap_btn_pos) {
        posCustomized = true
        btn.style.setProperty('right', `${res.stylesnap_btn_pos.right}px`, 'important')
        btn.style.setProperty('bottom', `${res.stylesnap_btn_pos.bottom}px`, 'important')
      }
    })

    // Window-level drag listeners are added only for the duration of a drag
    // (mousedown→mouseup) so they never accumulate across re-inits. (F1)
    const onDragMove = (e: MouseEvent) => {
      if (!isDragging) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) hasMoved = true
      if (hasMoved) {
        const padding = 10, btnSize = 44
        const newRight = Math.max(padding, Math.min(initialRight - dx, window.innerWidth - btnSize - padding))
        const newBottom = Math.max(padding, Math.min(initialBottom - dy, window.innerHeight - btnSize - padding))
        btn.style.setProperty('right', `${newRight}px`, 'important')
        btn.style.setProperty('bottom', `${newBottom}px`, 'important')
      }
    }
    const onDragEnd = () => {
      if (!isDragging) return
      isDragging = false
      window.removeEventListener('mousemove', onDragMove)
      window.removeEventListener('mouseup', onDragEnd)
      btn.classList.remove('is-dragging')
      btn.style.setProperty('cursor', 'pointer', 'important')
      btn.style.setProperty('transition', 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s, opacity 0.3s ease', 'important')
      if (hasMoved) {
        const rect = btn.getBoundingClientRect()
        posCustomized = true
        chrome.storage.local.set({
          stylesnap_btn_pos: { right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom },
        })
      }
    }

    btn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      isDragging = true
      hasMoved = false
      startX = e.clientX
      startY = e.clientY
      const rect = btn.getBoundingClientRect()
      initialRight = window.innerWidth - rect.right
      initialBottom = window.innerHeight - rect.bottom
      btn.classList.add('is-dragging')
      btn.style.setProperty('cursor', 'grabbing', 'important')
      btn.style.setProperty('transition', 'opacity 0.3s ease', 'important')
      window.addEventListener('mousemove', onDragMove)
      window.addEventListener('mouseup', onDragEnd)
      e.preventDefault()
    })

    // ─── Resize boundary clamp ───
    // Remove-before-add so re-inits never stack resize listeners. (F1)
    if (_fbResizeHandler) window.removeEventListener('resize', _fbResizeHandler)
    _fbResizeHandler = () => {
      const b = $$(FLOATING_BTN_ID)
      if (!b) return
      const rect = b.getBoundingClientRect()
      const padding = 10, btnSize = 44
      const right = Math.max(padding, Math.min(window.innerWidth - rect.right, window.innerWidth - btnSize - padding))
      const bottom = Math.max(padding, Math.min(window.innerHeight - rect.bottom, window.innerHeight - btnSize - padding))
      b.style.setProperty('right', `${right}px`, 'important')
      b.style.setProperty('bottom', `${bottom}px`, 'important')
      // F6: only persist if the user has customized the position — never overwrite
      // the default "bottom-right" anchor just because the window was resized.
      if (posCustomized) chrome.storage.local.set({ stylesnap_btn_pos: { right, bottom } })
    }
    window.addEventListener('resize', _fbResizeHandler)

    // ─── Button action ───
    const btnInner = btn.querySelector('#stylesnap-floating-btn-inner')

    // Main ball click → toggle inspect mode on/off
    btnInner?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (hasMoved) return

      if (!isActive()) {
        // Enter inspect mode (default: Inspect = 1)
        setInspectMode(S.lastMode > 0 ? S.lastMode : 1)
      } else {
        // Exit inspect mode
        setInspectMode(0)
      }
    })

    stAppend(btn)

    // sync initial mode UI (S.inspectMode is always 0 on load; just render badge)
    updateModeUI()

    // ─── First-install onboarding bubble ────────────────────────────
    chrome.storage.local.get(['stylesnap_onboarded'], (ob) => {
      if (ob.stylesnap_onboarded) return
      const bubble = document.createElement('div')
      bubble.id = 'ss-onboard-bubble'
      bubble.setAttribute('data-stylesnap', 'true')
      bubble.innerHTML = '👆 <span style="font-weight:600;">Click to inspect any element</span>'
      Object.assign(bubble.style, {
        position: 'fixed',
        zIndex: '9999993',
        bottom: '74px',
        right: '24px',
        background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
        color: '#fff',
        padding: '8px 14px',
        borderRadius: '8px',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        boxShadow: '0 4px 16px rgba(99,102,241,0.5)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        whiteSpace: 'nowrap',
        animation: 'ss-bubble-pulse 1.5s ease-in-out 3',
        pointerEvents: 'none',
      })
      // Arrow pointing down to button
      const arrow = document.createElement('div')
      Object.assign(arrow.style, {
        position: 'absolute', bottom: '-6px', right: '24px',
        width: '0', height: '0',
        borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
        borderTop: '6px solid #8b5cf6',
      })
      bubble.appendChild(arrow)
      stAppend(bubble)

      // Dismiss on first interaction. Bind to btnInner (which receives the click);
      // binding to btn would never fire because btnInner stops propagation. (F5)
      let bubbleTimer = 0
      const dismiss = () => {
        if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = 0 }
        bubble.remove()
        chrome.storage.local.set({ stylesnap_onboarded: true })
        btnInner?.removeEventListener('click', dismiss)
      }
      btnInner?.addEventListener('click', dismiss)
      // Auto-dismiss after 8s (cleared if dismissed earlier)
      bubbleTimer = window.setTimeout(dismiss, 8000)
    })

    // NOT auto-activating any mode on page load — user must click to activate
   } finally {
     _fbInitializing = false
   }
  })
}

