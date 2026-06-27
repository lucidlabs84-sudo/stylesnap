/** Floating action button + onboarding bubble + drag/resize. */
import { $$, stAppend } from './ui'
import { S, isActive, FLOATING_BTN_ID } from './state'
import { detectLang, translations } from '@/lib/i18n-core'
import { setInspectMode, updateModeUI } from './index'


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
      const pos = res.stylesnap_btn_pos
      // Only honor a stored position if it's a sane, on-screen value — a stale or
      // corrupt value would otherwise push the button far from the corner.
      const padding = 10, btnSize = 44
      const maxR = window.innerWidth - btnSize - padding
      const maxB = window.innerHeight - btnSize - padding
      if (pos && typeof pos.right === 'number' && typeof pos.bottom === 'number'
          && pos.right >= 0 && pos.bottom >= 0 && pos.right <= maxR && pos.bottom <= maxB) {
        posCustomized = true
        btn.style.setProperty('right', `${pos.right}px`, 'important')
        btn.style.setProperty('bottom', `${pos.bottom}px`, 'important')
      }
      // else: keep the default bottom-right (24/24) from SHADOW_FLOATING_BTN_CSS
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
        background: 'linear-gradient(135deg,var(--ss-primary),#8b5cf6)',
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

