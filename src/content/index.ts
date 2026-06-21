/**
 * Content Script
 * Injected into every page. Handles hover detection, CSS extraction,
 * element highlighting, and design token scanning.
 */

import './overlay.css'

import { parseElement, extractComponentCSS, extractComponentHTML } from '@/lib/css-extractor'
import { extractDesignTokens } from '@/lib/token-extractor'
import { checkElementAccessibility } from '@/lib/accessibility-checker'
import { detectLang, translations } from '@/lib/i18n-core'
import type { ParsedCSS } from '@/shared/types'

// ─── Comparison mode stubs (not yet implemented) ─────
function removeCompareHighlight() {}
function hideCompareTooltip() {}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function highlightCompareElement(_el: Element | null) {}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function showCompareTooltip(_el: Element | null, _x?: number, _y?: number) {}

// ─── State ────────────────────────────────────────────────────────────

/**
 * inspectMode:
 *   0 = Off
 *   1 = Inspect (hover highlight + CSS overlay)
 *   2 = Guidelines (crosshairs)
 *   3 = Grid (all-element outlines)
 */
let inspectMode = 0
let lastMode = 0           // 上次使用的模式，仅用于 UI 提示，不自动激活
let autoOpenSidePanel = true // 点击浮动球进入检测模式时是否同时打开侧边栏
let lastHighlighted: Element | null = null
let lockedElement: Element | null = null

// derived helpers
let sidePanelOpen = false
const isActive = () => inspectMode > 0
const assistMode = () => (inspectMode >= 2 ? inspectMode - 1 : 0) // 0=off, 1=lines, 2=grid

const OVERLAY_ID = 'stylesnap-overlay'
const HIGHLIGHT_CLASS = 'stylesnap-highlight'
const LOCKED_CLASS = 'stylesnap-locked'

// ─── Mode icon mapping ────────────────────────────────────────────────
const MODE_ICON_SVG = [
  // 0: Off
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
  // 1: Inspect
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
  // 2: Guidelines
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
  // 3: Grid
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`,
] as const

const MODE_BADGE_COLOR = ['#5F5E5A', '#534AB7', '#0F6E56', '#185FA5'] as const

function updateModeUI() {
  // body class for overlay modes
  document.body.classList.remove('stylesnap-mode-guidelines', 'stylesnap-mode-grid')
  if (inspectMode === 2) document.body.classList.add('stylesnap-mode-guidelines')
  else if (inspectMode === 3) document.body.classList.add('stylesnap-mode-grid')

  // floating button state
  const btn = document.getElementById(FLOATING_BTN_ID)
  if (!btn) return

  // active ring animation
  if (inspectMode > 0) btn.classList.add('is-active')
  else btn.classList.remove('is-active')

  // corner badge on main ball
  const badge = btn.querySelector('.stylesnap-mode-badge') as HTMLElement | null
  if (badge) {
    badge.innerHTML = inspectMode > 0 ? MODE_ICON_SVG[inspectMode] : ''
    badge.style.background = inspectMode > 0 ? MODE_BADGE_COLOR[inspectMode] : 'transparent'
    badge.style.border = inspectMode === 0 ? '1.5px solid rgba(255,255,255,0.25)' : 'none'
  }

  // mode button group: highlight the active one, hint the last used one
  const modeBtns = btn.querySelectorAll('.stylesnap-mode-btn')
  modeBtns.forEach((b) => {
    const mode = parseInt((b as HTMLElement).dataset.mode || '0', 10)
    b.classList.toggle('is-active', mode === inspectMode)
    b.classList.toggle('is-preferred', mode === lastMode && inspectMode === 0)
  })

  // guides
  const target = lockedElement || lastHighlighted
  if (target) updateGuides(target.getBoundingClientRect())
}

// ─── Inspector activation/deactivation ─────────────────────────────────

function applyInspectorListeners(add: boolean) {
  const method = add ? 'addEventListener' : 'removeEventListener'
  document.documentElement[method]('mousemove', onMouseMove as EventListener, true)
  document.documentElement[method]('click', onClick as EventListener, true)
  document.documentElement[method]('keydown', onKeyDown as EventListener, true)
  document.documentElement[method]('scroll', onScroll as EventListener, true)
}

function setInspectMode(newMode: number) {
  const wasActive = isActive()
  inspectMode = newMode
  const nowActive = isActive()

  // remember last used mode (for UI hint on next page load)
  if (newMode > 0) lastMode = newMode

  if (!wasActive && nowActive) {
    initGuides()
    applyInspectorListeners(true)
  } else if (wasActive && !nowActive) {
    applyInspectorListeners(false)
    unlockElement()
    removeHighlight()
    hideOverlay()
  }

  updateModeUI()

  // persist
  chrome.storage.local.get(['stylesnap_settings'], (res) => {
    const s = res.stylesnap_settings || {}
    s.inspectMode = inspectMode
    if (newMode > 0) s.lastUsedMode = newMode
    chrome.storage.local.set({ stylesnap_settings: s })
  })
}

// ─── Guides ───────────────────────────────────────────────────────────

function initGuides() {
  const ids = ['stylesnap-guide-t', 'stylesnap-guide-b', 'stylesnap-guide-l', 'stylesnap-guide-r']
  ids.forEach(id => {
    if (!document.getElementById(id)) {
      const el = document.createElement('div')
      el.id = id
      el.className = 'stylesnap-guide'
      el.setAttribute('data-stylesnap', 'true')
      document.body.appendChild(el)
    }
  })
}

function updateGuides(rect: DOMRect) {
  if (assistMode() !== 1) return
  const t = document.getElementById('stylesnap-guide-t')
  const b = document.getElementById('stylesnap-guide-b')
  const l = document.getElementById('stylesnap-guide-l')
  const r = document.getElementById('stylesnap-guide-r')
  if (t && b && l && r) {
    t.style.top = `${rect.top}px`
    b.style.top = `${rect.bottom}px`
    l.style.left = `${rect.left}px`
    r.style.left = `${rect.right}px`
  }
}

// ─── Overlay UI ───────────────────────────────────────────────────────

function getOrCreateOverlay(): HTMLElement {
  let overlay = document.getElementById(OVERLAY_ID)
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = OVERLAY_ID
    overlay.setAttribute('data-stylesnap', 'true')
    chrome.storage.local.get(['language'], (res) => {
      overlay!.setAttribute('data-lang', res.language || 'en')
    })
    ;(document.documentElement || document.body).appendChild(overlay)
  }
  return overlay
}

function showOverlay(el: Element, parsedCSS: ParsedCSS) {
  const overlay = getOrCreateOverlay()
  const rect = el.getBoundingClientRect()

  const { styles, tailwindClasses = [], tailwindMatchRate = 0 } = parsedCSS
  const tailwindStr = tailwindClasses.slice(0, 8).join(' ') + (tailwindClasses.length > 8 ? ' …' : '')
  const matchPct = Math.round(tailwindMatchRate * 100)

  // ─── Accessibility check ─────────────────────────────
  const a11yIssues = checkElementAccessibility(el)
  let a11yHTML = ''
  if (a11yIssues.length > 0) {
    const items = a11yIssues.map(issue => {
      const icon = issue.severity === 'error' ? '❌' : '⚠️'
      const detail = issue.contrastRatio ? ` (${issue.contrastRatio.toFixed(2)}:1, ${issue.wcagLevel})` : ''
      return `<div class="ss-a11y-item ss-a11y-${issue.severity}">${icon} ${issue.message}${detail}</div>`
    }).join('')
    a11yHTML = `\n<div class="ss-a11y"><span class="ss-section-title">♿ Accessibility</span>\n<div class="ss-a11y-list">${items}</div>\n</div>`
  }

  const cssPreview = Object.entries(styles)
    .slice(0, 8)
    .map(([k, v]) => `<span class="ss-prop">${k}:</span> <span class="ss-val">${v}</span>`)
    .join('\n')

  // ─── Responsive styles (responsiveStyles) ───
  let responsiveHTML = ''
  if (parsedCSS.responsiveStyles) {
    const lines: string[] = []
    for (const [query, props] of Object.entries(parsedCSS.responsiveStyles)) {
      lines.push(`<span class="ss-media">@media ${query}</span> {`)
      for (const [k, v] of Object.entries(props)) {
        lines.push(`  <span class="ss-prop">${k}:</span> <span class="ss-val">${v}</span>`)
      }
      lines.push(`}`)
    }
    if (lines.length > 0) {
      responsiveHTML = `\n<div class="ss-responsive"><span class="ss-section-title">📱 Responsive</span>\n<pre class="ss-css">${lines.join('\n')}</pre>\n</div>`
    }
  }

  // ─── Interaction styles (interactionStyles) ───
  let interactionHTML = ''
  if (parsedCSS.interactionStyles) {
    const lines: string[] = []
    for (const [pseudo, props] of Object.entries(parsedCSS.interactionStyles)) {
      if (!props) continue
      lines.push(`<span class="ss-pseudo">${pseudo}</span> {`)
      for (const [k, v] of Object.entries(props)) {
        lines.push(`  <span class="ss-prop">${k}:</span> <span class="ss-val">${v}</span>`)
      }
      lines.push(`}`)
    }
    if (lines.length > 0) {
      interactionHTML = `\n<div class="ss-pseudo"><span class="ss-section-title">🖱️ Interaction</span>\n<pre class="ss-css">${lines.join('\n')}</pre>\n</div>`
    }
  }

  overlay.innerHTML = `
    <div class="ss-header">
      <span class="ss-tag">${el.tagName.toLowerCase()}</span>
      <span class="ss-dim">${Math.round(rect.width)}×${Math.round(rect.height)}</span>
      <span class="ss-match">TW ${matchPct}%</span>
      <button class="ss-edit-btn" title="Edit CSS">✏️</button>
    </div>
    ${tailwindStr ? `<div class="ss-tw">${tailwindStr}</div>` : ''}
    <pre class="ss-css">${cssPreview}</pre>${responsiveHTML}${interactionHTML}${a11yHTML}
    <div class="ss-edit-actions" style="display:none;">
      <button class="ss-cancel-btn">Cancel</button>
      <button class="ss-apply-btn">Apply</button>
    </div>
  `

  overlay.style.setProperty('display', 'block', 'important')
  const overlayRect = overlay.getBoundingClientRect()
  const overlayWidth = overlayRect.width || 320
  const overlayHeight = overlayRect.height || 150

  let top = rect.bottom + 4
  let left = rect.left
  overlay.style.setProperty('transform', 'none', 'important')

  if (rect.bottom + overlayHeight + 10 > window.innerHeight) {
    top = rect.top - overlayHeight - 4
    if (top < 0) top = window.innerHeight - overlayHeight - 10
  }

  const maxLeft = window.innerWidth - overlayWidth - 10
  left = Math.max(10, Math.min(left, maxLeft))

  overlay.style.setProperty('top', `${top}px`, 'important')
  overlay.style.setProperty('left', `${left}px`, 'important')

  // Edit mode button events — use addEventListener so they survive across worlds
  const bindClick = (sel: string, fn: () => void) => {
    const b = overlay.querySelector(sel) as HTMLElement | null
    if (b) b.addEventListener('click', (ev) => { ev.stopPropagation(); fn() })
  }
  bindClick('.ss-edit-btn', () => enterEditMode())
  bindClick('.ss-cancel-btn', () => cancelEdit())
  bindClick('.ss-apply-btn', () => applyEdits())
}

function hideOverlay() {
  const overlay = document.getElementById(OVERLAY_ID)
  if (overlay) overlay.style.setProperty('display', 'none', 'important')
}

// ─── Edit mode ─────────────────────────────────────────────────────
let isEditMode = false

function enterEditMode() {
  if (isEditMode) return
  isEditMode = true

  const overlay = document.getElementById(OVERLAY_ID)
  if (!overlay) return

  const cssPre = overlay.querySelector('.ss-css') as HTMLElement | null
  if (!cssPre) return

  const currentCSS = cssPre.textContent || ''

  // Create textarea
  const textarea = document.createElement('textarea')
  textarea.className = 'ss-edit-textarea'
  textarea.value = currentCSS

  // Replace pre with textarea
  cssPre.style.display = 'none'
  cssPre.parentNode?.insertBefore(textarea, cssPre.nextSibling)

  // Show action buttons
  const actions = overlay.querySelector('.ss-edit-actions') as HTMLElement | null
  if (actions) actions.style.display = 'flex'
}

function applyEdits() {
  const overlay = document.getElementById(OVERLAY_ID)
  if (!overlay) return

  const textarea = overlay.querySelector('.ss-edit-textarea') as HTMLTextAreaElement | null
  const cssPre = overlay.querySelector('.ss-css') as HTMLElement | null
  const actions = overlay.querySelector('.ss-edit-actions') as HTMLElement | null

  if (!textarea || !cssPre) return

  const newCSS = textarea.value
  cssPre.textContent = newCSS
  cssPre.style.display = 'block'
  textarea.remove()

  if (actions) actions.style.display = 'none'
  isEditMode = false

  // Apply to locked element
  if (lockedElement) {
    const props = newCSS.split('\n').map(l => l.trim()).filter(l => l && l !== '{' && l !== '}')
    props.forEach(line => {
      const idx = line.indexOf(':')
      if (idx > 0) {
        const prop = line.substring(0, idx).trim()
        const val = line.substring(idx + 1).replace(';', '').trim()
        if (prop && val) {
          ;(lockedElement as HTMLElement).style.setProperty(prop, val)
        }
      }
    })
    showToast('CSS applied!')
  }
}

function cancelEdit() {
  const overlay = document.getElementById(OVERLAY_ID)
  if (!overlay) return

  const textarea = overlay.querySelector('.ss-edit-textarea') as HTMLTextAreaElement | null
  const cssPre = overlay.querySelector('.ss-css') as HTMLElement | null
  const actions = overlay.querySelector('.ss-edit-actions') as HTMLElement | null

  if (cssPre) cssPre.style.display = 'block'
  if (textarea) textarea.remove()
  if (actions) actions.style.display = 'none'
  isEditMode = false
}

function highlightElement(el: Element) {
  if (lockedElement && el !== lockedElement) return
  removeHighlight()
  el.classList.add(HIGHLIGHT_CLASS)
  lastHighlighted = el
}

function removeHighlight() {
  if (lastHighlighted && lastHighlighted !== lockedElement) {
    lastHighlighted.classList.remove(HIGHLIGHT_CLASS)
    lastHighlighted = null
  }
}

function lockElement(el: Element) {
  if (lockedElement) lockedElement.classList.remove(LOCKED_CLASS)
  lockedElement = el
  el.classList.add(LOCKED_CLASS)
  el.classList.remove(HIGHLIGHT_CLASS)
  lastHighlighted = null
  const overlay = document.getElementById(OVERLAY_ID)
  if (overlay) overlay.classList.add('ss-interactive')
}

function unlockElement() {
  if (lockedElement) {
    lockedElement.classList.remove(LOCKED_CLASS)
    lockedElement = null
  }
  const overlay = document.getElementById(OVERLAY_ID)
  if (overlay) overlay.classList.remove('ss-interactive')
}

// ─── Copy CSS ─────────────────────────────────────────────────────────

function copyLockedCSS() {
  if (!lockedElement) {
    showToast('No element selected — click an element first')
    return
  }
  const parsedCSS = parseElement(lockedElement)
  const lines: string[] = []

  // Base styles
  for (const [k, v] of Object.entries(parsedCSS.styles)) {
    lines.push(`  ${k}: ${v};`)
  }

  let output = `${lockedElement.tagName.toLowerCase()} {\n${lines.join('\n')}\n}`

  // Responsive styles: Record<string, CSSPropertyMap>
  if (parsedCSS.responsiveStyles) {
    for (const [query, props] of Object.entries(parsedCSS.responsiveStyles)) {
      const lines = Object.entries(props)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n')
      output += `\n\n@media ${query} {\n${lines}\n}`
    }
  }

  // Interaction (pseudo-class) styles: { hover?: CSSPropertyMap; focus?: CSSPropertyMap; active?: CSSPropertyMap }
  if (parsedCSS.interactionStyles) {
    for (const [pseudo, props] of Object.entries(parsedCSS.interactionStyles)) {
      if (!props) continue
      const lines = Object.entries(props)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n')
      output += `\n\n${pseudo} {\n${lines}\n}`
    }
  }

  navigator.clipboard.writeText(output).then(() => {
    showToast('CSS copied!')
  }).catch(() => {
    showToast('Copy failed')
  })
}

// ─── Event handlers ───────────────────────────────────────────────────

function onMouseMove(e: MouseEvent) {
  if (!isActive()) return
  const el = document.elementFromPoint(e.clientX, e.clientY)

  // Bug 5: iframe cross-origin check – skip elements inside iframes
  if (el && el.ownerDocument !== document) return
  if (!el || el.closest('[data-stylesnap]')) {
    removeCompareHighlight()
    hideCompareTooltip()
    return
  }

  // Comparison mode: highlight hovered element while locked
  if (lockedElement) {
    if (el === lockedElement) {
      removeCompareHighlight()
      hideCompareTooltip()
      return
    }
    highlightCompareElement(el)
    showCompareTooltip(el, e.clientX, e.clientY)
    return
  }

  if (el === lastHighlighted) return

  removeCompareHighlight()
  hideCompareTooltip()
  highlightElement(el)
  const parsedCSS = parseElement(el)
  showOverlay(el, parsedCSS)
  updateGuides(el.getBoundingClientRect())

  chrome.runtime.sendMessage({
    type: 'ELEMENT_HOVERED',
    payload: {
      parsedCSS,
      tagName: el.tagName.toLowerCase(),
      id: el.id,
      classList: Array.from(el.classList).filter(c => !c.startsWith('stylesnap-')),
      rect: { width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height), top: Math.round(el.getBoundingClientRect().top), left: Math.round(el.getBoundingClientRect().left) },
    },
  }).catch(() => {})
}

function onClick(e: MouseEvent) {
  if (!isActive()) return
  const el = document.elementFromPoint(e.clientX, e.clientY)

  if (el && el.closest('#' + OVERLAY_ID)) return
  if (el && (el.closest('[data-stylesnap]') || el.closest('#' + FLOATING_BTN_ID))) return

  e.preventDefault()
  e.stopPropagation()

  if (!el || el === document.documentElement || el === document.body) {
    if (lockedElement) {
      unlockElement()
      chrome.runtime.sendMessage({ type: 'ELEMENT_UNLOCKED' }).catch(() => {})
      hideOverlay()
    }
    return
  }

  if (lockedElement) {
    unlockElement()
    chrome.runtime.sendMessage({ type: 'ELEMENT_UNLOCKED' }).catch(() => {})
    onMouseMove(e)
    return
  }

  lockElement(el)

  const parsedCSS = parseElement(el)
  const componentHTML = extractComponentHTML(el, 3)
  const componentCSS = extractComponentCSS(el, 3)

  showOverlay(el, parsedCSS)
  updateGuides(el.getBoundingClientRect())

  chrome.runtime.sendMessage({
    type: 'ELEMENT_CLICKED',
    payload: {
      parsedCSS,
      tagName: el.tagName.toLowerCase(),
      id: el.id,
      classList: Array.from(el.classList).filter(c => !c.startsWith('stylesnap-')),
      rect: { width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height), top: Math.round(el.getBoundingClientRect().top), left: Math.round(el.getBoundingClientRect().left) },
      componentHTML,
      componentCSS,
    },
  }).catch(() => {})
}

function onKeyDown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable) return

  if (isActive() && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault()
    e.stopPropagation()
    // cycle only the visual assist layer (2/3), keep inspect on
    if (inspectMode === 1) setInspectMode(2)
    else if (inspectMode === 2) setInspectMode(3)
    else if (inspectMode === 3) setInspectMode(1)
    const labels = ['Off', 'Inspect', 'Guidelines', 'Grid']
    showToast(`Mode: ${labels[inspectMode]}`)
    const target = lockedElement || lastHighlighted
    if (target) updateGuides(target.getBoundingClientRect())
    return
  }

  if (e.key === 'Escape' && isActive()) {
    e.preventDefault()
    e.stopPropagation()
    // Priority: close side panel first, then unlock, then exit inspect mode
    if (sidePanelOpen) {
      sidePanelOpen = false
      const panel = document.getElementById('stylesnap-floating-panel')
      if (panel) hidePanel(panel)
      chrome.runtime.sendMessage({ type: 'TOGGLE_SIDE_PANEL' }).catch(() => {})
      return
    }
    if (lockedElement) {
      unlockElement()
      removeCompareHighlight()
      hideCompareTooltip()
      chrome.runtime.sendMessage({ type: 'ELEMENT_UNLOCKED' }).catch(() => {})
      hideOverlay()
      return
    }
    setInspectMode(0)
    chrome.runtime.sendMessage({ type: 'DISABLE_INSPECTOR' }).catch(() => {})
  }
}

// ─── Toast Notification ────────────────────────────────────────────────

let toastTimeout: number | null = null
function showToast(message: string) {
  let toast = document.getElementById('stylesnap-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'stylesnap-toast'
    toast.setAttribute('data-stylesnap', 'true')
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '80px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(15, 23, 42, 0.9)',
      color: '#fff',
      padding: '8px 16px',
      borderRadius: '8px',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      fontWeight: '500',
      zIndex: '2147483647',
      pointerEvents: 'none',
      transition: 'opacity 0.2s ease',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      border: '1px solid rgba(255,255,255,0.1)'
    })
    document.body.appendChild(toast)
  }
  toast.textContent = message
  toast.style.opacity = '1'
  if (toastTimeout) window.clearTimeout(toastTimeout)
  toastTimeout = window.setTimeout(() => {
    if (toast) toast.style.opacity = '0'
  }, 2000)
}

function onScroll() {
  if (!isActive()) return
  const target = lockedElement || lastHighlighted
  if (target) updateGuides(target.getBoundingClientRect())
}

// ─── Floating Button UI ────────────────────────────────────────────────

const FLOATING_BTN_ID = 'stylesnap-floating-btn'

// Panel hover persistence: use a timeout so the panel doesn't vanish
// when the mouse briefly leaves the button while moving toward the panel
let panelHideTimer: number | null = null

function showPanel(panel: HTMLElement) {
  if (panelHideTimer) { clearTimeout(panelHideTimer); panelHideTimer = null }
  panel.style.setProperty('opacity', '1', 'important')
  panel.style.setProperty('visibility', 'visible', 'important')
  panel.style.setProperty('transform', 'scale(1) translateX(0)', 'important')
  panel.style.setProperty('pointer-events', 'auto', 'important')
}

function hidePanel(panel: HTMLElement) {
  panelHideTimer = window.setTimeout(() => {
    panel.style.setProperty('opacity', '0', 'important')
    panel.style.setProperty('visibility', 'hidden', 'important')
    panel.style.setProperty('transform', 'scale(0.9) translateX(4px)', 'important')
    panel.style.setProperty('pointer-events', 'none', 'important')
    panelHideTimer = null
  }, 350) // 350ms grace period
}

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
      z-index: 2147483647 !important;
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
      opacity: 0.45 !important;
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
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.45) !important;
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

    /* ── Spinning ring (active state) ── */
    #stylesnap-floating-btn-ring {
      position: absolute !important;
      top: 0 !important; left: 0 !important;
      width: 100% !important; height: 100% !important;
      border-radius: 50% !important;
      overflow: hidden !important;
      z-index: 1 !important;
      pointer-events: none !important;
    }
    #stylesnap-floating-btn-ring::before {
      content: '' !important;
      position: absolute !important;
      top: 50% !important; left: 50% !important;
      width: 140% !important; height: 140% !important;
      background: conic-gradient(transparent, #6ee7b7, transparent 30%) !important;
      transform-origin: center center !important;
      animation: stylesnap-btn-rotate 2s linear infinite !important;
      display: none !important;
    }
    #stylesnap-floating-btn.is-active #stylesnap-floating-btn-ring::before {
      display: block !important;
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

    /* ── Floating panel ── */
    #stylesnap-floating-panel {
      position: absolute !important;
      right: 52px !important;
      bottom: 0 !important;
      transform: scale(0.9) translateX(4px) !important;
      transform-origin: right bottom !important;
      background: rgba(15, 23, 42, 0.96) !important;
      border: 1px solid rgba(255,255,255,0.1) !important;
      border-radius: 14px !important;
      padding: 6px !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 2px !important;
      opacity: 0 !important;
      visibility: hidden !important;
      transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1) !important;
      box-shadow: 0 12px 28px -6px rgba(0,0,0,0.4), 0 4px 8px rgba(0,0,0,0.15) !important;
      z-index: 1 !important;
      pointer-events: none !important;
      white-space: nowrap !important;
      backdrop-filter: blur(8px) !important;
    }
    /* hover bridge: wider invisible area so panel doesn't disappear */
    #stylesnap-floating-panel::after {
      content: '' !important;
      position: absolute !important;
      right: -20px !important;
      bottom: -8px !important;
      top: -8px !important;
      width: 30px !important;
      background: transparent !important;
    }

    /* ── Panel items ── */
    .stylesnap-panel-item {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 34px !important;
      height: 34px !important;
      border-radius: 9px !important;
      background: transparent !important;
      color: #94a3b8 !important;
      border: none !important;
      cursor: pointer !important;
      transition: all 0.12s !important;
      position: relative !important;
    }
    .stylesnap-panel-item:hover {
      background: rgba(255,255,255,0.08) !important;
      color: #e2e8f0 !important;
    }
    .stylesnap-panel-item svg {
      width: 16px !important;
      height: 16px !important;
    }
    .stylesnap-panel-item:active {
      transform: scale(0.92) !important;
    }

    /* ── Mode button group (vertical column) ── */
    .stylesnap-mode-group {
      display: flex !important;
      flex-direction: column !important;
      gap: 2px !important;
      padding: 2px !important;
      background: rgba(255,255,255,0.04) !important;
      border-radius: 10px !important;
    }
    .stylesnap-mode-btn {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 28px !important;
      height: 28px !important;
      border-radius: 7px !important;
      background: transparent !important;
      color: #64748b !important;
      border: none !important;
      cursor: pointer !important;
      transition: all 0.12s !important;
      position: relative !important;
    }
    .stylesnap-mode-btn:hover {
      background: rgba(255,255,255,0.06) !important;
      color: #94a3b8 !important;
    }
    .stylesnap-mode-btn.is-active {
      background: rgba(99,102,241,0.2) !important;
      color: #e2e8f0 !important;
      box-shadow: 0 0 0 1px rgba(99,102,241,0.3) !important;
    }
    .stylesnap-mode-btn.is-active.mode-inspect { color: #818cf8 !important; background: rgba(99,102,241,0.15) !important; box-shadow: 0 0 0 1px rgba(99,102,241,0.3) !important; }
    .stylesnap-mode-btn.is-active.mode-guidelines { color: #34d399 !important; background: rgba(16,185,129,0.12) !important; box-shadow: 0 0 0 1px rgba(16,185,129,0.3) !important; }
    .stylesnap-mode-btn.is-active.mode-grid { color: #38bdf8 !important; background: rgba(56,189,248,0.12) !important; box-shadow: 0 0 0 1px rgba(56,189,248,0.3) !important; }
    /* preferred (last used) — subtle hint, NOT active */
    .stylesnap-mode-btn.is-preferred {
      box-shadow: 0 0 0 1.5px rgba(255,255,255,0.25) !important;
    }
    .stylesnap-mode-btn.is-preferred::after {
      content: '' !important;
      position: absolute !important;
      top: 3px !important;
      right: 3px !important;
      width: 5px !important;
      height: 5px !important;
      border-radius: 50% !important;
      background: rgba(255,255,255,0.45) !important;
    }
    .stylesnap-mode-btn svg {
      width: 14px !important;
      height: 14px !important;
    }
    .stylesnap-mode-btn:active {
      transform: scale(0.88) !important;
    }

    /* ── Panel divider ── */
    .stylesnap-panel-divider {
      height: 1px !important;
      background: rgba(255,255,255,0.08) !important;
      margin: 2px 6px !important;
    }

    /* ── Compare highlight (Bug 3) ── */
    .stylesnap-compare-highlight {
      outline: 2px dashed #fbbf24 !important;
      outline-offset: -1px !important;
      transition: outline 0.1s ease !important;
      position: relative !important;
    }
    .stylesnap-compare-highlight::after {
      content: '↔ Compare' !important;
      position: absolute !important;
      top: -20px !important;
      left: 0 !important;
      background: rgba(251,191,36,0.9) !important;
      color: #0f172a !important;
      font-size: 10px !important;
      font-weight: 700 !important;
      padding: 2px 6px !important;
      border-radius: 4px !important;
      pointer-events: none !important;
      z-index: 2147483646 !important;
    }

    /* ── Rotate animation ── */
    @keyframes stylesnap-btn-rotate {
      0% { transform: translate(-50%, -50%) rotate(0deg); }
      100% { transform: translate(-50%, -50%) rotate(360deg); }
    }
  `
  document.head.appendChild(style)
}

async function initFloatingButton() {
  chrome.storage.local.get(['stylesnap_settings'], async (res) => {
    const s = res.stylesnap_settings || {}
    if (s.showFloatingBtn === false) {
      const existing = document.getElementById(FLOATING_BTN_ID)
      if (existing) existing.remove()
      return
    }
    if (document.getElementById(FLOATING_BTN_ID)) return

    const lang = await detectLang()
    const t = translations[lang] || translations.en

    // restore settings
    if (s.lastUsedMode !== undefined && s.lastUsedMode !== 0) {
      lastMode = s.lastUsedMode as number
    }
    if (s.autoOpenSidePanel !== undefined) {
      autoOpenSidePanel = s.autoOpenSidePanel as boolean
    }
    inspectMode = 0  // always start inactive; user must click to activate

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
      <div id="stylesnap-floating-panel">
        <div class="stylesnap-mode-group">
          <button class="stylesnap-mode-btn mode-inspect" data-mode="1"
            title="Inspect">
            ${MODE_ICON_SVG[1]}
          </button>
          <button class="stylesnap-mode-btn mode-guidelines" data-mode="2"
            title="Guidelines">
            ${MODE_ICON_SVG[2]}
          </button>
          <button class="stylesnap-mode-btn mode-grid" data-mode="3"
            title="Grid">
            ${MODE_ICON_SVG[3]}
          </button>
        </div>
        <div class="stylesnap-panel-divider"></div>
        <button class="stylesnap-panel-item" id="stylesnap-action-copy"
          title="Copy CSS of selected element">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
      </div>
    `

    // ─── Drag ───
    let isDragging = false
    let hasMoved = false
    let startX = 0, startY = 0
    let initialRight = 24, initialBottom = 24

    chrome.storage.local.get(['stylesnap_btn_pos'], (res) => {
      if (res.stylesnap_btn_pos) {
        btn.style.setProperty('right', `${res.stylesnap_btn_pos.right}px`, 'important')
        btn.style.setProperty('bottom', `${res.stylesnap_btn_pos.bottom}px`, 'important')
      }
    })

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
      e.preventDefault()
    })

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true
      if (hasMoved) {
        let newRight = initialRight - dx
        let newBottom = initialBottom - dy
        const padding = 10, btnSize = 44
        newRight = Math.max(padding, Math.min(newRight, window.innerWidth - btnSize - padding))
        newBottom = Math.max(padding, Math.min(newBottom, window.innerHeight - btnSize - padding))
        btn.style.setProperty('right', `${newRight}px`, 'important')
        btn.style.setProperty('bottom', `${newBottom}px`, 'important')
      }
    })

    window.addEventListener('mouseup', () => {
      if (!isDragging) return
      isDragging = false
      btn.classList.remove('is-dragging')
      btn.style.setProperty('cursor', 'pointer', 'important')
      btn.style.setProperty('transition', 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s, opacity 0.3s ease', 'important')
      if (hasMoved) {
        const rect = btn.getBoundingClientRect()
        chrome.storage.local.set({
          stylesnap_btn_pos: {
            right: window.innerWidth - rect.right,
            bottom: window.innerHeight - rect.bottom
          }
        })
      }
    })

    // ─── Resize boundary clamp ───
    window.addEventListener('resize', () => {
      if (!document.getElementById(FLOATING_BTN_ID)) return
      const btn = document.getElementById(FLOATING_BTN_ID)!
      const rect = btn.getBoundingClientRect()
      const padding = 10, btnSize = 44
      let right = window.innerWidth - rect.right
      let bottom = window.innerHeight - rect.bottom
      right = Math.max(padding, Math.min(right, window.innerWidth - btnSize - padding))
      bottom = Math.max(padding, Math.min(bottom, window.innerHeight - btnSize - padding))
      btn.style.setProperty('right', `${right}px`, 'important')
      btn.style.setProperty('bottom', `${bottom}px`, 'important')
      chrome.storage.local.set({
        stylesnap_btn_pos: { right, bottom }
      })
    })

    // ─── Panel hover persistence ───
    const panel = btn.querySelector('#stylesnap-floating-panel') as HTMLElement | null

    // Show panel on main button hover
    btn.addEventListener('mouseenter', () => {
      if (panel) showPanel(panel)
    })
    btn.addEventListener('mouseleave', () => {
      if (panel) hidePanel(panel)
    })
    // Keep panel visible while hovering over it
    if (panel) {
      panel.addEventListener('mouseenter', () => showPanel(panel))
      panel.addEventListener('mouseleave', () => hidePanel(panel))
    }

    // Bug 2: Touch support – toggle panel on long-press / tap
    let touchTimer: number | null = null
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault()
      touchTimer = window.setTimeout(() => {
        if (panel) {
          const isVisible = panel.style.opacity === '1'
          if (isVisible) {
            hidePanel(panel)
            sidePanelOpen = false
          } else {
            showPanel(panel)
            sidePanelOpen = true
          }
        }
      }, 300) // long-press to toggle
    }, { passive: false })
    btn.addEventListener('touchend', () => {
      if (touchTimer) { clearTimeout(touchTimer); touchTimer = null }
    }, { passive: true })
    btn.addEventListener('touchmove', () => {
      if (touchTimer) { clearTimeout(touchTimer); touchTimer = null }
    }, { passive: true })

    // ─── Button actions ───
    const btnInner = btn.querySelector('#stylesnap-floating-btn-inner')

    // Main ball click → toggle inspect mode (restore last used mode)
    btnInner?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (hasMoved) return

      if (!isActive()) {
        // Enter inspect mode: restore last used mode (default to 1 = Inspect)
        const modeToRestore = (lastMode > 0 ? lastMode : 1)
        setInspectMode(modeToRestore)
        showToast(`Mode: ${['Off', 'Inspect', 'Guidelines', 'Grid'][modeToRestore]}`)

        // Show floating panel
        sidePanelOpen = true
        showPanel(panel!)

        // Open Chrome side panel if setting allows
        if (autoOpenSidePanel) {
          chrome.runtime.sendMessage({ type: 'TOGGLE_SIDE_PANEL' }, () => {
            if (chrome.runtime.lastError) {
              console.warn('Could not open side panel:', chrome.runtime.lastError.message)
            }
          })
        }
      } else {
        // Exit inspect mode
        setInspectMode(0)
        showToast('Inspector off')

        // Hide floating panel
        sidePanelOpen = false
        if (panel) hidePanel(panel)
        // NOTE: Chrome MV3 does not provide a reliable way to programmatically close
        // the side panel, so we do NOT send TOGGLE_SIDE_PANEL here.
      }
    })

    // Mode buttons → set mode directly
    const modeBtns = btn.querySelectorAll('.stylesnap-mode-btn')
    modeBtns.forEach((modeBtn) => {
      modeBtn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const mode = parseInt((modeBtn as HTMLElement).dataset.mode || '0', 10)
        setInspectMode(mode)
        const labels = ['Off', 'Inspect', 'Guidelines', 'Grid']
        showToast(`Mode: ${labels[mode]}`)
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      })
    })

    // Copy CSS
    const copyBtn = btn.querySelector('#stylesnap-action-copy')
    copyBtn?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      copyLockedCSS()
    })

    document.documentElement.appendChild(btn)

    // sync initial mode UI (inspectMode is always 0 on load; just render badge)
    updateModeUI()
    // NOT auto-activating any mode on page load — user must click to activate
  })
}

// Export for @crxjs/vite-plugin loader
export function onExecute(_args: { perf: { injectTime: number; loadTime: number } }) {
  // Re-initialize if needed (hot reload)
  if (!document.getElementById(FLOATING_BTN_ID)) {
    initFloatingButton()
  }
}



// ─── Message handling ─────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.language) {
      const lang = changes.language.newValue
      const overlay = document.getElementById(OVERLAY_ID)
      if (overlay) overlay.setAttribute('data-lang', lang || 'en')
    }

    if (changes.stylesnap_settings) {
      const newSettings = changes.stylesnap_settings.newValue
      if (newSettings) {
        // Handle floating button visibility toggle
        if (newSettings.showFloatingBtn !== undefined) {
          const btn = document.getElementById(FLOATING_BTN_ID)
          if (newSettings.showFloatingBtn) {
            if (!btn) initFloatingButton()
          } else {
            if (btn) btn.remove()
          }
        }

        // Sync autoOpenSidePanel setting
        if (newSettings.autoOpenSidePanel !== undefined) {
          autoOpenSidePanel = newSettings.autoOpenSidePanel
        }
      }
    }
  }
})

chrome.runtime.onMessage.addListener((message: { type: string; payload?: unknown }, _sender, sendResponse) => {
  switch (message.type) {
    case 'INIT_INSPECTOR':
      if (inspectMode === 0) setInspectMode(1)
      sendResponse({ ok: true })
      break

    case 'DISABLE_INSPECTOR':
      setInspectMode(0)
      sendResponse({ ok: true })
      break

    case 'EDIT_CSS': {
      const { selector, property, value } = message.payload as { selector: string; property: string; value: string }
      const targets = document.querySelectorAll(selector)
      targets.forEach(el => {
        (el as HTMLElement).style.setProperty(property, value)
      })
      sendResponse({ ok: true })
      break
    }

    case 'EXTRACT_TOKENS': {
      try {
        const tokens = extractDesignTokens()
        sendResponse({ tokens })
      } catch (e: unknown) {
        sendResponse({ error: (e as Error).message })
      }
      break
    }

    default:
      sendResponse({ error: 'Unknown message type' })
  }
  return true
})

// ─── Debug helpers (Chrome extension tester) ────────────────────────
;(window as any).debugShowOverlay = (targetSelector: string) => {
  const el = document.querySelector(targetSelector)
  if (!el) return 'element not found: ' + targetSelector
  const parsedCSS = parseElement(el as Element)
  showOverlay(el as Element, parsedCSS)
  return 'overlay shown for ' + targetSelector
}

;(window as any).debugInspectMode = () => inspectMode

