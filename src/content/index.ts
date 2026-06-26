/**
 * Content Script
 * Injected into every page. Handles hover detection, CSS extraction,
 * element highlighting, and design token scanning.
 */

import './overlay.css'

import { parseElement, extractComponentHTML, extractComponentCSS, formatCSS } from '@/lib/css-extractor'
import { extractDesignTokens } from '@/lib/token-extractor'
import { detectLang, translations, TranslationKey } from '@/lib/i18n-core'
import { SHADOW_FLOATING_BTN_CSS, SHADOW_HINT_BAR_CSS } from './shadow-styles'
// Instead of injecting into the global page context via vite/rollup, we inject overlay.css directly into Shadow DOM.
// We can use a raw import for Vite if we want the raw string, or simply append a link tag.
// For now, we will import it as raw string using vite's ?raw feature
import OVERLAY_CSS from './overlay.css?inline'

import { getLicenseStatus, activateLicenseKey, deactivateLicenseInstance, createCheckout } from '@/lib/license'
import type { ParsedCSS, UserSettings } from '@/shared/types'
import { DEFAULT_SETTINGS } from '@/shared/types'
import { submitFeedback } from '@/lib/feedback'
import { computePosition, flip, shift, offset, autoUpdate } from '@floating-ui/dom'

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
let lastHighlighted: Element | null = null
let lockedElement: Element | null = null
let compareMode = false    // Compare toggle — user must enable from panel
let _licenseIsPro = false   // cached license status

// Init: load cached license
getLicenseStatus().then(s => { _licenseIsPro = s.isPro })

// derived helpers
const isActive = () => inspectMode > 0 && !$$('stylesnap-settings-popup') && !$$('stylesnap-design-popup')
const assistMode = () => (inspectMode >= 2 ? inspectMode - 1 : 0) // 0=off, 1=lines, 2=grid

const OVERLAY_ID = 'stylesnap-overlay'
const HIGHLIGHT_CLASS = 'stylesnap-highlight'
const LOCKED_CLASS = 'stylesnap-locked'
const PREVIEW_CLASS = 'stylesnap-preview'
const FLOATING_BTN_ID = 'stylesnap-floating-btn'
const SHADOW_HOST_ID = 'stylesnap-root'

// ─── Shadow DOM isolation (prevents page CSS from polluting extension UI) ───
let _stShadow: ShadowRoot | null = null
function getStShadow(): ShadowRoot {
  if (_stShadow) return _stShadow
  const host = document.createElement('div')
  host.id = SHADOW_HOST_ID
  host.setAttribute('data-stylesnap', 'true')
  Object.assign(host.style, {
    position: 'fixed', top: '0', left: '0', width: '0', height: '0', zIndex: '9999990',
    overflow: 'visible',
  })
  document.body.appendChild(host)
  _stShadow = host.attachShadow({ mode: 'open' })
  const fbStyle = document.createElement('style')
  fbStyle.textContent = SHADOW_FLOATING_BTN_CSS + '\n' + SHADOW_HINT_BAR_CSS + '\n' + OVERLAY_CSS + '\n' +
    '@keyframes ss-bubble-pulse { 0%, 100% { transform: translateY(0); box-shadow: 0 4px 16px rgba(99,102,241,0.5); } 50% { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(99,102,241,0.7); } }'
  _stShadow.appendChild(fbStyle)
  return _stShadow
}
function stAppend(el: HTMLElement) { getStShadow().appendChild(el) }
function $$(id: string): HTMLElement | null {
  return (_stShadow ? _stShadow.getElementById(id) : null) || document.getElementById(id)
}

/**
 * Attach "click-outside (and optional Esc) to close" to a shadow-DOM panel,
 * with leak-proof cleanup: a MutationObserver tears down the document-level
 * listeners whenever the panel leaves the DOM — regardless of which path
 * removed it (close button, item click, mutual-exclusion, programmatic remove).
 * Uses composedPath() so clicks inside the shadow tree are correctly detected.
 * Returns a close() that removes the panel and runs onClose.
 */
function attachOutsideClose(
  panel: HTMLElement,
  opts: { onClose?: () => void; esc?: boolean; delay?: number } = {},
): () => void {
  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    document.removeEventListener('click', onClick)
    if (opts.esc) document.removeEventListener('keydown', onKey)
    obs.disconnect()
  }
  const close = () => {
    cleanup()
    if (panel.isConnected) panel.remove()
    opts.onClose?.()
  }
  const onClick = (ev: MouseEvent) => { if (!ev.composedPath().includes(panel)) close() }
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); close() } }
  // Auto-cleanup the moment the panel is detached, by any code path.
  const root = panel.getRootNode() as ShadowRoot | Document
  const obs = new MutationObserver(() => { if (!panel.isConnected) cleanup() })
  obs.observe(root, { childList: true, subtree: true })
  // Defer so the click that opened the panel doesn't immediately close it.
  setTimeout(() => {
    if (done) return
    document.addEventListener('click', onClick)
    if (opts.esc) document.addEventListener('keydown', onKey)
  }, opts.delay ?? 100)
  return close
}
// editMode removed — always per-line view with grouped categories
let _lastParsedCSS: ParsedCSS | null = null  // cached for compare/export
let _overlayCleanup: (() => void) | null = null  // Floating UI autoUpdate cleanup
let _overlayGen = 0  // generation counter to discard stale position updates
const _history: Array<{tag: string, selector: string, snippet: string, parsedCSS: ParsedCSS | null, timestamp: number}> = []

// Detect CSS color values
function isColorValue(val: string): boolean {
  if (!val) return false
  const v = val.trim().toLowerCase()
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return true
  if (/^rgb\(/.test(v) || /^rgba\(/.test(v)) return true
  if (/^hsl\(/.test(v) || /^hsla\(/.test(v)) return true
  const namedColors = ['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert']
  if (namedColors.includes(v)) return false
  // Use a dummy element to check if it's a valid CSS color
  if (CSS.supports('color', v)) return true
  return false
}

// HTML-escape user-supplied CSS values to prevent XSS when injecting into innerHTML
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Safe className accessor — SVG elements expose SVGAnimatedString (no .split/.replace) */
function classNameOf(el: Element): string {
  const cn = (el as HTMLElement).className
  return typeof cn === 'string' ? cn : (el.getAttribute('class') || '')
}

// Get color preview block HTML
function colorBlock(val: string): string {
  // Only pass through if it's a safe CSS color value; strip quotes and escape for style attr
  const safe = val.replace(/"/g, '').replace(/[<>]/g, '')
  return `<span class="ss-color-block" style="background:${safe}"></span> `
}

// ─── Display format preferences ────────────────────────────────────────
let _colorFormat: 'rgb' | 'hex' | 'hsl' = 'rgb'
let _shortenCSS = true
let _showSidePanel = true

function reloadFormatSettings() {
  chrome.storage.local.get(['stylesnap_settings'], (res) => {
    const s = res.stylesnap_settings || {}
    _colorFormat = s.colorFormat || 'rgb'
    _shortenCSS = s.shortenCSS !== false
    _showSidePanel = s.showSidePanel !== false
  })
}

function convertColor(value: string, format: 'rgb' | 'hex' | 'hsl'): string {
  if (format === 'rgb') return value
  const match = value.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s\/]+(\d*\.?\d+))?\)/i)
  if (!match) return value
  const r = parseInt(match[1]), g = parseInt(match[2]), b = parseInt(match[3])
  const a = match[4] !== undefined ? parseFloat(match[4]) : 1

  if (format === 'hex') {
    const ha = Math.round(a * 255).toString(16).padStart(2, '0')
    const hex = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`
    return a === 1 ? hex : hex + ha
  }

  if (format === 'hsl') {
    const rr = r / 255, gg = g / 255, bb = b / 255
    const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb)
    let h = 0, s = 0
    const l = (max + min) / 2
    if (max !== min) {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6
      else if (max === gg) h = ((bb - rr) / d + 2) / 6
      else h = ((rr - gg) / d + 4) / 6
    }
    h = Math.round(h * 360); s = Math.round(s * 100)
    if (a === 1) return `hsl(${h}, ${s}%, ${Math.round(l * 100)}%)`
    return `hsla(${h}, ${s}%, ${Math.round(l * 100)}%, ${a})`
  }
  return value
}

// ─── Shorten CSS (optimize displayed/copied values) ──────────────────

// Map hex → named colors (common ones only)
const HEX_TO_NAMED: Record<string, string> = {
  '#000000': 'black', '#ffffff': 'white', '#ff0000': 'red',
  '#00ff00': 'lime', '#0000ff': 'blue', '#ffff00': 'yellow',
  '#ff00ff': 'fuchsia', '#00ffff': 'aqua', '#808080': 'gray',
  '#c0c0c0': 'silver', '#800000': 'maroon', '#808000': 'olive',
  '#008000': 'green', '#800080': 'purple', '#008080': 'teal',
  '#000080': 'navy', '#ffa500': 'orange',
}

function shortenColor(value: string): string {
  for (const [hex, name] of Object.entries(HEX_TO_NAMED)) {
    if (value.toLowerCase() === hex || value.toLowerCase() === hex + 'ff') return name
  }
  // #ff0000 → #f00
  if (/^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/i.test(value)) return '#' + value[1] + value[3] + value[5]
  // #ff0000ff → #f00f
  if (/^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3([0-9a-f])\4$/i.test(value)) return '#' + value[1] + value[3] + value[5] + value[7]
  return value
}

function shortenValue(_prop: string, value: string): string {
  // 0px → 0
  if (/^0[a-z%]*$/i.test(value) && value !== '0') return '0'
  // Clean unnecessary precision: 12.000px → 12px
  const pm = value.match(/^([\d.]+)(px|em|rem|%|vh|vw|vmin|vmax)$/)
  if (pm) {
    const n = parseFloat(pm[1]), u = pm[2]
    if (n === Math.round(n)) return `${n}${u}`
    return `${parseFloat(n.toFixed(2))}${u}`
  }
  // Color: rgb → hex → shorten hex
  if (isColorValue(value)) return shortenColor(convertColor(value, 'hex'))
  return value
}

function formatDisplayValue(prop: string, value: string): string {
  if (_shortenCSS) return shortenValue(prop, value)
  if (isColorValue(value)) return convertColor(value, _colorFormat)
  return value
}

// ─── Mode icon mapping ────────────────────────────────────────────────
/** Shared SVG attribute string — all Lucide-line icons use this */
const SVG = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"'
/** Shared close (X) icon, 14×14 */
const CLOSE_X = `<svg ${SVG} width="14" height="14"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`

const MODE_ICON_SVG = [
  // 0: Off
  `<svg ${SVG}><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 14.14 14.14"/></svg>`,
  // 1: Inspect
  `<svg ${SVG}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  // 2: Guidelines
  `<svg ${SVG}><circle cx="12" cy="12" r="2"/><path d="M12 2v8m0 4v8M2 12h8m4 0h8"/></svg>`,
  // 3: Grid
  `<svg ${SVG}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
] as const

const MODE_BADGE_COLOR = ['#5F5E5A', '#534AB7', '#0F6E56', '#185FA5'] as const

function updateModeUI() {
  document.body.classList.remove('stylesnap-mode-guidelines', 'stylesnap-mode-grid')
  if (inspectMode === 2) document.body.classList.add('stylesnap-mode-guidelines')
  else if (inspectMode === 3) document.body.classList.add('stylesnap-mode-grid')

  // floating button state
  const btn = $$(FLOATING_BTN_ID)
  if (!btn) return

  // active ring animation
  if (inspectMode > 0) btn.classList.add('is-active')
  else btn.classList.remove('is-active')

  const badge = btn.querySelector('.stylesnap-mode-badge') as HTMLElement | null
  if (badge) {
    if (inspectMode > 0) {
      badge.innerHTML = MODE_ICON_SVG[inspectMode]
      badge.style.background = MODE_BADGE_COLOR[inspectMode]
      badge.style.setProperty('border', 'none', 'important')
      badge.style.setProperty('display', 'flex', 'important')
    } else {
      badge.innerHTML = ''
      badge.style.setProperty('display', 'none', 'important')
    }
  }

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
  if (!add && _mmRaf) { cancelAnimationFrame(_mmRaf); _mmRaf = 0; _mmEvent = null }
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
    showHintBar()
  } else if (wasActive && !nowActive) {
    applyInspectorListeners(false)
    unlockElement()
    removeHighlight()
    hideOverlay()
    hideHintBar()
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
  const ids = ['stylesnap-guide-h', 'stylesnap-guide-v']
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
  const h = document.getElementById('stylesnap-guide-h')
  const v = document.getElementById('stylesnap-guide-v')
  if (h && v) {
    h.style.top = `${rect.top + rect.height / 2}px`
    v.style.left = `${rect.left + rect.width / 2}px`
  }
}

// ─── CSS default-value filter ─────────────────────────────────────────
// Properties that match the baseline (span with all:initial) are auto-filtered.
// This small set explicitly blocks truly useless/dangerous properties.
const CSS_NOISE = new Set([
  'all',
  '-webkit-tap-highlight-color',
  '-webkit-text-fill-color',
  '-webkit-text-stroke',
  '-webkit-text-stroke-color',
  '-webkit-text-stroke-width',
  // Browser-defaultish values that often leak through
  'animation-delay', 'animation-direction', 'animation-duration',
  'animation-fill-mode', 'animation-iteration-count', 'animation-name',
  'animation-play-state', 'animation-timing-function',
  'background-attachment', 'background-clip', 'background-origin',
  'background-repeat', 'background-position-x', 'background-position-y',
  'appearance', 'border-collapse', 'border-spacing',
  'box-sizing', 'break-after', 'break-before', 'break-inside',
  'caption-side', 'clear', 'clip', 'clip-rule',
  'column-count', 'column-gap', 'column-rule-color',
  'column-rule-style', 'column-rule-width', 'column-span', 'column-width',
  'contain', 'content', 'counter-increment', 'counter-reset', 'counter-set',
  'empty-cells', 'filter', 'float',
  'font-kerning', 'font-optical-sizing', 'font-stretch', 'font-variant',
  'font-variation-settings', 'hyphens', 'image-orientation', 'isolation',
  'letter-spacing', 'list-style', 'list-style-image',
  'list-style-position', 'list-style-type', 'math-style',
  'mix-blend-mode', 'object-fit', 'object-position',
  'orphans', 'overflow-anchor', 'overflow-wrap',
  'page-break-after', 'page-break-before', 'page-break-inside',
  'perspective', 'perspective-origin', 'quotes', 'resize',
  'ruby-position', 'scroll-behavior', 'tab-size', 'table-layout',
  'text-align-last', 'text-decoration-skip-ink', 'text-emphasis',
  'text-indent', 'text-justify', 'text-rendering',
  'text-transform', 'text-underline-offset',
  'touch-action', 'transform-origin', 'transform-style',
  'unicode-bidi', 'user-select', 'widows', 'will-change',
  'word-spacing', 'writing-mode', 'zoom',
])

// Properties we always show even if they match baseline
const CSS_HIGHLIGHT = new Set([
  'color', 'background', 'background-color', 'background-image',
  'background-size', 'background-position',
  'border', 'border-color', 'border-radius', 'border-width', 'border-style',
  'box-shadow', 'display', 'flex', 'flex-direction', 'flex-wrap',
  'align-items', 'align-content', 'justify-content', 'justify-items',
  'gap', 'row-gap', 'column-gap',
  'grid', 'grid-template', 'grid-template-columns', 'grid-template-rows',
  'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'text-align', 'text-decoration',
  'overflow', 'overflow-x', 'overflow-y', 'text-overflow',
  'transition', 'animation', 'transform',
  'position', 'inset', 'top', 'right', 'bottom', 'left',
  'opacity', 'z-index', 'cursor', 'pointer-events',
  'outline', 'outline-offset', 'outline-color',
  'white-space', 'word-break', 'word-wrap',
  'vertical-align', 'visibility',
  'aspect-ratio',
])

function filterDefaultStyles(el: Element, styles: Record<string, string>): Record<string, string> {
  // Use a same-tag dummy element as baseline — preserves native defaults like
  // <h2> → font-weight:bold, <div> → display:block, etc.
  const tag = el.tagName.toLowerCase()
  const dummy = document.createElement(tag)
  document.body.appendChild(dummy)
  const defaults = window.getComputedStyle(dummy)
  const filtered: Record<string, string> = {}
  for (const [prop, val] of Object.entries(styles)) {
    if (CSS_NOISE.has(prop)) continue
    // Skip 'initial' literal values — should never appear as real style
    if (val === 'initial') continue
    // Check if value differs from bare-element baseline
    const defVal = defaults.getPropertyValue(prop)
    if (val !== defVal || CSS_HIGHLIGHT.has(prop)) {
      // CSS Scan behavior: hide display:none (element wouldn't be inspectable if truly hidden)
      if (prop === 'display' && val === 'none') continue
      filtered[prop] = val
    }
  }
  document.body.removeChild(dummy)
  return filtered
}

function getOrCreateOverlay(): HTMLElement {
  let overlay = $$('stylesnap-overlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = OVERLAY_ID
    overlay.setAttribute('data-stylesnap', 'true')
    overlay.style.setProperty('position', 'fixed', 'important')
    overlay.style.setProperty('top', '0', 'important')
    overlay.style.setProperty('left', '0', 'important')
    chrome.storage.local.get(['language'], (res) => {
      overlay!.setAttribute('data-lang', res.language || 'en')
    })
    stAppend(overlay)
  }
  return overlay
}

function showOverlay(el: Element, parsedCSS: ParsedCSS) {
  const overlay = getOrCreateOverlay()
  const rect = el.getBoundingClientRect()

  const { styles, tailwindClasses = [], tailwindMatchRate = 0 } = parsedCSS
  // Cache locked styles for compare diffing
  _lockedCSS = { ...styles }

  // ─── Immediate position reset to avoid flash at stale position
  overlay.style.setProperty('left', `${Math.round(rect.left)}px`, 'important')
  overlay.style.setProperty('top', `${Math.round(rect.bottom + 4)}px`, 'important')

  // ─── Filter browser defaults ──────────────────────────

  // ─── Filter browser defaults ──────────────────────────
  const filteredStyles = filterDefaultStyles(el, styles)
  const allProps = Object.entries(filteredStyles)

  // ─── Tailwind: Free limited display ───────────────────
  const isPro = _licenseIsPro
  const MAX_FREE_TW = 4
  const twSlice = isPro ? tailwindClasses.length : Math.min(tailwindClasses.length, MAX_FREE_TW)
  const twHidden = tailwindClasses.length - twSlice
  const tailwindStr = tailwindClasses.slice(0, twSlice).join(' ')
    + (twHidden > 0 ? ` <span class="ss-tw-more">+${twHidden} more</span>` : '')
  const twUpgradeBar = (!isPro && twHidden > 0)
    ? `<div class="ss-tw-upgrade"><span>🔒 ${twHidden} Tailwind classes hidden</span> <a class="ss-upgrade-link">Upgrade to Pro →</a></div>`
    : ''
  const matchPct = Math.round(tailwindMatchRate * 100)

  // ─── Build flat CSS list (no grouping — CSS Scan style) ───
  const lang = overlay.getAttribute('data-lang') || 'en'
  const t = (key: TranslationKey, params?: Record<string, string>) => {
    let s = translations[lang as 'en'|'zh']?.[key] || translations.en[key] || key
    if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, v)
    return s
  }

  // Helper: render one property as a line with color block + copy button
  const perLineProp = (k: string, v: string) => {
    const displayVal = formatDisplayValue(k, v)
    const cBlock = isColorValue(v) ? colorBlock(v) : ''
    return `<span class="ss-prop-row"><span class="ss-prop">${escapeHtml(k)}:</span> ${cBlock}<span class="ss-val" data-prop="${escapeHtml(k)}" data-original="${escapeHtml(v)}" title="Click to edit">${escapeHtml(displayVal)}<svg class="ss-val-edit-icon" ${SVG} width="9" height="9" style="opacity:0;margin-left:3px;vertical-align:middle;transition:opacity 0.15s;flex-shrink:0;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span>;<button class="ss-val-copy-btn" data-text="${escapeHtml(`${k}: ${displayVal};`)}" title="Copy"><svg ${SVG} width="9" height="9"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></span>`
  }

  // Flat list: all properties in one block, sorted logically
  const MAX_VISIBLE = 12
  const hasMore = allProps.length > MAX_VISIBLE
  const visibleStyles = hasMore ? allProps.slice(0, MAX_VISIBLE) : allProps

  // Sort: layout → spacing → typography → visual → rest
  const sortOrder = ['display','position','flex','flex-direction','flex-wrap','align-items','justify-content','gap',
    'width','height','min-width','min-height','max-width','max-height',
    'margin','margin-top','margin-right','margin-bottom','margin-left',
    'padding','padding-top','padding-right','padding-bottom','padding-left',
    'border','border-width','border-style','border-color','border-radius',
    'background','background-color','background-image','background-size',
    'color','font-family','font-size','font-weight','font-style','line-height','text-align','text-decoration',
    'box-shadow','opacity','transform','transition','cursor','pointer-events','overflow','z-index']
  const orderMap = new Map(sortOrder.map((k, i) => [k, i]))
  const sorted = [...visibleStyles].sort((a, b) => {
    const ai = orderMap.get(a[0]) ?? 999
    const bi = orderMap.get(b[0]) ?? 999
    return ai - bi
  })

  const flatCSS = sorted.map(([k, v]) => perLineProp(k, v)).join('\n')

  // ─── Pseudo-class styles (CSS Scan style: card per pseudo-class) ───
  let pseudoHTML = ''
  const pseudoIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`
  if (parsedCSS.interactionStyles) {
    for (const [pseudo, props] of Object.entries(parsedCSS.interactionStyles)) {
      if (!props || Object.keys(props).length === 0) continue
      const lines: string[] = []
      for (const [k, v] of Object.entries(props)) {
        if (v === 'initial' || v === 'inherit' || v === 'unset') continue
        if (v === 'none' && k !== 'display') continue
        lines.push(perLineProp(k, v))
      }
      if (lines.length > 0) {
        pseudoHTML += `\n<div class="ss-section-card ss-card-pseudo"><div class="ss-section-card-header">${pseudoIcon} <span class="ss-section-card-tag">:${escapeHtml(pseudo)}</span></div><pre class="ss-css ss-flat-list">${lines.join('\n')}</pre></div>`
      }
    }
  }

  // ─── Responsive styles (card per breakpoint) ───
  let responsiveInline = ''
  const respIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`
  if (parsedCSS.responsiveStyles) {
    for (const [query, props] of Object.entries(parsedCSS.responsiveStyles)) {
      if (!props || Object.keys(props).length === 0) continue
      const lines: string[] = []
      for (const [k, v] of Object.entries(props)) {
        if (v === 'initial' || v === 'inherit' || v === 'unset') continue
        if (v === 'none' && k !== 'display') continue
        lines.push(perLineProp(k, v))
      }
      if (lines.length > 0) {
        responsiveInline += `\n<div class="ss-section-card ss-card-responsive"><div class="ss-section-card-header">${respIcon} <span class="ss-section-card-tag">@media ${escapeHtml(query)}</span></div><pre class="ss-css ss-flat-list">${lines.join('\n')}</pre></div>`
      }
    }
  }

  const expandBtn = hasMore
    ? `<div class="ss-expand"><button class="ss-expand-btn" data-expanded="0">Show all ${allProps.length} properties</button></div>`
    : ''

  const isCurrentlyLocked = !!lockedElement

  // ─── Build overlay ───
  let contentHtml = `
    <div class="ss-header">
      <span class="ss-lock-icon" data-locked="${isCurrentlyLocked ? '1' : '0'}">
        ${isCurrentlyLocked
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>'
        }
      </span>
      <span class="ss-tag">${el.tagName.toLowerCase()}</span>
      <span class="ss-dim">${Math.round(rect.width)}×${Math.round(rect.height)}</span>
      <span class="ss-match">TW ${matchPct}%</span>
    </div>
    ${tailwindStr ? `<div class="ss-tw">${tailwindStr}</div>` : ''}
    ${twUpgradeBar}
    <div class="ss-props-list"><pre class="ss-css ss-flat-list">${flatCSS}</pre>${pseudoHTML}${responsiveInline}</div>
    ${expandBtn}
    <div class="ss-footer">
      <div class="ss-actions">
        <button class="ss-copy-btn" title="${t('copyCSS')}">
          <svg ${SVG} width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> CSS
        </button>
        <button class="ss-tw-copy-btn" title="Copy Tailwind classes" style="opacity:${matchPct >= 30 ? '1' : '0.4'};">
          <svg ${SVG} width="12" height="12"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/><path d="M8 12s1-2 4-2 4 2 4 2"/></svg> TW
        </button>
        <button class="ss-ai-btn" title="Generate AI Prompt">
          <svg ${SVG} width="12" height="12" stroke="#a78bfa"><path d="M15 4 20 9 9 20 4 20 4 15Z"/><path d="m13 6 5 5"/></svg> Prompt
        </button>
        <button class="ss-export-btn" title="Open in CodePen">
          <svg ${SVG} width="12" height="12"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/></svg> CodePen
        </button>
      </div>
    </div>
  `

  // Use DOM Diffing to avoid innerHTML thrashing if content is identical
  if (overlay.dataset.lastHtml !== contentHtml) {
    overlay.innerHTML = contentHtml
    overlay.dataset.lastHtml = contentHtml
    // Re-attach inline edit + copy handlers only when DOM is re-created
    attachCSSHandlers(overlay)
  }

  overlay.style.setProperty('display', 'block', 'important')
  overlay.classList.remove('ss-interactive')
  overlay.classList.add('ss-active')
  overlay.dataset.locked = isCurrentlyLocked ? '1' : '0'

  // Clean up previous autoUpdate listener
  if (_overlayCleanup) { _overlayCleanup(); _overlayCleanup = null }

  // Floating UI: smart placement with flip + shift
  // Use generation counter to discard stale async position updates
  const gen = ++_overlayGen
  const updatePosition = () => {
    computePosition(el, overlay, {
      strategy: 'fixed',
      placement: 'bottom-start',
      middleware: [
        offset(4),
        flip({ fallbackPlacements: ['top-start', 'right-start', 'left-start'] }),
        shift({ padding: 8 }),
      ],
    }).then(({ x, y }) => {
      // Discard if a newer showOverlay call has happened
      if (gen !== _overlayGen) return
      overlay.style.setProperty('left', `${Math.round(x)}px`, 'important')
      overlay.style.setProperty('top', `${Math.round(y)}px`, 'important')
    }).catch(() => {
      // Fallback: position below element with naive calc
      if (gen !== _overlayGen) return
      const elRect = el.getBoundingClientRect()
      const ovRect = overlay.getBoundingClientRect()
      let fallbackTop = elRect.bottom + 4
      let fallbackLeft = elRect.left
      if (fallbackTop + ovRect.height > window.innerHeight - 8) {
        fallbackTop = elRect.top - ovRect.height - 4
      }
      if (fallbackLeft + ovRect.width > window.innerWidth - 8) {
        fallbackLeft = window.innerWidth - ovRect.width - 8
      }
      fallbackLeft = Math.max(8, fallbackLeft)
      fallbackTop = Math.max(8, fallbackTop)
      overlay.style.setProperty('left', `${Math.round(fallbackLeft)}px`, 'important')
      overlay.style.setProperty('top', `${Math.round(fallbackTop)}px`, 'important')
    })
  }

  // Do an immediate position update first
  updatePosition()
  // Only auto-track when hovering (not locked) — locked overlay stays put
  if (!isCurrentlyLocked) {
    _overlayCleanup = autoUpdate(el, overlay, updatePosition)
  }

  // ─── Inline edit + per-value copy handlers (reusable for expand) ───
  function attachCSSHandlers(container: HTMLElement) {
    container.querySelectorAll('.ss-val').forEach((valEl) => {
      const applyVal = (span: HTMLElement) => {
        span.setAttribute('contenteditable', 'false')
        const prop = span.dataset.prop
        const newVal = span.textContent?.trim() || ''
        span.dataset.original = newVal
        if (prop && lockedElement) {
          ;(lockedElement as HTMLElement).style.setProperty(prop, newVal)
          showToast(`${prop}: ${newVal} ✓`)
        }
      }
      valEl.addEventListener('click', (ev) => {
        ev.stopPropagation()
        const span = valEl as HTMLElement
        if (span.getAttribute('contenteditable') === 'true') return
        span.setAttribute('contenteditable', 'true')
        span.setAttribute('tabindex', '0')
        span.focus()
        const sel = window.getSelection()
        const range = document.createRange()
        range.selectNodeContents(span)
        sel?.removeAllRanges()
        sel?.addRange(range)
      })
      valEl.addEventListener('keydown', (ev) => {
        const span = valEl as HTMLElement
        const e = ev as KeyboardEvent
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); applyVal(span) }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); span.textContent = span.dataset.original || ''; span.setAttribute('contenteditable', 'false'); span.blur() }
      })
      valEl.addEventListener('blur', () => {
        const span = valEl as HTMLElement
        if (span.getAttribute('contenteditable') !== 'true') return
        applyVal(span)
      })
    })
    container.querySelectorAll('.ss-val-copy-btn').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation()
        const text = (btn as HTMLElement).dataset.text
        if (text) {
          const decoded = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          navigator.clipboard.writeText(decoded).then(() => showToast('Copied!'))
            .catch(() => { const el = document.createElement('textarea'); el.value = decoded; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el) })
        }
      })
    })
  }
  // Only attach handlers if we just did a full innerHTML update
  // The logic for this is now handled in the dataset.lastHtml diffing block above.

  // Set data-locked attribute for CSS control (hides copy/export when not locked)
  overlay.setAttribute('data-locked', isCurrentlyLocked ? '1' : '0')

  // Expand/Collapse button
  const expandBtnEl = overlay.querySelector('.ss-expand-btn') as HTMLElement | null
  // We need to avoid adding multiple event listeners.
  // Using a dataset flag to track if we've already bound listeners.
  if (expandBtnEl && !expandBtnEl.dataset.bound) {
    expandBtnEl.dataset.bound = 'true'
    expandBtnEl.addEventListener('click', (ev) => {
      ev.stopPropagation()
      const isExpanded = expandBtnEl.dataset.expanded === '1'
      const cssEl = overlay.querySelector('.ss-flat-list') as HTMLElement | null
      if (!cssEl) return
      const rebuild = (entries: [string,string][]) => {
        return entries.map(([k, v]) => perLineProp(k, v)).join('\n') + pseudoHTML + responsiveInline
      }
      if (isExpanded) {
        cssEl.innerHTML = rebuild(sorted)
        expandBtnEl.dataset.expanded = '0'
        expandBtnEl.textContent = `Show all ${allProps.length} properties`
      } else {
        cssEl.innerHTML = rebuild(allProps as [string, string][])
        expandBtnEl.dataset.expanded = '1'
        expandBtnEl.textContent = 'Collapse'
      }
      // Re-attach inline edit + copy handlers
      attachCSSHandlers(overlay)
    })
  }
  const upgradeLink = overlay.querySelector('.ss-upgrade-link') as HTMLElement | null
  if (upgradeLink && !upgradeLink.dataset.bound) {
    upgradeLink.dataset.bound = 'true'
    upgradeLink.addEventListener('click', (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      showUpgradeModal()
    })
  }

  // Footer Copy button
  const copyBtn = overlay.querySelector('.ss-copy-btn') as HTMLElement | null
  if (copyBtn && !copyBtn.dataset.bound) {
    copyBtn.dataset.bound = 'true'
    copyBtn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      const target = lockedElement || lastHighlighted
      if (!target) { showToast('Hover an element first'); return }
      copyCurrentCSS(target)
      // Visual feedback: green flash + checkmark
      if (copyBtn) {
        const origHTML = copyBtn.innerHTML
        const origBg = copyBtn.style.background
        copyBtn.style.background = 'rgba(52, 211, 153, 0.25)'
        copyBtn.style.borderColor = 'rgba(52, 211, 153, 0.5)'
        copyBtn.style.color = '#34d399'
        copyBtn.innerHTML = `<svg ${SVG} width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg> Copied!`
        setTimeout(() => {
          copyBtn.innerHTML = origHTML
          copyBtn.style.background = origBg
          copyBtn.style.borderColor = ''
          copyBtn.style.color = ''
        }, 1500)
      }
    })
  }

  // Footer TW copy button
  const twCopyBtn = overlay.querySelector('.ss-tw-copy-btn') as HTMLElement | null
  if (twCopyBtn && !twCopyBtn.dataset.bound) {
    twCopyBtn.dataset.bound = 'true'
    twCopyBtn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      const target = lockedElement || lastHighlighted
      if (!target) { showToast('Hover an element first'); return }
      const twClasses = getTailwindClasses(target)
      if (!twClasses) { showToast('No Tailwind classes found'); return }
      navigator.clipboard.writeText(`class="${twClasses}"`).then(() => {
        const origHTML = twCopyBtn.innerHTML
        twCopyBtn.style.background = 'rgba(52, 211, 153, 0.25)'
        twCopyBtn.style.borderColor = 'rgba(52, 211, 153, 0.5)'
        twCopyBtn.style.color = '#34d399'
        twCopyBtn.innerHTML = `<svg ${SVG} width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg> Copied!`
        setTimeout(() => {
          twCopyBtn.innerHTML = origHTML
          twCopyBtn.style.background = ''
          twCopyBtn.style.borderColor = ''
          twCopyBtn.style.color = ''
        }, 1500)
      }).catch(() => showToast('Copy failed'))
    })
  }

  // Footer Export button
  const exportBtn = overlay.querySelector('.ss-export-btn') as HTMLElement | null
  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = 'true'
    exportBtn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      if (!lockedElement) { showToast('Lock an element first'); return }
      exportCSSToCodePen()
    })
  }

  // Footer AI button
  const aiBtn = overlay.querySelector('.ss-ai-btn') as HTMLElement | null
  if (aiBtn && !aiBtn.dataset.bound) {
    aiBtn.dataset.bound = 'true'
    aiBtn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      if (!lockedElement) { showToast('Lock an element first'); return }
      showAIPrompt()
    })
  }

  // ─── Side panel (Box Model + Preview) — only when locked ───────────
  if (_showSidePanel && isCurrentlyLocked) {
    updateSidePanel(el as HTMLElement, parsedCSS, overlay)
  } else {
    hideSidePanel()
  }

}

function hideOverlay() {
  const overlay = $$(OVERLAY_ID)
  if (overlay) {
    overlay.style.setProperty('display', 'none', 'important')
    // Clear cached HTML to ensure full re-render on next show
    delete overlay.dataset.lastHtml
  }
  // Clean up Floating UI autoUpdate listener
  if (_overlayCleanup) { _overlayCleanup(); _overlayCleanup = null }
  // Clean up any open export menu
  const menu = $$('stylesnap-export-menu')
  if (menu) menu.remove()
  hideSidePanel()
}

// ─── Side Panel (Box Model + Preview) ────────────────────────────────
const SIDE_PANEL_ID = 'stylesnap-side-panel'

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** Box model content HTML (no wrapper) */
function buildBoxModel(el: HTMLElement, rect: DOMRect): string {
  const cs = window.getComputedStyle(el)
  const get = (p: string) => {
    const n = parseFloat(cs.getPropertyValue(p))
    return isNaN(n) ? '0' : (n === Math.round(n) ? String(Math.round(n)) : n.toFixed(1))
  }
  const mt = get('margin-top'), mr = get('margin-right'), mb = get('margin-bottom'), ml = get('margin-left')
  const bt = get('border-top-width'), br = get('border-right-width'), bb = get('border-bottom-width'), bl = get('border-left-width')
  const pt = get('padding-top'), pr = get('padding-right'), pb = get('padding-bottom'), pl = get('padding-left')
  const w = Math.round(rect.width), h = Math.round(rect.height)
  return `<div class="ss-boxmodel">
    <div class="ss-bm-margin">
      <span class="ss-bm-val ss-bm-top">${mt}</span>
      <div class="ss-bm-border">
        <span class="ss-bm-val ss-bm-left">${ml}</span>
        <div class="ss-bm-padding">
          <span class="ss-bm-val ss-bm-top">${pt}</span>
          <div class="ss-bm-content">${w}×${h}</div>
          <span class="ss-bm-val ss-bm-bot">${pb}</span>
        </div>
        <span class="ss-bm-val ss-bm-right">${mr}</span>
      </div>
      <span class="ss-bm-val ss-bm-bot">${mb}</span>
    </div>
    <div class="ss-bm-edge-labels">
      <span style="color:#60a5fa">B:${bt} ${br} ${bb} ${bl}</span>
      <span style="color:#34d399">P:${pt} ${pr} ${pb} ${pl}</span>
    </div>
  </div>`
}

/** Preview iframe content (sandboxed, renders element HTML + extracted CSS) */
function buildPreviewHTML(el: HTMLElement, parsedCSS: ParsedCSS | null): string {
  const elHTML = el.outerHTML.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
  const cssStr = parsedCSS?.styles
    ? Object.entries(parsedCSS.styles).map(([k, v]) => `${k}:${v}`).join(';')
    : ''
  const selector = parsedCSS?.selector || el.tagName.toLowerCase()
  const srcDoc = `<!DOCTYPE html><html><head><style>
    body{margin:8px;background:#1e293b;display:flex;align-items:flex-start;justify-content:center;padding:8px;}
    ${selector}{${cssStr}}
  </style></head><body>${elHTML}</body></html>`
  return `<iframe sandbox="allow-same-origin" srcdoc="${escapeAttr(srcDoc)}" style="width:100%;height:130px;border:none;border-radius:4px;background:#1e293b;display:block;"></iframe>`
}

function updateSidePanel(el: HTMLElement, parsedCSS: ParsedCSS | null, overlay: HTMLElement) {
  let panel = $$(SIDE_PANEL_ID)
  if (!panel) {
    panel = document.createElement('div')
    panel.id = SIDE_PANEL_ID
    panel.setAttribute('data-stylesnap', 'true')
    Object.assign(panel.style, {
      position: 'fixed', zIndex: '9999990',
      background: 'rgba(15,23,42,0.97)',
      border: '1px solid rgba(99,102,241,0.2)',
      borderRadius: '10px', width: '220px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
      fontFamily: 'system-ui,sans-serif', fontSize: '11px',
      color: '#e2e8f0', overflow: 'hidden',
    })
    stAppend(panel)
  }

  const rect = el.getBoundingClientRect()
  const bm = buildBoxModel(el, rect)
  const pv = buildPreviewHTML(el, parsedCSS)
  const chevron = (open: boolean) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><polyline points="${open ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}"/></svg>`
  const bmOpen = localStorage.getItem('ss-sp-boxmodel') !== '0'
  const pvOpen = localStorage.getItem('ss-sp-preview') === '1'

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <span style="font-size:10px;font-weight:600;color:#64748b;letter-spacing:0.05em;text-transform:uppercase;">Inspector</span>
      <button id="ss-sp-close" title="Close" style="background:none;border:none;color:#475569;cursor:pointer;padding:2px;display:flex;border-radius:3px;">${CLOSE_X}</button>
    </div>
    <div class="ss-sp-section">
      <div class="ss-sp-header" data-key="ss-sp-boxmodel" data-open="${bmOpen ? '1' : '0'}" style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;cursor:pointer;color:#64748b;font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;user-select:none;">
        <span>Box Model</span>${chevron(bmOpen)}
      </div>
      <div class="ss-sp-body" style="display:${bmOpen ? 'block' : 'none'};padding:4px 10px 10px;">${bm}</div>
    </div>
    <div class="ss-sp-section" style="border-top:1px solid rgba(255,255,255,0.05);">
      <div class="ss-sp-header" data-key="ss-sp-preview" data-open="${pvOpen ? '1' : '0'}" style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;cursor:pointer;color:#64748b;font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;user-select:none;">
        <span>Preview</span>${chevron(pvOpen)}
      </div>
      <div class="ss-sp-body" style="display:${pvOpen ? 'block' : 'none'};padding:0 8px 8px;">${pv}</div>
    </div>
  `

  panel.querySelector('#ss-sp-close')?.addEventListener('click', () => panel!.remove())

  panel.querySelectorAll('.ss-sp-header').forEach(h => {
    h.addEventListener('click', () => {
      const header = h as HTMLElement
      const key = header.dataset.key || ''
      const body = header.nextElementSibling as HTMLElement | null
      const nowOpen = header.dataset.open !== '1'
      header.dataset.open = nowOpen ? '1' : '0'
      const poly = header.querySelector('polyline')
      if (poly) poly.setAttribute('points', nowOpen ? '18 15 12 9 6 15' : '6 9 12 15 18 9')
      if (body) body.style.display = nowOpen ? 'block' : 'none'
      if (key) localStorage.setItem(key, nowOpen ? '1' : '0')
    })
  })

  positionSidePanel(panel, overlay)
}

function positionSidePanel(panel: HTMLElement, overlay: HTMLElement) {
  const ovRect = overlay.getBoundingClientRect()
  const panelWidth = 220, gap = 8
  let left = ovRect.right + gap
  if (left + panelWidth > window.innerWidth - 8) left = ovRect.left - panelWidth - gap
  left = Math.max(8, left)
  const top = Math.max(8, Math.min(ovRect.top, window.innerHeight - 360))
  panel.style.left = `${Math.round(left)}px`
  panel.style.top = `${Math.round(top)}px`
}

function hideSidePanel() {
  $$(SIDE_PANEL_ID)?.remove()
}

// ─── Inline edit ────────────────────────────────────────────────────

function highlightElement(el: Element) {
  if (lockedElement && el !== lockedElement) return
  removeHighlight()
  el.classList.add(HIGHLIGHT_CLASS)
  lastHighlighted = el
}

function removeHighlight() {
  if (lastHighlighted && lastHighlighted !== lockedElement) {
    lastHighlighted.classList.remove(HIGHLIGHT_CLASS, PREVIEW_CLASS)
    lastHighlighted = null
  }
}

function lockElement(el: Element) {
  if (lockedElement) lockedElement.classList.remove(LOCKED_CLASS)
  // Clean up highlight/preview classes before adding lock
  el.classList.remove(HIGHLIGHT_CLASS, PREVIEW_CLASS)
  lockedElement = el
  el.classList.add(LOCKED_CLASS)
  lastHighlighted = null
  // Push to inspection history (Feature 4)
  const _hsnap = {
    tag: el.tagName.toLowerCase(),
    selector: (el.id ? '#'+el.id : el.tagName.toLowerCase() + ((el as HTMLElement).className ? '.'+String((el as HTMLElement).className).split(' ').filter(c=>c&&!c.startsWith('stylesnap-')).slice(0,2).join('.') : '')),
    snippet: (el as HTMLElement).outerHTML.slice(0, 80),
    parsedCSS: _lastParsedCSS,
    timestamp: Date.now(),
  }
  _history.unshift(_hsnap)
  if (_history.length > 10) _history.pop()
  // Stop auto-tracking — locked overlay stays fixed
  if (_overlayCleanup) { _overlayCleanup(); _overlayCleanup = null }
  const overlay = $$(OVERLAY_ID)
  if (overlay) {
    overlay.classList.remove('ss-interactive')
    overlay.classList.add('ss-active')
    updateLockIcon(overlay, true)
  }
}

function unlockElement() {
  if (lockedElement) {
    lockedElement.classList.remove(LOCKED_CLASS)
    lockedElement = null
  }
  removeCompareHighlight()
  hideCompareTooltip()
  const overlay = $$(OVERLAY_ID)
  if (overlay) {
    overlay.classList.remove('ss-active')
    updateLockIcon(overlay, false)
  }
  const menu = $$('stylesnap-export-menu')
  if (menu) menu.remove()
}

function updateLockIcon(overlay: HTMLElement, isLocked: boolean) {
  const iconEl = overlay.querySelector('.ss-lock-icon') as HTMLElement
  if (!iconEl) return
  iconEl.setAttribute('data-locked', isLocked ? '1' : '0')
  if (isLocked) {
    iconEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
    iconEl.style.color = '#34d399'
    ;(iconEl as HTMLElement).title = 'Locked'
  } else {
    iconEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>'
    iconEl.style.color = '#64748b'
    ;(iconEl as HTMLElement).title = 'Click to lock'
  }
}

// ─── Compare mode ────────────────────────────────────────────────────
let _compareTarget: HTMLElement | null = null
let _compareTooltip: HTMLElement | null = null
let _lockedCSS: Record<string, string> = {}  // cached locked element styles for diffing

function computeCSSDiff(hoveredEl: Element) {
  const ov = document.getElementById(OVERLAY_ID)
  if (!ov) return

  const hoveredStyles = window.getComputedStyle(hoveredEl as HTMLElement)
  let diffCount = 0

  ov.querySelectorAll('.ss-val').forEach((valEl) => {
    const span = valEl as HTMLElement
    const prop = span.dataset.prop
    if (!prop || !_lockedCSS[prop]) return
    const lockedVal = _lockedCSS[prop]
    // Query the hovered element for the same property
    let hoveredVal: string
    try {
      hoveredVal = hoveredStyles.getPropertyValue(prop)
    } catch {
      return
    }
    // Normalize values (strip whitespace, semicolons)
    const normL = lockedVal.replace(/;\s*$/, '').trim()
    const normH = hoveredVal.replace(/;\s*$/, '').trim()
    if (normL !== normH && hoveredVal) {
      span.classList.add('ss-val-diff')
      span.setAttribute('data-compare', normH)
      diffCount++
    }
  })

  // Show diff count as toast
  const elTag = (hoveredEl as HTMLElement).tagName.toLowerCase()
  if (diffCount > 0) {
    showToast(`${diffCount} diff(s) vs <${elTag}>`)
  } else {
    showToast('No differences found')
  }
}

function clearCompareDiff() {
  const ov = document.getElementById(OVERLAY_ID)
  if (!ov) return
  ov.querySelectorAll('.ss-val-diff').forEach((el) => {
    el.classList.remove('ss-val-diff')
    el.removeAttribute('data-compare')
  })
}

function highlightCompareElement(el: Element | null) {
  if (!el || el === lockedElement) return
  const elh = el as HTMLElement
  if (_compareTarget && _compareTarget !== elh) {
    _compareTarget.classList.remove('stylesnap-compare-highlight')
    clearCompareDiff()
  }
  elh.classList.add('stylesnap-compare-highlight')
  _compareTarget = elh
  computeCSSDiff(el)
}

function removeCompareHighlight() {
  if (_compareTarget) {
    _compareTarget.classList.remove('stylesnap-compare-highlight')
    _compareTarget = null
  }
  clearCompareDiff()
}

function showCompareTooltip(el: Element | null, x?: number, y?: number) {
  if (!el) return
  hideCompareTooltip()
  const tip = document.createElement('div')
  tip.className = 'stylesnap-compare-tooltip'
  tip.textContent = '↔ Compare'
  tip.style.cssText = `
    position: fixed !important;
    left: ${x ?? 0}px !important;
    top: ${(y ?? 0) - 28}px !important;
    background: rgba(251,191,36,0.95) !important;
    color: #0f172a !important;
    font-size: 10px !important;
    font-weight: 700 !important;
    padding: 3px 8px !important;
    border-radius: 4px !important;
    pointer-events: none !important;
    z-index: 999992 !important;
    white-space: nowrap !important;
    font-family: system-ui, sans-serif !important;
  `
  stAppend(tip)
  _compareTooltip = tip
}

function hideCompareTooltip() {
  if (_compareTooltip) {
    _compareTooltip.remove()
    _compareTooltip = null
  }
}

// ─── Shared: extract precise CSS for a component from <style> tags ────

interface ComponentCSS {
  rules: Map<string, Record<string, string>>
  mediaRules: { query: string; selector: string; props: Record<string, string> }[]
  pseudoRules: { pseudo: string; selector: string; props: Record<string, string> }[]
}

function getComponentCSS(el: Element): ComponentCSS {
  // Build tree: ONLY locked element + descendants (NO ancestors — that's CSS Scan's approach)
  const treeNodes: Element[] = [el]
  function walkChildren(node: Element, depth: number) {
    if (depth > 3) return
    for (const child of Array.from(node.children)) { treeNodes.push(child); walkChildren(child, depth + 1) }
  }
  walkChildren(el, 1)

  const rules: Map<string, Record<string, string>> = new Map()
  const mediaRules: ComponentCSS['mediaRules'] = []
  const pseudoRules: ComponentCSS['pseudoRules'] = []

  function addRule(sel: string, props: Record<string, string>, media?: string) {
    if (!sel || sel === '*' || sel === 'body' || sel === 'html') return
    if (/stylesnap/i.test(sel)) return
    // Extract pseudo before splitting (selector may have :hover)
    const pseudo = extractPseudoFromSelector(sel)
    // For comma-separated selectors, keep only parts that match our tree
    const cleanSels = sel.split(',').map(s => s.trim()).filter(s => {
      const cs = s.replace(/:(hover|focus|active|visited|link|target)/g, '')
      return matchesAnyNode(treeNodes, cs)
    })
    if (cleanSels.length === 0) return
    sel = cleanSels.join(', ')
    if (media) {
      mediaRules.push({ query: media, selector: sel, props })
    } else if (pseudo) {
      pseudoRules.push({ pseudo, selector: sel, props })
    } else {
      if (rules.has(sel)) Object.assign(rules.get(sel)!, props)
      else rules.set(sel, { ...props })
    }
  }

  // Pass 1: external <link> sheets via CSSOM (normalized, but captures all rules)
  // Pass 2: <style> tags via raw text (preserves original formatting, takes priority)
  const sheets = Array.from(document.styleSheets)
  // Process <link> sheets first
  for (const sheet of sheets) {
    const owner = sheet.ownerNode as HTMLElement | null
    if (owner?.tagName === 'STYLE') continue // skip, handle in pass 2
    try {
      for (const rule of sheet.cssRules) {
        if (rule.type === CSSRule.STYLE_RULE) {
          const sr = rule as CSSStyleRule
          if (sr.selectorText) addRule(sr.selectorText, parseRulePropsRaw(sr.cssText))
        }
        if (rule.type === CSSRule.MEDIA_RULE) {
          const mr = rule as CSSMediaRule
          for (const cr of mr.cssRules) {
            if (cr.type === CSSRule.STYLE_RULE) {
              const sr = cr as CSSStyleRule
              if (sr.selectorText) addRule(sr.selectorText, parseRulePropsRaw(sr.cssText), mr.conditionText)
            }
          }
        }
      }
    } catch (_) {}
  }
  // Process <style> tags second (overwrites CSSOM-normalized values with raw original)
  for (const sheet of sheets) {
    const owner = sheet.ownerNode as HTMLElement | null
    if (owner?.tagName !== 'STYLE') continue
    try {
      const text = owner.textContent.replace(/\/\*[\s\S]*?\*\//g, '')
      let pos = 0
      while (pos < text.length) {
        while (pos < text.length && /\s/.test(text[pos])) pos++
        if (pos >= text.length) break
        if (text.substring(pos, pos + 6) === '@media') {
          const me = text.indexOf('{', pos); if (me === -1) break
          const q = text.substring(pos + 6, me).trim(); pos = me + 1
          while (pos < text.length) {
            while (pos < text.length && /\s/.test(text[pos])) pos++
            if (text[pos] === '}') { pos++; break }
            const re = text.indexOf('{', pos)
            if (re === -1 || re > text.indexOf('}', pos)) break
            const s = text.substring(pos, re).trim(); pos = re + 1
            const be = text.indexOf('}', pos); if (be === -1) break
            addRule(s, parseRulePropsRaw(text.substring(pos, be).trim()), q)
            pos = be + 1
          }
          continue
        }
        if (/@import|@font-face|@keyframes/.test(text.substring(pos, pos + 10))) {
          const next = text.indexOf('}', pos) !== -1 ? text.indexOf('}', pos) + 1 : text.indexOf(';', pos) + 1
          pos = next || text.length
          continue
        }
        const rs = text.indexOf('{', pos); if (rs === -1) break
        const s = text.substring(pos, rs).trim(); pos = rs + 1
        const be = text.indexOf('}', pos); if (be === -1) break
        addRule(s, parseRulePropsRaw(text.substring(pos, be).trim()))
        pos = be + 1
      }
    } catch (_) {}
  }

  // Deduplicate: sort rules by complexity (simpler first), skip only if
  // both property AND value are identical (override with different value = keep)
  const sortedSels = Array.from(rules.keys()).sort((a, b) => {
    const ca = a.split('.').length + a.split('#').length + (a.includes('>') ? 1 : 0) + (a.includes(' ') ? 1 : 0)
    const cb = b.split('.').length + b.split('#').length + (b.includes('>') ? 1 : 0) + (b.includes(' ') ? 1 : 0)
    return ca - cb || a.length - b.length
  })
  const seenKV = new Set<string>()
  const deduped = new Map<string, Record<string, string>>()
  for (const sel of sortedSels) {
    const props = rules.get(sel)!
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(props)) {
      if (seenKV.has(`${k}:${v}`)) continue
      clean[k] = v
      seenKV.add(`${k}:${v}`)
    }
    if (Object.keys(clean).length > 0) deduped.set(sel, clean)
  }

  return { rules: deduped, mediaRules, pseudoRules }
}

// ─── Copy CSS ─────────────────────────────────────────────────────────

function copyCurrentCSS(_el: Element) {
  if (_lastParsedCSS && _lastParsedCSS.styles && Object.keys(_lastParsedCSS.styles).length > 0) {
    const output = formatCSS(_lastParsedCSS.styles, _lastParsedCSS.selector)
    navigator.clipboard.writeText(output).then(() => showToast('CSS copied!'))
      .catch(() => showToast('Copy failed'))
  } else {
    showToast('No CSS to copy — hover an element first')
  }
}

// ─── Event handlers ───────────────────────────────────────────────────

// rAF-throttled mousemove: coalesce bursts into one handler call per frame.
let _mmRaf = 0
let _mmEvent: MouseEvent | null = null
function onMouseMove(e: MouseEvent) {
  _mmEvent = e
  if (_mmRaf) return
  _mmRaf = requestAnimationFrame(() => {
    _mmRaf = 0
    if (_mmEvent) handleMouseMove(_mmEvent)
  })
}

function handleMouseMove(e: MouseEvent) {
  if (!isActive()) return
  const el = document.elementFromPoint(e.clientX, e.clientY)

  // Bug 5: iframe cross-origin check – skip elements inside iframes
  if (el && el.ownerDocument !== document) return
  if (!el || el.closest('[data-stylesnap]')) {
    removeCompareHighlight()
    hideCompareTooltip()
    return
  }

  // If an element is locked, show preview dashed outline on other elements
  // (but keep overlay frozen on the locked element)
  if (lockedElement) {
    if (!compareMode) {
      if (el === lockedElement || el === lastHighlighted) return
      removeHighlight()
      el.classList.add(PREVIEW_CLASS)
      lastHighlighted = el
      return
    }
    // Compare mode: keep existing logic
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
  const rect = el.getBoundingClientRect()
  updateGuides(rect)

  chrome.runtime.sendMessage({
    type: 'ELEMENT_HOVERED',
    payload: {
      parsedCSS,
      tagName: el.tagName.toLowerCase(),
      id: el.id,
      classList: Array.from(el.classList).filter(c => !c.startsWith('stylesnap-')),
      rect: { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left) },
    },
  }).catch(() => {})
}

function onClick(e: MouseEvent) {
  if (!isActive()) return
  const el = document.elementFromPoint(e.clientX, e.clientY)

  // Collapsible group label click → toggle and stop
  if (el && el.closest('.ss-prop-group-label')) {
    const group = (el as HTMLElement).closest('.ss-prop-group') as HTMLElement | null
    if (group) group.dataset.collapsed = group.dataset.collapsed === '1' ? '0' : '1'
    e.preventDefault()
    e.stopPropagation()
    return
  }

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
    // Click on a different element → swap lock
    if (el !== lockedElement) {
      lockElement(el)
      const parsedCSS = parseElement(el)
      showOverlay(el, parsedCSS)
      updateGuides(el.getBoundingClientRect())
      chrome.runtime.sendMessage({
        type: 'ELEMENT_LOCKED',
        payload: {
          tagName: el.tagName.toLowerCase(),
          id: el.id,
          classList: Array.from(el.classList).filter(c => !c.startsWith('stylesnap-')),
          rect: { width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height) },
          componentHTML: extractComponentHTML(el, 3),
          componentCSS: extractComponentCSS(el, 3),
        },
      }).catch(() => {})
    }
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

  // ─── Keyboard shortcuts help (?) ───
  if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && isActive()) {
    e.preventDefault()
    e.stopPropagation()
    toggleShortcutsPanel()
    return
  }

  if (e.key === 'Escape' && isActive()) {
    e.preventDefault()
    e.stopPropagation()
    // Priority: unlock, then exit inspect mode
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

  // ─── DOM tree navigation (Arrow keys) ───
  const navEl = lockedElement || lastHighlighted
  if (navEl && isActive() && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault()
    e.stopPropagation()
    const current = navEl
    let target: Element | null = null
    const tag = (el: Element) => el.tagName.toLowerCase()

    switch (e.key) {
      case 'ArrowUp':
        target = current.parentElement
        if (!target || target === document.body) {
          // Try previous sibling instead
          target = current.previousElementSibling
        }
        break
      case 'ArrowDown':
        target = current.firstElementChild
        if (!target) target = current.nextElementSibling
        break
      case 'ArrowLeft':
        target = current.previousElementSibling
        break
      case 'ArrowRight':
        target = current.nextElementSibling
        break
    }

    if (target && target !== document.body && target !== document.documentElement) {
      const parsedCSS = parseElement(target)
      _lastParsedCSS = parsedCSS

      if (lockedElement) {
        // Navigate from locked element → lock on new element
        unlockElement()
        lockElement(target)
        // Don't call highlightElement — locked visual is sufficient,
        // and adding HIGHLIGHT_CLASS on top of LOCKED_CLASS causes it to
        // never be cleaned up (removeHighlight skips when lastHighlighted===lockedElement)
      } else {
        // Navigate from hovered element → hover new element
        removeHighlight()
        lastHighlighted = target
        highlightElement(target)
      }

      showOverlay(target, parsedCSS)
      updateGuides((target as HTMLElement).getBoundingClientRect())
      showToast(`${tag(target)} ${(target as HTMLElement).id ? '#' + (target as HTMLElement).id : classNameOf(target) ? '.' + classNameOf(target).split(/\s+/).filter(c => c && !c.startsWith('stylesnap-')).slice(0,2).join('.') : ''}`)
    }
  }
}

// ─── Hint Bar ──────────────────────────────────────────────────────────

function showHintBar() {
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

function hideHintBar() {
  const bar = $$('stylesnap-hint-bar')
  if (bar) {
    bar.style.opacity = '0'
    bar.addEventListener('transitionend', () => bar.remove(), { once: true })
    setTimeout(() => bar.remove(), 350)
  }
}

// ─── Toast Notification ────────────────────────────────────────────────

let toastTimeout: number | null = null
function showToast(message: string) {
  showToastImpl(message, 2000)
}

function showToastImpl(message: string, duration: number) {
  let toast = $$('stylesnap-toast')
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
      zIndex: '999993',
      pointerEvents: 'none',
      transition: 'opacity 0.2s ease',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      border: '1px solid rgba(255,255,255,0.1)'
    })
    stAppend(toast)
  }
  toast.textContent = message
  toast.style.opacity = '1'
  if (toastTimeout) window.clearTimeout(toastTimeout)
  if (duration > 0) {
    toastTimeout = window.setTimeout(() => {
      if (toast) toast.style.opacity = '0'
    }, duration)
  }
}

// ─── Keyboard Shortcuts Help ──────────────────────────────────────────

function toggleShortcutsPanel() {
  const existing = document.getElementById('stylesnap-shortcuts-panel')
  if (existing) { existing.remove(); return }

  const panel = document.createElement('div')
  panel.id = 'stylesnap-shortcuts-panel'
  panel.setAttribute('data-stylesnap', 'true')

  const shortcuts = [
    ['Hover + Click', 'Lock / unlock element'],
    ['Escape', 'Unlock or exit inspect mode'],
    ['↑ ↓ ← →', 'Navigate parent / child / siblings'],
    ['Space (locked)', 'Toggle compare mode'],
    ['?', 'Show / hide this help'],
  ]

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <h3 style="margin:0;font-size:14px;font-weight:600;color:var(--ss-text, #e2e8f0);">⌨️ Keyboard Shortcuts</h3>
      <button id="ss-shortcuts-close" style="background:none;border:none;color:var(--ss-text-muted, #94a3b8);cursor:pointer;font-size:18px;padding:0 4px;line-height:1;">&times;</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${shortcuts.map(([key, desc]) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
          <span style="color:var(--ss-text-muted, #94a3b8);font-size:11px;">${desc}</span>
          <kbd>${key}</kbd>
        </div>
      `).join('')}
    </div>
    <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);font-size:10px;color:var(--ss-text-dim, #64748b);text-align:center;">
      Press <kbd>?</kbd> anytime to toggle this panel
    </div>
  `

  stAppend(panel)

  const close = attachOutsideClose(panel)
  panel.querySelector('#ss-shortcuts-close')?.addEventListener('click', () => close())
}

// ─── Color Palette Popup ──────────────────────────────────────────────

// ─── Design Popup (Colors + Fonts tabs) ─────────────────────────────
/** Close all hint-bar popups except the one with the given id */
function closeHintPopups(exceptId?: string) {
  ['stylesnap-design-popup', 'stylesnap-history-popup', 'stylesnap-settings-popup'].forEach(id => {
    if (id !== exceptId) $$(id)?.remove()
  })
}

function showDesignPopup(initialTab: 'colors' | 'fonts' = 'colors') {
  // Toggle: if already open, close it
  const existing = $$('stylesnap-design-popup')
  if (existing) { existing.remove(); return }
  // Close other hint popups (mutually exclusive)
  closeHintPopups('stylesnap-design-popup')

  const popup = document.createElement('div')
  popup.id = 'stylesnap-design-popup'
  popup.setAttribute('data-stylesnap', 'true')
  Object.assign(popup.style, {
    position: 'fixed',
    zIndex: '999994',
    background: 'rgba(15, 23, 42, 0.97)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '10px',
    width: '300px',
    maxHeight: '480px',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    fontFamily: 'system-ui, sans-serif',
    color: '#e2e8f0',
    fontSize: '12px',
  })

  const chipGroupStyle = 'display:inline-flex;gap:2px;background:rgba(255,255,255,0.06);border-radius:6px;padding:2px;'
  const tabBtn = (tab: string, label: string, active: boolean) =>
    `<button class="ss-dpop-tab" data-tab="${tab}" style="background:${active ? 'rgba(99,102,241,0.25)' : 'none'};border:none;color:${active ? '#e2e8f0' : '#64748b'};padding:4px 12px;border-radius:4px;font-size:11px;cursor:pointer;font-family:system-ui,sans-serif;">${label}</button>`

  popup.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px 8px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="${chipGroupStyle}">
        ${tabBtn('colors', 'Colors', initialTab === 'colors')}
        ${tabBtn('fonts', 'Fonts', initialTab === 'fonts')}
      </div>
      <button id="ss-design-close" style="background:none;border:none;color:#64748b;cursor:pointer;padding:2px 4px;border-radius:4px;display:flex;">${CLOSE_X}</button>
    </div>
    <div id="ss-dpop-colors" style="display:${initialTab === 'colors' ? 'flex' : 'none'};flex-direction:column;flex:1;min-height:0;">
      <div style="flex:1;overflow-y:auto;padding:10px 12px 6px;" class="ss-hint-scroll">
        <div style="padding:16px;text-align:center;color:#94a3b8;font-size:11px;">Extracting colors…</div>
      </div>
      <div id="ss-dpop-color-actions" style="display:none;flex-shrink:0;padding:8px 12px;border-top:1px solid rgba(255,255,255,0.06);">
        <div style="display:flex;gap:6px;">
          <button id="ss-pal-copy-vars" style="flex:1;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc;border-radius:4px;padding:5px 6px;font-size:10px;cursor:pointer;">Copy CSS Vars</button>
          <button id="ss-pal-copy-json" style="flex:1;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc;border-radius:4px;padding:5px 6px;font-size:10px;cursor:pointer;">Copy JSON</button>
        </div>
      </div>
    </div>
    <div id="ss-dpop-fonts" style="display:${initialTab === 'fonts' ? 'flex' : 'none'};flex-direction:column;flex:1;min-height:0;">
      <div style="flex:1;overflow-y:auto;padding:10px 12px;" class="ss-hint-scroll">
        <div style="padding:16px;text-align:center;color:#94a3b8;font-size:11px;">Scanning fonts…</div>
      </div>
    </div>
  `
  stAppend(popup)

  // Position: centered below hint bar
  const hint = $$('stylesnap-hint-bar')
  const pw = 300
  if (hint) {
    const hRect = hint.getBoundingClientRect()
    const left = Math.max(8, Math.min(hRect.left + hRect.width / 2 - pw / 2, window.innerWidth - pw - 8))
    popup.style.top = `${hRect.bottom + 6}px`
    popup.style.left = `${Math.round(left)}px`
  } else {
    popup.style.top = '60px'
    popup.style.left = `${Math.round(window.innerWidth / 2 - pw / 2)}px`
  }

  popup.querySelector('#ss-design-close')?.addEventListener('click', () => popup.remove())

  // Tab switching — stopPropagation to prevent triggering closeOnOutside
  popup.querySelectorAll('.ss-dpop-tab').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      const tab = (btn as HTMLElement).dataset.tab as 'colors' | 'fonts'
      popup.querySelectorAll('.ss-dpop-tab').forEach(b => {
        ;(b as HTMLElement).style.background = b === btn ? 'rgba(99,102,241,0.25)' : 'none'
        ;(b as HTMLElement).style.color = b === btn ? '#e2e8f0' : '#64748b'
      })
      ;(popup.querySelector('#ss-dpop-colors') as HTMLElement).style.display = tab === 'colors' ? 'flex' : 'none'
      ;(popup.querySelector('#ss-dpop-fonts') as HTMLElement).style.display = tab === 'fonts' ? 'flex' : 'none'
    })
  })

  // Click outside to close — leak-proof, auto-cleans on any removal path
  attachOutsideClose(popup, { delay: 300 })

  // ── Colors tab ──────────────────────────────────────────────────────
  setTimeout(() => {
    try {
      // Collect colors directly via getComputedStyle — more reliable than extractDesignTokens
      const colorMap = new Map<string, string>() // hex → original rgb string
      const colorProps = ['color','background-color','border-top-color','border-bottom-color','border-left-color','border-right-color','outline-color','fill','stroke']
      document.querySelectorAll('*').forEach(node => {
        if ((node as HTMLElement).dataset?.stylesnap) return
        if ((node as Element).id?.startsWith('stylesnap-')) return
        const cs = window.getComputedStyle(node as HTMLElement)
        colorProps.forEach(p => {
          const v = cs.getPropertyValue(p)
          if (!v || v === 'rgba(0, 0, 0, 0)' || v === 'transparent') return
          const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
          if (!m) return
          const hex = '#' + [m[1],m[2],m[3]].map(x => parseInt(x).toString(16).padStart(2,'0')).join('')
          if (!colorMap.has(hex)) colorMap.set(hex, v)
        })
      })
      // Build simple color list
      const colors = Array.from(colorMap.entries()).map(([hex, rgb]) => ({
        value: hex, role: 'other' as const, rgb
      }))
      const colorsPanel = popup.querySelector('#ss-dpop-colors') as HTMLElement

      const scrollEl = colorsPanel.querySelector('.ss-hint-scroll') as HTMLElement
      const actionsEl = popup.querySelector('#ss-dpop-color-actions') as HTMLElement
      if (colors.length === 0) {
        scrollEl.innerHTML = `<div style="padding:16px;text-align:center;color:#94a3b8;font-size:11px;">No colors found</div>`
      } else {
        let paletteFmt = 'hex'
        const hexToRgb = (hex: string) => {
          const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
          return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] as [number,number,number] : null
        }
        const fmtColor = (hex: string, fmt: string) => {
          if (fmt === 'hex') return hex
          const rgb = hexToRgb(hex)
          if (!rgb) return hex
          const [r,g,b] = rgb
          if (fmt === 'rgb') return `rgb(${r}, ${g}, ${b})`
          const rf=r/255,gf=g/255,bf=b/255,max=Math.max(rf,gf,bf),min=Math.min(rf,gf,bf),l=(max+min)/2
          let h=0,s=0
          if(max!==min){const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);if(max===rf)h=((gf-bf)/d+(gf<bf?6:0))/6;else if(max===gf)h=((bf-rf)/d+2)/6;else h=((rf-gf)/d+4)/6}
          return `hsl(${Math.round(h*360)},${Math.round(s*100)}%,${Math.round(l*100)}%)`
        }
        const renderGrid = () => colors.map(c => {
          const display = fmtColor(c.value, paletteFmt)
          return `<div class="ss-design-swatch" data-hex="${c.value}" data-display="${display}" title="${display}" style="cursor:pointer;text-align:center;"><div style="width:100%;aspect-ratio:1;border-radius:6px;background:${c.value};border:1px solid rgba(255,255,255,0.1);"></div><div style="font-size:9px;color:#94a3b8;margin-top:2px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${display}</div></div>`
        }).join('')

        scrollEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:4px;margin-bottom:8px;">
            <span style="font-size:10px;color:#64748b;">${colors.length} colors</span>
            <div style="display:flex;gap:2px;background:rgba(255,255,255,0.05);border-radius:6px;padding:2px;margin-left:auto;">
              ${['hex','rgb','hsl'].map(f => `<button class="ss-pal-fmt" data-fmt="${f}" style="background:${f==='hex'?'rgba(99,102,241,0.25)':'none'};color:${f==='hex'?'#e2e8f0':'#94a3b8'};border:none;border-radius:4px;padding:2px 6px;font-size:10px;font-family:monospace;cursor:pointer;">${f.toUpperCase()}</button>`).join('')}
            </div>
          </div>
          <div id="ss-pal-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(52px,1fr));gap:6px;">${renderGrid()}</div>
        `
        actionsEl.style.display = 'block'

        const attachSwatchHandlers = () => {
          scrollEl.querySelectorAll('.ss-design-swatch').forEach(sw => {
            sw.addEventListener('click', () => {
              const text = (sw as HTMLElement).dataset.display || (sw as HTMLElement).dataset.hex || ''
              navigator.clipboard.writeText(text).then(() => showToast(`Copied ${text}`)).catch(() => {})
            })
          })
        }
        attachSwatchHandlers()
        scrollEl.querySelectorAll('.ss-pal-fmt').forEach(btn => {
          btn.addEventListener('click', () => {
            paletteFmt = (btn as HTMLElement).dataset.fmt || 'hex'
            scrollEl.querySelectorAll('.ss-pal-fmt').forEach(b => {
              ;(b as HTMLElement).style.background = b === btn ? 'rgba(99,102,241,0.25)' : 'none'
              ;(b as HTMLElement).style.color = b === btn ? '#e2e8f0' : '#94a3b8'
            })
            const grid = scrollEl.querySelector('#ss-pal-grid')
            if (grid) { grid.innerHTML = renderGrid(); attachSwatchHandlers() }
          })
        })
        popup.querySelector('#ss-pal-copy-vars')?.addEventListener('click', () => {
          const vars = colors.map((c,i) => `  --color-${i+1}: ${c.value};`).join('\n')
          navigator.clipboard.writeText(`:root {\n${vars}\n}`).then(() => showToast('Copied CSS variables')).catch(() => {})
        })
        popup.querySelector('#ss-pal-copy-json')?.addEventListener('click', () => {
          navigator.clipboard.writeText(JSON.stringify({colors: colors.map(c => c.value)},null,2)).then(() => showToast('Copied JSON')).catch(() => {})
        })
      }
    } catch { (popup.querySelector('#ss-dpop-colors .ss-hint-scroll') as HTMLElement).innerHTML = `<div style="padding:16px;text-align:center;color:#f87171;">Extraction failed</div>` }
  }, 50)

  // ── Fonts tab ───────────────────────────────────────────────────────
  setTimeout(() => {
    try {
      const fontMap = new Map<string, {sizes: Set<string>, weights: Set<string>}>()
      document.querySelectorAll('*').forEach(node => {
        if ((node as HTMLElement).dataset?.stylesnap) return
        if (node.id?.startsWith('stylesnap-')) return
        const cs = window.getComputedStyle(node as HTMLElement)
        const ff = cs.fontFamily.split(',')[0].replace(/['"]/g,'').trim()
        if (!ff) return
        if (!fontMap.has(ff)) fontMap.set(ff, {sizes: new Set(), weights: new Set()})
        const entry = fontMap.get(ff)!
        entry.sizes.add(cs.fontSize)
        entry.weights.add(cs.fontWeight)
      })
      const fontsScroll = popup.querySelector('#ss-dpop-fonts .ss-hint-scroll') as HTMLElement
      if (fontMap.size === 0) {
        fontsScroll.innerHTML = `<div style="padding:16px;text-align:center;color:#94a3b8;font-size:11px;">No fonts found</div>`
        return
      }
      const rows = Array.from(fontMap.entries()).map(([family, data]) => {
        const sizes = Array.from(data.sizes).sort((a,b) => parseFloat(a)-parseFloat(b)).slice(0,6).join(', ')
        const weights = Array.from(data.weights).sort((a,b) => +a - +b).join(', ')
        return `<div style="margin-bottom:10px;padding:8px;background:rgba(255,255,255,0.04);border-radius:6px;border:1px solid rgba(255,255,255,0.06);">
          <div style="font-weight:600;font-size:12px;color:#e2e8f0;margin-bottom:4px;">${family}</div>
          <div style="font-size:10px;color:#94a3b8;">Sizes: ${sizes}</div>
          <div style="font-size:10px;color:#94a3b8;">Weights: ${weights}</div>
          <div style="margin-top:4px;font-family:${family};font-size:13px;color:#cbd5e1;">The quick brown fox</div>
        </div>`
      }).join('')
      fontsScroll.innerHTML = `<div style="font-size:10px;color:#64748b;margin-bottom:8px;">${fontMap.size} font families</div>${rows}`
    } catch { /* noop */ }
  }, 80)
}


// ─── History Panel (Feature 4) ────────────────────────────────────────
function showHistoryPanel() {
  const existing = $$('stylesnap-history-popup')
  if (existing) { existing.remove(); return }
  closeHintPopups('stylesnap-history-popup')

  const popup = document.createElement('div')
  popup.id = 'stylesnap-history-popup'
  popup.setAttribute('data-stylesnap', 'true')
  Object.assign(popup.style, {
    position: 'fixed',
    zIndex: '999994',
    background: 'rgba(15, 23, 42, 0.97)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '10px',
    padding: '12px',
    width: '260px',
    maxHeight: '380px',
    overflowY: 'auto',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    fontFamily: 'system-ui, sans-serif',
    color: '#e2e8f0',
    fontSize: '12px',
  })
  const hint = $$('stylesnap-hint-bar')
  if (hint && window.getComputedStyle(hint).opacity !== '0') {
    const hRect = hint.getBoundingClientRect()
    popup.style.top = `${hRect.bottom + 6}px`
    popup.style.left = '50%'
    popup.style.transform = 'translateX(-50%)'
  } else {
    popup.style.top = '60px'
    popup.style.right = '24px'
  }

  const timeAgo = (ts: number) => {
    const s = Math.round((Date.now() - ts) / 1000)
    if (s < 60) return `${s}s ago`
    const m = Math.round(s / 60)
    if (m < 60) return `${m}m ago`
    return `${Math.round(m/60)}h ago`
  }

  const renderItems = () => {
    if (_history.length === 0) return `<div style="padding:16px;text-align:center;color:#94a3b8;">No history yet — lock elements with click</div>`
    return _history.map((item, i) => `
      <div class="ss-history-item" data-idx="${i}" style="margin-bottom:6px;padding:8px;background:rgba(255,255,255,0.04);border-radius:6px;border:1px solid rgba(255,255,255,0.06);cursor:pointer;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:600;font-size:11px;color:#a5b4fc;">&lt;${item.tag}&gt;</span>
          <span style="font-size:10px;color:#64748b;">${timeAgo(item.timestamp)}</span>
        </div>
        <div style="font-size:10px;color:#94a3b8;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.selector}</div>
        <div style="font-size:9px;color:#475569;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;">${item.snippet.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
      </div>`).join('')
  }

  popup.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <span style="font-weight:600;font-size:13px;">History</span>
      <span style="font-size:11px;color:#64748b;">${_history.length} items</span>
      <button id="ss-history-close" style="background:none;border:none;color:#64748b;cursor:pointer;padding:2px 4px;border-radius:4px;display:flex;">${CLOSE_X}</button>
    </div>
    <div id="ss-history-list">${renderItems()}</div>
  `
  stAppend(popup)

  popup.querySelector('#ss-history-close')?.addEventListener('click', () => popup.remove())

  popup.querySelectorAll('.ss-history-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt((item as HTMLElement).dataset.idx || '0')
      const snap = _history[idx]
      if (!snap) return
      popup.remove()
      // Try to find the element on the current page
      let target: Element | null = null
      try { target = document.querySelector(snap.selector) } catch (_) {}
      if (target && document.body.contains(target)) {
        // Element still exists — lock and show overlay
        unlockElement()
        lockElement(target as Element)
        const parsedCSS = parseElement(target)
        _lastParsedCSS = parsedCSS
        showOverlay(target, parsedCSS)
        showToast(`Re-locked <${snap.tag}>`)
      } else {
        showToast('Element no longer on this page — inspect a similar element')
      }
    })
  })

  attachOutsideClose(popup, { delay: 200 })
}

// ─── Export Dropdown Menu ─────────────────────────────────────────────

// ─── CSS → Tailwind mapping ─────────────────────────────────────────
// Extracts design tokens from computed styles and maps them to Tailwind classes.

const TW_COLORS: Record<string, string[]> = {
  '#fef2f2': ['red-50'], '#fee2e2': ['red-100'], '#fecaca': ['red-200'], '#fca5a5': ['red-300'],
  '#f87171': ['red-400'], '#ef4444': ['red-500'], '#dc2626': ['red-600'], '#b91c1c': ['red-700'],
  '#991b1b': ['red-800'], '#7f1d1d': ['red-900'],
  '#fff7ed': ['orange-50'], '#ffedd5': ['orange-100'], '#fed7aa': ['orange-200'], '#fdba74': ['orange-300'],
  '#fb923c': ['orange-400'], '#f97316': ['orange-500'], '#ea580c': ['orange-600'], '#c2410c': ['orange-700'],
  '#9a3412': ['orange-800'], '#7c2d12': ['orange-900'],
  '#fffbeb': ['amber-50'], '#fef3c7': ['amber-100'], '#fde68a': ['amber-200'], '#fcd34d': ['amber-300'],
  '#fbbf24': ['amber-400'], '#f59e0b': ['amber-500'], '#d97706': ['amber-600'], '#b45309': ['amber-700'],
  '#92400e': ['amber-800'], '#78350f': ['amber-900'],
  '#fefce8': ['yellow-50'], '#fef9c3': ['yellow-100'], '#fef08a': ['yellow-200'], '#fde047': ['yellow-300'],
  '#facc15': ['yellow-400'], '#eab308': ['yellow-500'], '#ca8a04': ['yellow-600'], '#a16207': ['yellow-700'],
  '#854d0e': ['yellow-800'], '#713f12': ['yellow-900'],
  '#f7fee7': ['lime-50'], '#ecfccb': ['lime-100'], '#d9f99d': ['lime-200'], '#bef264': ['lime-300'],
  '#a3e635': ['lime-400'], '#84cc16': ['lime-500'], '#65a30d': ['lime-600'], '#4d7c0f': ['lime-700'],
  '#3f6212': ['lime-800'], '#365314': ['lime-900'],
  '#f0fdf4': ['green-50'], '#dcfce7': ['green-100'], '#bbf7d0': ['green-200'], '#86efac': ['green-300'],
  '#4ade80': ['green-400'], '#22c55e': ['green-500'], '#16a34a': ['green-600'], '#15803d': ['green-700'],
  '#166534': ['green-800'], '#14532d': ['green-900'],
  '#ecfdf5': ['emerald-50'], '#d1fae5': ['emerald-100'], '#a7f3d0': ['emerald-200'], '#6ee7b7': ['emerald-300'],
  '#34d399': ['emerald-400'], '#10b981': ['emerald-500'], '#059669': ['emerald-600'], '#047857': ['emerald-700'],
  '#065f46': ['emerald-800'], '#064e3b': ['emerald-900'],
  '#f0fdfa': ['teal-50'], '#ccfbf1': ['teal-100'], '#99f6e4': ['teal-200'], '#5eead4': ['teal-300'],
  '#2dd4bf': ['teal-400'], '#14b8a6': ['teal-500'], '#0d9488': ['teal-600'], '#0f766e': ['teal-700'],
  '#115e59': ['teal-800'], '#134e4a': ['teal-900'],
  '#ecfeff': ['cyan-50'], '#cffafe': ['cyan-100'], '#a5f3fc': ['cyan-200'], '#67e8f9': ['cyan-300'],
  '#22d3ee': ['cyan-400'], '#06b6d4': ['cyan-500'], '#0891b2': ['cyan-600'], '#0e7490': ['cyan-700'],
  '#155e75': ['cyan-800'], '#164e63': ['cyan-900'],
  '#f0f9ff': ['sky-50'], '#e0f2fe': ['sky-100'], '#bae6fd': ['sky-200'], '#7dd3fc': ['sky-300'],
  '#38bdf8': ['sky-400'], '#0ea5e9': ['sky-500'], '#0284c7': ['sky-600'], '#0369a1': ['sky-700'],
  '#075985': ['sky-800'], '#0c4a6e': ['sky-900'],
  '#eff6ff': ['blue-50'], '#dbeafe': ['blue-100'], '#bfdbfe': ['blue-200'], '#93c5fd': ['blue-300'],
  '#60a5fa': ['blue-400'], '#3b82f6': ['blue-500'], '#2563eb': ['blue-600'], '#1d4ed8': ['blue-700'],
  '#1e40af': ['blue-800'], '#1e3a8a': ['blue-900'],
  '#eef2ff': ['indigo-50'], '#e0e7ff': ['indigo-100'], '#c7d2fe': ['indigo-200'], '#a5b4fc': ['indigo-300'],
  '#818cf8': ['indigo-400'], '#6366f1': ['indigo-500'], '#4f46e5': ['indigo-600'], '#4338ca': ['indigo-700'],
  '#3730a3': ['indigo-800'], '#312e81': ['indigo-900'],
  '#f5f3ff': ['violet-50'], '#ede9fe': ['violet-100'], '#ddd6fe': ['violet-200'], '#c4b5fd': ['violet-300'],
  '#a78bfa': ['violet-400'], '#8b5cf6': ['violet-500'], '#7c3aed': ['violet-600'], '#6d28d9': ['violet-700'],
  '#5b21b6': ['violet-800'], '#4c1d95': ['violet-900'],
  '#faf5ff': ['purple-50'], '#f3e8ff': ['purple-100'], '#e9d5ff': ['purple-200'], '#d8b4fe': ['purple-300'],
  '#c084fc': ['purple-400'], '#a855f7': ['purple-500'], '#9333ea': ['purple-600'], '#7e22ce': ['purple-700'],
  '#6b21a8': ['purple-800'], '#581c87': ['purple-900'],
  '#fdf4ff': ['fuchsia-50'], '#fae8ff': ['fuchsia-100'], '#f5d0fe': ['fuchsia-200'], '#f0abfc': ['fuchsia-300'],
  '#e879f9': ['fuchsia-400'], '#d946ef': ['fuchsia-500'], '#c026d3': ['fuchsia-600'], '#a21caf': ['fuchsia-700'],
  '#86198f': ['fuchsia-800'], '#701a75': ['fuchsia-900'],
  '#fdf2f8': ['pink-50'], '#fce7f3': ['pink-100'], '#fbcfe8': ['pink-200'], '#f9a8d4': ['pink-300'],
  '#f472b6': ['pink-400'], '#ec4899': ['pink-500'], '#db2777': ['pink-600'], '#be185d': ['pink-700'],
  '#9d174d': ['pink-800'], '#831843': ['pink-900'],
  '#fff1f2': ['rose-50'], '#ffe4e6': ['rose-100'], '#fecdd3': ['rose-200'], '#fda4af': ['rose-300'],
  '#fb7185': ['rose-400'], '#f43f5e': ['rose-500'], '#e11d48': ['rose-600'], '#be123c': ['rose-700'],
  '#9f1239': ['rose-800'], '#881337': ['rose-900'],
  '#f8fafc': ['slate-50'], '#f1f5f9': ['slate-100'], '#e2e8f0': ['slate-200'], '#cbd5e1': ['slate-300'],
  '#94a3b8': ['slate-400'], '#64748b': ['slate-500'], '#475569': ['slate-600'], '#334155': ['slate-700'],
  '#1e293b': ['slate-800'], '#0f172a': ['slate-900'],
  '#f9fafb': ['gray-50'], '#f3f4f6': ['gray-100'], '#e5e7eb': ['gray-200'], '#d1d5db': ['gray-300'],
  '#9ca3af': ['gray-400'], '#6b7280': ['gray-500'], '#4b5563': ['gray-600'], '#374151': ['gray-700'],
  '#1f2937': ['gray-800'], '#111827': ['gray-900'],
  '#fafafa': ['neutral-50'], '#f5f5f5': ['neutral-100'], '#e5e5e5': ['neutral-200'], '#d4d4d4': ['neutral-300'],
  '#a3a3a3': ['neutral-400'], '#737373': ['neutral-500'], '#525252': ['neutral-600'], '#404040': ['neutral-700'],
  '#262626': ['neutral-800'], '#171717': ['neutral-900'],
  '#f4f4f5': ['zinc-100'], '#e4e4e7': ['zinc-200'], '#d4d4d8': ['zinc-300'], '#a1a1aa': ['zinc-400'],
  '#71717a': ['zinc-500'], '#52525b': ['zinc-600'], '#3f3f46': ['zinc-700'], '#27272a': ['zinc-800'],
  '#18181b': ['zinc-900'],
  '#ffffff': ['white'], '#fff': ['white'],
  '#000000': ['black'], '#000': ['black'],
  'transparent': ['transparent'], 'currentcolor': ['current'],
}

// Convert #rgb / #rrggbb to lowercase hex for lookup
function normalizeHex(val: string): string {
  if (val === 'transparent' || val === 'currentcolor') return val
  if (val.startsWith('#')) {
    const m = val.match(/^#([0-9a-fA-F]{3,8})$/)
    if (!m) return val.toLowerCase()
    const hex = m[1]
    if (hex.length === 3) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    if (hex.length === 4) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    if (hex.length === 8) return `#${hex.slice(0, 6)}`
    return `#${hex}`
  }
  // rgb / rgba
  const m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (m) {
    const r = parseInt(m[1], 10), g = parseInt(m[2], 10), b = parseInt(m[3], 10)
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
  }
  return val.toLowerCase()
}

function matchColor(val: string): string | null {
  const hex = normalizeHex(val)
  return TW_COLORS[hex]?.[0] ?? null
}

// px → Tailwind spacing scale (4px = 1 unit)
const TW_SPACING: [number, string][] = [
  [0, '0'], [2, '0.5'], [4, '1'], [6, '1.5'], [8, '2'], [10, '2.5'], [12, '3'], [14, '3.5'],
  [16, '4'], [20, '5'], [24, '6'], [28, '7'], [32, '8'], [36, '9'], [40, '10'], [44, '11'],
  [48, '12'], [56, '14'], [64, '16'], [72, '18'], [80, '20'], [96, '24'], [112, '28'],
  [128, '32'], [144, '36'], [160, '40'], [176, '44'], [192, '48'], [208, '52'], [224, '56'],
  [240, '60'], [256, '64'], [288, '72'], [320, '80'], [384, '96'],
]

function matchSpacing(px: number): string | null {
  for (let i = TW_SPACING.length - 1; i >= 0; i--) {
    if (px >= TW_SPACING[i][0] - 0.5 && px <= TW_SPACING[i][0] + 0.5) return TW_SPACING[i][1]
  }
  return null
}

const TW_FONT_SIZE: [string, number][] = [
  ['xs', 12], ['sm', 14], ['base', 16], ['lg', 18], ['xl', 20],
  ['2xl', 24], ['3xl', 30], ['4xl', 36], ['5xl', 48], ['6xl', 60], ['7xl', 72], ['8xl', 96], ['9xl', 128],
]
const TW_FONT_WEIGHT: Record<string, string> = { '100': 'thin', '200': 'extralight', '300': 'light', '400': 'normal', '500': 'medium', '600': 'semibold', '700': 'bold', '800': 'extrabold', '900': 'black' }
const TW_BORDER_RADIUS: [string, number][] = [
  ['none', 0], ['sm', 2], ['', 4], ['md', 6], ['lg', 8], ['xl', 12], ['2xl', 16], ['3xl', 24],
]
const TW_SHADOW: Record<string, string> = {
  '0 1px 2px 0 rgba(0,0,0,0.05)': 'sm', '0 1px 3px 0 rgba(0,0,0,0.1)': 'DEFAULT',
  '0 4px 6px -1px rgba(0,0,0,0.1)': 'md', '0 10px 15px -3px rgba(0,0,0,0.1)': 'lg',
  '0 20px 25px -5px rgba(0,0,0,0.1)': 'xl', '0 25px 50px -12px rgba(0,0,0,0.25)': '2xl',
}

function mapCSSToTailwind(styles: CSSStyleDeclaration): string[] {
  const classes: string[] = []
  const props = new Map<string, string>()
  for (let i = 0; i < styles.length; i++) {
    const p = styles[i]
    const v = styles.getPropertyValue(p)
    if (v && !['initial', 'none', 'auto', 'normal'].includes(v) && v !== 'rgba(0, 0, 0, 0)') {
      props.set(p, v)
    }
  }

  // Color props
  for (const [cssProp, twPrefix] of [['color', 'text'], ['background-color', 'bg'], ['border-color', 'border']] as const) {
    const val = props.get(cssProp)
    if (val) {
      const c = matchColor(val)
      if (c) classes.push(`${twPrefix}-${c}`)
    }
  }

  // Spacing: padding / margin / gap / width / height
  for (const [cssProp, twPrefix] of [
    ['padding', 'p'], ['padding-top', 'pt'], ['padding-right', 'pr'], ['padding-bottom', 'pb'], ['padding-left', 'pl'],
    ['padding-inline', 'px'], ['padding-block', 'py'],
    ['margin', 'm'], ['margin-top', 'mt'], ['margin-right', 'mr'], ['margin-bottom', 'mb'], ['margin-left', 'ml'],
    ['gap', 'gap'], ['row-gap', 'gap-y'], ['column-gap', 'gap-x'],
    ['width', 'w'], ['min-width', 'min-w'], ['max-width', 'max-w'],
    ['height', 'h'], ['min-height', 'min-h'], ['max-height', 'max-h'],
  ] as const) {
    const val = props.get(cssProp)
    if (val) {
      const px = parseFloat(val)
      if (!isNaN(px)) {
        const s = matchSpacing(px)
        if (s) classes.push(`${twPrefix}-${s}`)
      }
    }
  }

  // Font size
  const fontSize = props.get('font-size')
  if (fontSize) {
    const px = parseFloat(fontSize)
    if (!isNaN(px)) {
      for (const [name, size] of TW_FONT_SIZE) {
        if (Math.abs(px - size) <= 1) { classes.push(`text-${name}`); break }
      }
    }
  }

  // Font weight
  const fontWeight = props.get('font-weight')
  if (fontWeight && TW_FONT_WEIGHT[fontWeight]) classes.push(`font-${TW_FONT_WEIGHT[fontWeight]}`)

  // Line height
  const lineHeight = props.get('line-height')
  if (lineHeight) {
    const n = parseFloat(lineHeight)
    if (!isNaN(n)) {
      if (n >= 2.4 && n <= 2.6) classes.push('leading-loose')
      else if (n >= 1.6 && n <= 1.8) classes.push('leading-relaxed')
      else if (n >= 1.4 && n <= 1.55) classes.push('leading-normal')
      else if (n >= 1.2 && n <= 1.35) classes.push('leading-snug')
      else if (n >= 0.95 && n <= 1.1) classes.push('leading-tight')
      else {
        // Try px matching
        const s = matchSpacing(n)
        if (s) classes.push(`leading-[${n}px]`)
        else classes.push(`leading-[${n}]`)
      }
    }
  }

  // Border radius
  const borderRadius = props.get('border-radius')
  if (borderRadius) {
    const px = parseFloat(borderRadius)
    if (!isNaN(px)) {
      if (px >= 999) classes.push('rounded-full')
      else {
        for (const [name, size] of TW_BORDER_RADIUS) {
          if (Math.abs(px - size) <= 1) { classes.push(name ? `rounded-${name}` : 'rounded'); break }
        }
      }
    }
  }

  // Display
  const display = props.get('display')
  if (display === 'flex') classes.push('flex')
  else if (display === 'grid') classes.push('grid')
  else if (display === 'block') classes.push('block')
  else if (display === 'inline-block') classes.push('inline-block')
  else if (display === 'inline') classes.push('inline')
  else if (display === 'inline-flex') classes.push('inline-flex')
  else if (display === 'none') classes.push('hidden')

  // Flex direction
  const flexDir = props.get('flex-direction')
  if (flexDir === 'column') classes.push('flex-col')
  else if (flexDir === 'row') classes.push('flex-row')
  else if (flexDir === 'column-reverse') classes.push('flex-col-reverse')

  // Align / Justify
  const alignMap: Record<string, string> = { 'center': 'center', 'flex-start': 'start', 'flex-end': 'end', 'stretch': 'stretch', 'space-between': 'between', 'space-around': 'around', 'space-evenly': 'evenly' }
  const alignItems = props.get('align-items')
  if (alignItems && alignMap[alignItems]) classes.push(`items-${alignMap[alignItems]}`)
  const justifyContent = props.get('justify-content')
  if (justifyContent && alignMap[justifyContent]) classes.push(`justify-${alignMap[justifyContent]}`)

  // Text align
  const textAlign = props.get('text-align')
  if (textAlign === 'center') classes.push('text-center')
  else if (textAlign === 'right') classes.push('text-right')
  else if (textAlign === 'justify') classes.push('text-justify')

  // Cursor
  const cursor = props.get('cursor')
  if (cursor === 'pointer') classes.push('cursor-pointer')
  else if (cursor === 'not-allowed') classes.push('cursor-not-allowed')
  else if (cursor === 'wait') classes.push('cursor-wait')

  // Opacity
  const opacity = props.get('opacity')
  if (opacity && opacity !== '1') {
    const n = parseInt(String(parseFloat(opacity) * 100))
    if (!isNaN(n) && n % 5 === 0 && n <= 100) classes.push(`opacity-${n}`)
  }

  // Box shadow
  const boxShadow = props.get('box-shadow')
  if (boxShadow && boxShadow !== 'none') {
    const matched = TW_SHADOW[boxShadow]
    if (matched) classes.push(matched === 'DEFAULT' ? 'shadow' : `shadow-${matched}`)
    else classes.push('shadow-lg') // best-effort fallback
  }

  // Position
  const position = props.get('position')
  if (position === 'relative') classes.push('relative')
  else if (position === 'absolute') classes.push('absolute')
  else if (position === 'fixed') classes.push('fixed')
  else if (position === 'sticky') classes.push('sticky')

  // Overflow
  const overflow = props.get('overflow')
  if (overflow === 'hidden') classes.push('overflow-hidden')
  else if (overflow === 'auto') classes.push('overflow-auto')
  else if (overflow === 'scroll') classes.push('overflow-scroll')

  return classes
}

// ─── CodePen Export Helpers ─────────────────────────────────────────

function getComponentCSSForExport(el: Element): string {
  const { rules, mediaRules, pseudoRules } = getComponentCSS(el)

  // Resolve CSS custom properties (var()) using computed style
  const computedEl = window.getComputedStyle(el)
  function resolveVar(value: string): string {
    if (!value.includes('var(')) return value
    return value.replace(/var\((--[^,)]+)(?:,\s*([^)]+))?\)/g, (_, name: string, fallback: string | undefined) => {
      const resolved = computedEl.getPropertyValue(name).trim()
      return resolved || fallback || name
    })
  }
  // Build lookup: element → computedStyle (for descendant elements)
  function resolveProps(elRef: Element, props: Record<string, string>): Record<string, string> {
    const comp = elRef === el ? computedEl : window.getComputedStyle(elRef)
    const resolved: Record<string, string> = {}
    for (const [k, v] of Object.entries(props)) {
      if (v.includes('var(')) {
        const compVal = comp.getPropertyValue(k).trim()
        resolved[k] = compVal || resolveVar(v)
      } else {
        resolved[k] = v
      }
    }
    return resolved
  }

  // ─── Computed styles fallback (for when external/CDN stylesheets are inaccessible) ───
  // These are layout-critical properties that make the element render correctly
  // even without the full Tailwind/Svelte ecosystem.
  const LAYOUT_PROPS = new Set([
    'box-sizing', 'display', 'position', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink',
    'justify-content', 'align-items', 'align-self', 'gap', 'row-gap', 'column-gap',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border', 'border-width', 'border-style', 'border-color', 'border-radius',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
    'background', 'background-color', 'background-image', 'background-size',
    'overflow', 'overflow-x', 'overflow-y',
    'font-size', 'font-family', 'font-weight', 'line-height', 'letter-spacing',
    'color', 'opacity', 'cursor', 'aspect-ratio',
    'transform', 'transition',
    'user-select', 'pointer-events',
  ])

  // Build a computed-style block for the main element
  function getComputedFallback(): Record<string, string> {
    const fallback: Record<string, string> = {}
    for (let i = 0; i < computedEl.length; i++) {
      const prop = computedEl[i]
      if (!LAYOUT_PROPS.has(prop)) continue
      const val = computedEl.getPropertyValue(prop)
      if (!val || val === 'none' || val === 'auto' || val === 'normal') continue
      // Skip default-ish values
      if (prop === 'box-sizing' && val === 'border-box') { fallback[prop] = val; continue }
      if (prop === 'display' && (val === 'block' || val === 'inline')) continue
      if (prop === 'position' && val === 'static') continue
      if (prop === 'flex-wrap' && val === 'nowrap') continue
      if (prop === 'flex-direction' && val === 'row') continue
      if (prop === 'overflow' && val === 'visible') continue
      if (prop === 'opacity' && val === '1') continue
      if (prop === 'cursor' && val === 'auto') continue
      fallback[prop] = val
    }
    return fallback
  }

  const computedFallback = getComputedFallback()

  // ─── Extract :root / html custom properties (critical for rendering) ───
  // These define all theme variables (--primary, --background, etc.) that
  // elements reference via var(). Without them, the export won't render.
  const rootVars: Record<string, string> = {}
  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode as HTMLElement | null
    if (owner?.tagName !== 'STYLE') {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.type !== CSSRule.STYLE_RULE) continue
          const sr = rule as CSSStyleRule
          if (sr.selectorText === ':root' || sr.selectorText === 'html' ||
              sr.selectorText === ':root, html' || sr.selectorText === 'html, :root') {
            Object.assign(rootVars, parseRulePropsRaw(sr.cssText))
          }
        }
      } catch (_) {}
    }
  }
  // Also check <style> tags for :root blocks
  for (const st of document.querySelectorAll('style')) {
    const text = st.textContent?.replace(/\/\*[\s\S]*?\*\//g, '') || ''
    let pos = 0
    while (pos < text.length) {
      const rootStart = text.indexOf(':root', pos)
      if (rootStart === -1) break
      const braceStart = text.indexOf('{', rootStart)
      if (braceStart === -1) { pos = rootStart + 5; continue }
      let depth = 1; let i = braceStart + 1
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') depth--
        i++
      }
      const body = text.substring(braceStart + 1, i - 1)
      Object.assign(rootVars, parseRulePropsRaw(body))
      pos = i
    }
  }
  // Only keep custom properties (--*) from :root, resolved by computed style
  const rootCustomProps: Record<string, string> = {}
  const resolvedRoot = window.getComputedStyle(document.documentElement)
  for (const [k, v] of Object.entries(rootVars)) {
    if (k.startsWith('--')) {
      const resolved = resolvedRoot.getPropertyValue(k).trim()
      rootCustomProps[k] = resolved || v
    }
  }

  const cssLines: string[] = []

  // :root block with all custom properties (at the top so they're available)
  if (Object.keys(rootCustomProps).length > 0) {
    const rootLines = Object.entries(rootCustomProps).map(([k, v]) => `  ${k}: ${v};`)
    cssLines.push(`:root {\n${rootLines.join('\n')}\n}`)
  }

  // ─── SVG chart helper styles (grid lines, bars — for when Tailwind/CDN CSS isn't accessible) ───
  const svgHelpers = [
    `svg { display: block; overflow: visible; }`,
    `.lc-grid-y-line, .lc-grid-x-line { stroke: var(--border, #e2e8f0); stroke-width: 1; }`,
    `.lc-grid-y-rule, .lc-grid-x-rule { stroke: var(--border, #e2e8f0); stroke-width: 1; }`,
    `.lc-bar { rx: 4; ry: 4; }`,
  ]
  cssLines.push(`/* SVG chart helpers */\n${svgHelpers.join('\n')}`)

  // Build the main element's selector block: stylesheet rules + computed fallback
  const sorted = Array.from(rules.keys()).sort((a, b) => a.length - b.length)
  // Find the best selector for the element itself (the one matching exactly, not a generic one)
  const elSelectors: string[] = []
  const otherSelectors: string[] = []
  for (const sel of sorted) {
    // If the selector targets ONLY this element specifically (not descendants), use it for the main block
    const isElSelector = sel.split(',').some(s => {
      try { return el === document.querySelector(s.trim().replace(/:hover|:focus|:active/g, '')) } catch { return false }
    })
    if (isElSelector) elSelectors.push(sel)
    else otherSelectors.push(sel)
  }

  // Main element block: merge all exact selectors + computed fallback
  if (elSelectors.length > 0 || Object.keys(computedFallback).length > 0) {
    const mainProps: Record<string, string> = { ...computedFallback }
    for (const sel of elSelectors) {
      Object.assign(mainProps, resolveProps(el, rules.get(sel)!))
    }
    // Use the most specific selector for the element
    const bestSelector = elSelectors.length > 0
      ? elSelectors.reduce((a, b) => a.length > b.length ? a : b)
      : el.id ? `#${el.id}`
      : classNameOf(el).replace(/stylesnap-\S*/g, '').trim()
        ? `.${classNameOf(el).split(/\s+/).filter(c => c && !c.startsWith('stylesnap-')).slice(0, 3).join('.')}`
        : el.tagName.toLowerCase()
    const mainLines = Object.entries(mainProps).map(([k, v]) => `  ${k}: ${v};`)
    cssLines.push(`${bestSelector} {\n${mainLines.join('\n')}\n}`)
  }

  // Other stylesheet rules (descendants, pseudo-classes)
  for (const sel of otherSelectors) {
    const props = resolveProps(el, rules.get(sel)!)
    if (Object.keys(props).length === 0) continue
    const lines = Object.entries(props).map(([k, v]) => `  ${k}: ${v};`)
    cssLines.push(`${sel} {\n${lines.join('\n')}\n}`)
  }

  // Pseudo-class rules
  for (const pr of pseudoRules) {
    const props = resolveProps(el, pr.props)
    const lines = Object.entries(props).map(([k, v]) => `  ${k}: ${v};`)
    cssLines.push(`${pr.selector} {\n${lines.join('\n')}\n}`)
  }

  // Media query rules
  const seen = new Set<string>()
  for (const mr of mediaRules) {
    const key = mr.query + mr.selector
    if (seen.has(key)) continue
    seen.add(key)
    const props = resolveProps(el, mr.props)
    const lines = Object.entries(props).map(([k, v]) => `  ${k}: ${v};`)
    cssLines.push(`@media ${mr.query} {\n${mr.selector} {\n${lines.join('\n')}\n  }\n}`)
  }
  return cssLines.join('\n\n')
}

function getTailwindClasses(el: Element): string {
  const htmlEl = el as HTMLElement
  htmlEl.classList.remove(LOCKED_CLASS)
  const styles = window.getComputedStyle(htmlEl)
  htmlEl.classList.add(LOCKED_CLASS)
  return mapCSSToTailwind(styles).join(' ')
}

function submitCodePen(data: Record<string, string>) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = 'https://codepen.io/pen/define'
  form.target = '_blank'
  form.setAttribute('data-stylesnap', 'true')
  const input = document.createElement('input')
  input.type = 'hidden'
  input.name = 'data'
  input.value = JSON.stringify(data)
  form.appendChild(input)
  document.body.appendChild(form)
  form.submit()
  document.body.removeChild(form)
  showToast('Opening CodePen...')
}

function exportCSSToCodePen() {
  const el = lockedElement as HTMLElement
  if (!el) return
  const title = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
  submitCodePen({
    title: `StyleSnap — ${title} (CSS)`,
    html: extractComponentHTML(el, 2),
    css: `/* Exported by StyleSnap */\n${getComponentCSSForExport(el)}`,
    editors: '110',
  })
}

/**
 * Check if any node in the component tree matches a CSS selector
 */
function matchesAnyNode(treeNodes: Element[], selector: string): boolean {
  for (const node of treeNodes) {
    try { if (node.matches(selector)) return true } catch (_) {}
  }
  return false
}

/**
 * Parse CSS properties from raw rule body or full rule.cssText.
 * Handles both "prop: val; prop2: val2" and "selector { prop: val; }"
 */
function parseRulePropsRaw(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!text) return result
  // If it's a full rule.cssText, extract just the body
  const body = text.match(/\{([^}]*)\}/)?.[1] || text
  for (const part of body.split(';')) {
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const prop = part.substring(0, idx).trim()
    const value = part.substring(idx + 1).trim()
    if (prop && value) result[prop] = value
  }
  return result
}

/**
 * Extract pseudo-class from selector text.
 * e.g. ".demo-btn:hover" → "hover", returns null if none
 */
function extractPseudoFromSelector(selector: string): string | null {
  const m = selector.match(/:(hover|focus|active|visited|link|target)/)
  return m ? m[1] : null
}

// ─── Settings Popup ───────────────────────────────────────────────────

// ─── AI Component Generator ──────────────────────────────────────────

function extractARIA(el: Element, depth = 0): string {
  if (depth > 10) return ''
  const lines: string[] = []
  const ariaAttrs = el.getAttributeNames().filter(a => a.startsWith('aria-') || a === 'role')
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const classes = classNameOf(el).split(/\s+/).filter(c => c && !c.startsWith('stylesnap-')).join('.')
  const sel = id || (classes ? `${tag}.${classes}` : tag)

  if (ariaAttrs.length > 0) {
    const attrs = ariaAttrs.map(a => `  ${a}="${el.getAttribute(a)}"`).join('\n')
    lines.push(`<${sel}>\n${attrs}`)
  }

  for (const child of Array.from(el.children)) {
    const c = extractARIA(child, depth + 1)
    if (c) lines.push(c)
  }
  return lines.join('\n')
}

function extractDOMSummary(el: Element, depth = 0): string {
  if (depth > 6) return ''
  const tag = el.tagName.toLowerCase()
  const id = el.id ? ` id="${el.id}"` : ''
  const cls = classNameOf(el).replace(/stylesnap-\S+/g, '').trim()
  const classStr = cls ? ` class="${cls}"` : ''
  const children = Array.from(el.children).slice(0, 8)
    .map(c => extractDOMSummary(c, depth + 1))
    .filter(Boolean)
    .join('')
  const indent = '  '.repeat(depth)
  if (children) {
    return `${indent}<${tag}${id}${classStr}>\n${children}${indent}</${tag}>\n`
  }
  const text = (el.textContent || '').trim().substring(0, 60)
  return `${indent}<${tag}${id}${classStr}>${text ? ` ${text} ` : ''}</${tag}>\n`
}

function extractAnimations(el: Element): string {
  const anims = (el as HTMLElement).getAnimations?.() || []
  if (anims.length === 0) return ''
  return anims.map(a => {
    const effect = a.effect as KeyframeEffect | null
    const timing = effect?.getTiming() || {}
    const kfs = effect?.getKeyframes() || []
    const kfLines = kfs.map((k, i) => {
      const pct = k.offset !== undefined ? `${Math.round((k.offset as number) * 100)}%` : i === 0 ? '0%' : '100%'
      const props = Object.entries(k).filter(([key]) => key !== 'offset' && key !== 'computedOffset' && key !== 'easing').map(([k, v]) => `    ${k}: ${v}`).join(';\n')
      return `  ${pct} {\n${props};\n  }`
    }).join('\n')
    return `@keyframes ${a.id || 'anim'} {\n${kfLines}\n}\nanimation: ${a.id || 'anim'} ${timing.duration || 300}ms ${timing.easing || 'ease'} ${timing.iterations === Infinity ? 'infinite' : ''}`
  }).join('\n\n')
}

function showAIPrompt() {
  if (!lockedElement) { showToast('Lock an element first'); return }

  const el = lockedElement as HTMLElement
  el.classList.remove(LOCKED_CLASS)
  const styles = window.getComputedStyle(el)
  el.classList.add(LOCKED_CLASS)

  const tw = mapCSSToTailwind(styles)
  const dom = extractDOMSummary(el)
  const aria = extractARIA(el)
  const anim = extractAnimations(el)
  const tagName = el.tagName.toLowerCase()
  const twClassStr = tw.join(' ')
  const cssProps = _lastParsedCSS?.styles
    ? Object.entries(_lastParsedCSS.styles).slice(0, 30).map(([k, v]) => `  ${k}: ${v};`).join('\n')
    : ''

  const elementContext = [
    `Tag: <${tagName}>`,
    el.id ? `ID: #${el.id}` : '',
    twClassStr ? `Tailwind classes: ${twClassStr}` : '',
    cssProps ? `\nKey CSS:\n${cssProps}` : '',
    anim ? `\nAnimations:\n${anim}` : '',
    `\nDOM structure:\n${dom || `<${tagName} />`}`,
    aria ? `\nARIA:\n${aria}` : '',
  ].filter(Boolean).join('\n')

  const buildPrompt = (framework: 'react' | 'vue' | 'html'): string => {
    if (framework === 'react') return `You are a frontend expert. Convert the following element into a production-ready React component using TypeScript and Tailwind CSS.

${elementContext}

Requirements:
- React functional component with TypeScript
- Use all Tailwind classes exactly as provided
- Preserve DOM structure and ARIA attributes for accessibility
- Export as default
- No explanation — output ONLY TSX code in a markdown code block`

    if (framework === 'vue') return `You are a frontend expert. Convert the following element into a Vue 3 component using Tailwind CSS.

${elementContext}

Requirements:
- Vue 3 <script setup lang="ts"> syntax
- Use all Tailwind classes exactly as provided
- Preserve DOM structure and ARIA attributes for accessibility
- No explanation — output ONLY Vue SFC code in a markdown code block`

    return `You are a frontend expert. Convert the following element into clean semantic HTML with Tailwind CSS.

${elementContext}

Requirements:
- Clean, semantic HTML5
- Use all Tailwind classes exactly as provided
- Preserve ARIA attributes for accessibility
- No explanation — output ONLY HTML code in a markdown code block`
  }

  $$('stylesnap-ai-prompt-panel')?.remove()

  const panel = document.createElement('div')
  panel.id = 'stylesnap-ai-prompt-panel'
  panel.setAttribute('data-stylesnap', 'true')

  let currentFw: 'react' | 'vue' | 'html' = 'react'

  const SVG_COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`

  const render = () => {
    const tabs: Array<{id: 'react'|'vue'|'html'; label: string}> = [
      {id: 'react', label: 'React / TSX'},
      {id: 'vue',   label: 'Vue 3'},
      {id: 'html',  label: 'HTML'},
    ]
    panel.innerHTML = `
      <div id="ss-ai-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999996;"></div>
      <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(660px,92vw);max-height:82vh;background:rgba(15,23,42,0.98);border:1px solid rgba(99,102,241,0.28);border-radius:10px;display:flex;flex-direction:column;z-index:9999997;box-shadow:0 8px 48px rgba(0,0,0,0.55);font-family:system-ui,sans-serif;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="display:flex;align-items:center;gap:8px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 3 9.2 8.5 3.3 9.6l4.2 4.3-1 6.1 5.5-2.9 5.5 2.9-1-6.1 4.2-4.3-5.9-1.1Z"/></svg>
            <span style="font-size:13px;font-weight:600;color:#e2e8f0;">AI Prompt</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:10px;color:#475569;">Paste into Claude, ChatGPT, or Cursor</span>
            <button id="ss-ai-close" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;padding:0 2px;line-height:1;">&times;</button>
          </div>
        </div>
        <div style="display:flex;gap:4px;padding:10px 16px 0;">
          ${tabs.map(t => `<button data-fw="${t.id}" style="background:${t.id===currentFw ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)'};border:1px solid ${t.id===currentFw ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.07)'};color:${t.id===currentFw ? '#a5b4fc' : '#64748b'};border-radius:5px;padding:4px 12px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.12s;">${t.label}</button>`).join('')}
        </div>
        <div style="flex:1;overflow:auto;padding:10px 16px;">
          <textarea id="ss-ai-textarea" readonly style="width:100%;height:300px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.07);border-radius:6px;color:#94a3b8;font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.65;padding:10px 12px;resize:vertical;outline:none;box-sizing:border-box;"></textarea>
        </div>
        <div style="padding:10px 16px 14px;display:flex;align-items:center;justify-content:flex-end;border-top:1px solid rgba(255,255,255,0.06);">
          <button id="ss-ai-copy" style="display:flex;align-items:center;gap:6px;background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.38);color:#a5b4fc;border-radius:6px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;transition:all 0.15s;">${SVG_COPY} Copy Prompt</button>
        </div>
      </div>
    `
    // Set textarea value directly to avoid HTML entity issues
    const ta = panel.querySelector('#ss-ai-textarea') as HTMLTextAreaElement
    if (ta) ta.value = buildPrompt(currentFw)

    panel.querySelector('#ss-ai-close')?.addEventListener('click', () => panel.remove())
    panel.querySelector('#ss-ai-backdrop')?.addEventListener('click', () => panel.remove())

    panel.querySelectorAll('[data-fw]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentFw = (btn as HTMLElement).dataset.fw as 'react' | 'vue' | 'html'
        render()
      })
    })

    panel.querySelector('#ss-ai-copy')?.addEventListener('click', () => {
      navigator.clipboard.writeText(buildPrompt(currentFw)).then(() => {
        const btn = panel.querySelector('#ss-ai-copy') as HTMLElement | null
        if (!btn) return
        // Restore only the button — never rebuild the whole panel (avoids resetting
        // the user's tab choice or resurrecting a closed panel).
        const origHTML = btn.innerHTML, origBg = btn.style.background, origBorder = btn.style.borderColor, origColor = btn.style.color
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg> Copied!`
        btn.style.background = 'rgba(52,211,153,0.18)'
        btn.style.borderColor = 'rgba(52,211,153,0.4)'
        btn.style.color = '#34d399'
        setTimeout(() => {
          if (!btn.isConnected) return
          btn.innerHTML = origHTML
          btn.style.background = origBg
          btn.style.borderColor = origBorder
          btn.style.color = origColor
        }, 1800)
      }).catch(() => showToast('Copy failed'))
    })
  }

  render()
  stAppend(panel)
}

// ─── Preview Panel ────────────────────────────────────────────────────

function showPreviewPanel(opts: {
  code: string
  type: 'component' | 'css' | 'tailwind' | 'json'
  title?: string
  previewHTML?: string
  previewCSS?: string
}) {
  const { code, type } = opts
  const title = opts.title || 'Preview'

  // Remove any existing preview panel
  const existing = document.getElementById('stylesnap-preview-panel')
  if (existing) existing.remove()

  // Panel (position:fixed with max z-index — floats above inspector overlay)
  const panel = document.createElement('div')
  panel.id = 'stylesnap-preview-panel'
  panel.setAttribute('data-stylesnap', 'true')
  const panelW = Math.min(window.innerWidth * 0.88, 1100)
  const panelH = Math.min(window.innerHeight * 0.78, 800)
  Object.assign(panel.style, {
    position: 'fixed',
    left: `${Math.round((window.innerWidth - panelW) / 2)}px`,
    top: `${Math.round((window.innerHeight - panelH) / 2)}px`,
    width: `${panelW}px`,
    height: `${panelH}px`,
    maxWidth: '1100px',
    maxHeight: '800px',
    zIndex: '9999998',
    background: 'rgba(15, 23, 42, 0.98)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '10px',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    fontFamily: 'system-ui, sans-serif',
    boxShadow: '0 8px 48px rgba(0,0,0,0.5)',
  })

  // ─── Header ───
  const header = document.createElement('div')
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: '0',
  })
  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="color:#e2e8f0;font-weight:600;font-size:13px;">${title}</span>
      <span style="background:rgba(99,102,241,0.2);color:#a5b4fc;font-size:10px;padding:2px 8px;border-radius:4px;font-weight:500;">${type.toUpperCase()}</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;">
      <button id="ss-preview-copy" style="background:rgba(99,102,241,0.15);color:#a5b4fc;border:1px solid rgba(99,102,241,0.2);padding:5px 12px;border-radius:5px;cursor:pointer;font-size:11px;font-family:system-ui,sans-serif;">📋 Copy</button>
      ${type === 'css' || type === 'tailwind' ? `<button id="ss-preview-codepen" style="background:rgba(52,211,153,0.12);color:#34d399;border:1px solid rgba(52,211,153,0.2);padding:5px 12px;border-radius:5px;cursor:pointer;font-size:11px;font-family:system-ui,sans-serif;">⚡ CodePen</button>` : ''}
      <button id="ss-preview-close" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:18px;padding:0 4px;line-height:1;">&times;</button>
    </div>
  `

  // ─── Body (split view) ───
  const body = document.createElement('div')
  Object.assign(body.style, {
    display: 'flex', flex: '1', overflow: 'hidden', minHeight: '0',
  })

  // Left: Live preview
  const previewSide = document.createElement('div')
  Object.assign(previewSide.style, {
    flex: '1', minWidth: '0', borderRight: '1px solid rgba(255,255,255,0.06)',
    display: 'flex', flexDirection: 'column',
  })
  const previewLabel = document.createElement('div')
  previewLabel.textContent = 'Preview'
  Object.assign(previewLabel.style, {
    padding: '6px 12px', fontSize: '10px', color: '#64748b',
    borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: '0',
    background: 'rgba(255,255,255,0.02)',
  })
  const iframe = document.createElement('iframe')
  iframe.id = 'ss-preview-iframe'
  iframe.setAttribute('sandbox', 'allow-scripts')
  Object.assign(iframe.style, { flex: '1', border: 'none', background: '#fff', width: '100%' })
  previewSide.appendChild(previewLabel)
  previewSide.appendChild(iframe)

  // Right: Code editor
  const codeSide = document.createElement('div')
  Object.assign(codeSide.style, {
    flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column',
  })
  const codeLabel = document.createElement('div')
  codeLabel.textContent = type === 'json' ? 'JSON' : type === 'component' ? 'React + Tailwind' : type === 'tailwind' ? 'Tailwind Classes' : 'CSS'
  Object.assign(codeLabel.style, {
    padding: '6px 12px', fontSize: '10px', color: '#64748b',
    borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: '0',
    background: 'rgba(255,255,255,0.02)',
  })
  const textarea = document.createElement('textarea')
  textarea.id = 'ss-preview-textarea'
  textarea.value = code
  textarea.setAttribute('spellcheck', 'false')
  Object.assign(textarea.style, {
    flex: '1', background: 'rgba(0,0,0,0.2)', color: '#e2e8f0',
    border: 'none', padding: '12px', fontSize: '12px', fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Consolas, monospace',
    resize: 'none', outline: 'none', lineHeight: '1.6', tabSize: '2',
    whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto',
  })
  codeSide.appendChild(codeLabel)
  codeSide.appendChild(textarea)

  body.appendChild(previewSide)
  body.appendChild(codeSide)
  panel.appendChild(header)
  panel.appendChild(body)
  stAppend(panel)

  // ─── Render preview ───
  const updatePreview = () => {
    const currentCode = textarea.value
    iframe.srcdoc = buildPreviewDoc(currentCode, type, opts.previewHTML, opts.previewCSS)
  }
  updatePreview()

  // Debounced preview update on input
  let debounceTimer: ReturnType<typeof setTimeout>
  textarea.addEventListener('input', () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(updatePreview, 400)
  })

  // ─── Buttons ───
  panel.querySelector('#ss-preview-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(textarea.value).then(() => showToast('Copied!'))
      .catch(() => showToast('Copy failed'))
  })

  panel.querySelector('#ss-preview-codepen')?.addEventListener('click', () => {
    const currentCode = textarea.value
    const data = JSON.stringify({
      title: title,
      css: type === 'css' ? currentCode : '',
      html: type === 'tailwind'
        ? `<div class="${currentCode.replace(/\n/g, ' ')}">StyleSnap Export</div>\n<script src="https://cdn.tailwindcss.com"></script>`
        : '<div>StyleSnap Export</div>',
      editors: '110',
    })
    const form = document.createElement('form')
    form.method = 'POST'; form.action = 'https://codepen.io/pen/define'; form.target = '_blank'
    form.setAttribute('data-stylesnap', 'true')
    const input = document.createElement('input')
    input.type = 'hidden'; input.name = 'data'; input.value = data
    form.appendChild(input); document.body.appendChild(form)
    form.submit(); document.body.removeChild(form)
    showToast('Opening CodePen...')
  })

  const closePanel = () => {
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup', onDragEnd)
    document.removeEventListener('keydown', onEsc)
    panel.remove()
    $$('stylesnap-export-menu')?.remove()
  }
  const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel() }

  // ─── Drag panel by header ───
  let dragInfo: { startX: number; startY: number; startLeft: number; startTop: number } | null = null
  const onDragMove = (e: MouseEvent) => {
    if (!dragInfo) return
    const dx = e.clientX - dragInfo.startX
    const dy = e.clientY - dragInfo.startY
    panel.style.left = `${dragInfo.startLeft + dx}px`
    panel.style.top = `${dragInfo.startTop + dy}px`
  }
  const onDragEnd = () => { dragInfo = null }
  const headerEl = panel.querySelector('div') as HTMLElement | null
  if (headerEl) {
    headerEl.style.cursor = 'move'
    headerEl.addEventListener('mousedown', (e) => {
      const me = e as MouseEvent
      if ((me.target as HTMLElement)?.tagName === 'BUTTON') return
      dragInfo = { startX: me.clientX, startY: me.clientY, startLeft: panel.offsetLeft, startTop: panel.offsetTop }
      e.preventDefault()
    })
  }
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)

  panel.querySelector('#ss-preview-close')?.addEventListener('click', closePanel)
  document.addEventListener('keydown', onEsc)
}

// ─── Preview helpers ───

function extractPreviewHTML(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement
  clone.classList.forEach(c => { if (c.startsWith('stylesnap-') || c === LOCKED_CLASS) clone.classList.remove(c) })
  return clone.outerHTML
}

function detectBackground(el: HTMLElement | null): string {
  if (!el) return '#f8fafc'  // fallback
  // Walk up from element's parent to find first non-transparent background
  let current: HTMLElement | null = el.parentElement
  let bgImage = ''
  let bgColor = ''

  for (let i = 0; i < 10 && current; i++) {
    const s = window.getComputedStyle(current)
    // Check background-image first (gradients, images take priority)
    const bi = s.backgroundImage
    if (bi && bi !== 'none' && !bgImage) {
      bgImage = bi
    }
    // Check background-color for solid fill
    const bc = s.backgroundColor
    if (bc && bc !== 'rgba(0, 0, 0, 0)' && bc !== 'transparent' && !bgColor) {
      bgColor = bc
    }
    // If we found both, stop
    if (bgColor && bgImage) break
    // If we found color and the element covers enough area, stop
    if (bgColor) {
      const r = current.getBoundingClientRect()
      if (r.width > 100 && r.height > 100) break
    }
    current = current.parentElement
  }

  // Build CSS background value — prefer image over color, both if available
  if (bgImage) {
    return bgImage + (bgColor ? ` ${bgColor}` : '')
  }
  if (bgColor) {
    // Determine if the background is dark or light for text contrast
    const isDark = isDarkColor(bgColor)
    if (isDark) {
      // For dark backgrounds in the preview, we keep the dark bg but note it
      return bgColor
    }
    return bgColor
  }
  return '#f8fafc'
}

// Quick check if a color is dark (for contrast hints)
function isDarkColor(color: string): boolean {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return false
  const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3])
  // Perceived brightness
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128
}

function buildPreviewDoc(code: string, type: string, previewHTML?: string, _previewCSS?: string, bgOverride?: string): string {
  // Auto-detect background from locked element's page context
  const bg = bgOverride || detectBackground(lockedElement as HTMLElement | null)

  if (type === 'component') {
    const jsxMatch = code.match(/return\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*}/)
    const inner = jsxMatch ? jsxMatch[1] : code
    let html = inner
      .replace(/className=/g, 'class=')
      .replace(/<([A-Z]\w*)/g, '<div')
      .replace(/<\/[A-Z]\w*>/g, '</div>')
      .replace(/\{[^}]*\}/g, '')
      .replace(/htmlFor=/g, 'for=')
      .replace(/onClick=/g, 'onclick=')
      .replace(/onChange=/g, 'onchange=')
      .trim()

    return `<!DOCTYPE html><html><head>
<script src="https://cdn.tailwindcss.com"></script>
<style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:${bg};padding:2rem;}</style>
</head><body>${html || '<div class="text-slate-400 text-sm">Could not extract JSX — check code editor</div>'}</body></html>`
  }

  if (type === 'css') {
    const html = previewHTML || '<div class="target"><h2>Preview</h2><p>Sample text</p><button>Button</button></div>'
    const safeCode = code.replace(/^\s*\{?\s*/,'').replace(/\}\s*$/,'').replace(/<\/style/gi, '<\\/style')
    return `<!DOCTYPE html><html><head><style>body{padding:2rem;background:${bg};font-family:system-ui,sans-serif;}${safeCode}</style></head><body>${html}</body></html>`
  }

  if (type === 'tailwind') {
    const classes = code.replace(/\n/g, ' ').trim()
    return `<!DOCTYPE html><html><head>
<script src="https://cdn.tailwindcss.com"></script>
<style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:${bg};}</style>
</head><body><div class="${classes}">Tailwind Preview</div></body></html>`
  }

  // JSON — show formatted
  return `<!DOCTYPE html><html><head><style>body{font-family:system-ui,sans-serif;padding:2rem;background:${bg};color:#334155}pre{background:#1e293b;color:#e2e8f0;padding:16px;border-radius:8px;overflow:auto;font-size:12px;line-height:1.6}</style></head><body><h3 style="color:#6366f1;margin-bottom:12px;">JSON Data</h3><pre>${escapeHTML(code)}</pre></body></html>`
}

function escapeHTML(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

// ─── Feedback Modal ───────────────────────────────────────────────────────────

async function showFeedbackModal() {
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
      <button class="ss-fbm-type" data-type="general" style="flex:1;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.3);border-radius:5px;color:#a5b4fc;cursor:pointer;font-size:10px;padding:5px 2px;">💬 ${t.feedbackGeneral || 'Other'}</button>
    </div>
    <textarea id="ss-fbm-msg" placeholder="${t.feedbackPlaceholder || 'Tell us what you think…'}" style="width:100%;height:80px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;font-size:11px;padding:8px;resize:none;box-sizing:border-box;font-family:system-ui,sans-serif;outline:none;display:block;"></textarea>
    <input id="ss-fbm-email" type="email" placeholder="${t.feedbackEmailPlaceholder || 'Email (optional, for replies)'}" style="width:100%;margin-top:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;font-size:11px;padding:7px 8px;box-sizing:border-box;outline:none;display:block;">
    <button id="ss-fbm-submit" style="margin-top:8px;width:100%;background:#6366f1;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:12px;font-weight:600;padding:9px;transition:opacity 0.15s;">${t.feedbackSubmit || 'Send Feedback'}</button>
    <div style="font-size:10px;color:#475569;text-align:center;margin-top:8px;">${t.feedbackContactHint || 'Need direct help?'} <a href="mailto:hi@lucidlibs.dev" style="color:#818cf8;text-decoration:none;">hi@lucidlibs.dev</a></div>
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
      this.style.background = 'rgba(99,102,241,0.2)'
      this.style.color = '#a5b4fc'
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

async function showUpgradeModal(trigger?: string) {
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

  const quotaBanner = trigger === 'quota'
    ? `<div style="background:rgba(251,146,60,0.1);border:1px solid rgba(251,146,60,0.3);border-radius:6px;padding:8px 10px;margin-bottom:12px;font-size:11px;color:#fbbf24;text-align:center;">
        ⚠️ You've used all 20 free extractions today. Upgrade for unlimited access.
      </div>`
    : ''

  modal.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div>
        <div style="font-size:15px;font-weight:700;color:#e2e8f0;">${t.upgradeModalTitle || 'StyleSnap Pro'}</div>
        <div style="font-size:10px;color:#64748b;margin-top:1px;">${t.oneTime || 'One-time payment · Lifetime access'}</div>
      </div>
      <button id="ss-upgrade-close" style="background:none;border:none;color:#475569;cursor:pointer;font-size:18px;line-height:1;padding:0;flex-shrink:0;">×</button>
    </div>
    ${quotaBanner}
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
    <button id="ss-upgrade-cta" style="width:100%;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:7px;color:#fff;cursor:pointer;font-size:13px;font-weight:700;padding:11px;transition:opacity 0.15s;margin-bottom:8px;">${t.upgradeToPro || 'Upgrade to Pro — $29'}</button>
    <div style="display:flex;align-items:center;gap:4px;margin-bottom:10px;">
      <input id="ss-upgrade-key" type="text" placeholder="${t.licenseKeyLabel || 'License Key'} (PRO-XXXX-…)" style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:5px;color:#e2e8f0;font-size:11px;padding:7px 8px;outline:none;box-sizing:border-box;">
      <button id="ss-upgrade-activate" style="background:#1e293b;border:1px solid rgba(99,102,241,0.4);border-radius:5px;color:#818cf8;cursor:pointer;font-size:11px;font-weight:600;padding:7px 10px;white-space:nowrap;">${t.activate || 'Activate'}</button>
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

async function showSettingsPopup() {
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
    background: 'rgba(15, 23, 42, 0.97)',
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
  _licenseIsPro = licenseStatus.isPro

  const settings = { ...DEFAULT_SETTINGS, ...settingsData } as UserSettings
  const lang = await detectLang()
  const t = translations[lang] || translations.en

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const inputStyle = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:5px 8px;color:#e2e8f0;font-size:11px;width:100%;box-sizing:border-box;'
  const btnStyle = 'background:#6366f1;border:none;border-radius:4px;padding:5px 10px;color:#fff;font-size:11px;cursor:pointer;white-space:nowrap;'
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
  const chipActiveStyle = 'background:rgba(99,102,241,0.2);color:#e2e8f0;'

  // Reusable chip group helper
  const chipGroup = (idBase: string, options: {value: string; label: string}[], selected: string) => {
    return `<div id="${idBase}" style="${chipGroupStyle}">${
      options.map(o => {
        const isActive = o.value === selected
        return `<button data-value="${o.value}" style="${chipStyle}${isActive ? chipActiveStyle : ''}" class="${isActive ? 'active-chip' : ''}" type="button">${o.label}</button>`
      }).join('')
    }</div>`
  }
  const toggleHtml = (id: string, checked: boolean, onChange: string) =>
    `<label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:3px 0;">
      <span style="font-size:11px;color:#cbd5e1;flex:1;margin-right:8px;"><span id="ss-label-${id}"></span></span>
      <div style="position:relative;width:36px;height:20px;flex:none;">
        <input id="${id}" type="checkbox" ${checked ? 'checked' : ''} onchange="${esc(onChange)}"
          style="position:absolute;opacity:0;width:100%;height:100%;cursor:pointer;z-index:1;margin:0;">
        <div style="width:36px;height:20px;border-radius:10px;background:${checked ? '#6366f1' : 'rgba(255,255,255,0.12)'};transition:background 0.15s;display:flex;align-items:center;padding:2px;">
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
        <button id="ss-btn-feedback" title="Feedback" style="background:none;border:none;color:#818cf8;cursor:pointer;padding:2px 4px;border-radius:4px;display:flex;transition:color 0.15s;">${iconMail}</button>
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
          <a id="ss-license-recover" href="#" style="color:#818cf8;text-decoration:none;cursor:pointer;">Lost your license key? Recover</a>
        </div>
      ` : `
        <button id="ss-license-deactivate" style="margin-top:6px;${secondaryBtnStyle}width:100%;">${t.deactivate || 'Deactivate License'}</button>
      `}
    </div>

    <!-- Preferences -->
    <div style="${sectionStyle}">
      <span style="font-weight:600;font-size:11px;color:#e2e8f0;margin-bottom:4px;">${iconSlider} ${t.preferences || 'Preferences'}</span>
      ${toggleHtml('ss-pref-floating-btn', settings.showFloatingBtn !== false, 'void(0)')}
      <div id="ss-floating-btn-hint" style="font-size:9px;color:#64748b;margin-top:-2px;margin-bottom:4px;margin-left:2px;${settings.showFloatingBtn !== false ? 'display:none;' : ''}">
        💡 Click the StyleSnap toolbar icon to reopen settings
      </div>
      ${toggleHtml('ss-pref-show-tw', settings.showTailwindOverlay !== false, 'void(0)')}
      ${toggleHtml('ss-pref-side-panel', settings.showSidePanel !== false, 'void(0)')}
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
  if (spLabel) spLabel.textContent = (t as Record<string, string>).showSidePanel || 'Inspector panel (box model + preview)'
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
    _showSidePanel = spChecked !== false
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
    if (!_showSidePanel) hideSidePanel()
    else if (lockedElement) { const ov = $$(OVERLAY_ID); if (ov) updateSidePanel(lockedElement as HTMLElement, _lastParsedCSS, ov) }
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
      if (track) track.style.background = this.checked ? '#6366f1' : 'rgba(255,255,255,0.12)'
    })
  })

  // Feedback button → open independent modal
  popup.querySelector('#ss-btn-feedback')?.addEventListener('click', () => {
    showFeedbackModal()
  })
}

function onScroll() {
  if (!isActive()) return
  const target = lockedElement || lastHighlighted
  if (target) updateGuides(target.getBoundingClientRect())
}

// ─── Floating Button UI ────────────────────────────────────────────────

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
async function initFloatingButton() {
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
      lastMode = s.lastUsedMode as number
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
        setInspectMode(lastMode > 0 ? lastMode : 1)
      } else {
        // Exit inspect mode
        setInspectMode(0)
      }
    })

    stAppend(btn)

    // sync initial mode UI (inspectMode is always 0 on load; just render badge)
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

// Export for @crxjs/vite-plugin loader
export function onExecute(_args: { perf: { injectTime: number; loadTime: number } }) {
  reloadFormatSettings()
  initFloatingButton()
  setTimeout(() => {
    if (!$$(FLOATING_BTN_ID)) initFloatingButton()
  }, 1500)
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
        reloadFormatSettings()
        // Handle floating button visibility toggle
        if (newSettings.showFloatingBtn !== undefined) {
          const btn = $$(FLOATING_BTN_ID)
          if (newSettings.showFloatingBtn) {
            if (!btn) initFloatingButton()
          } else {
            if (btn) btn.remove()
          }
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
      // Validate property against known CSS property names (letters and hyphens only)
      const safePropPattern = /^[a-z][a-z0-9-]*$/
      if (!safePropPattern.test(property)) {
        sendResponse({ ok: false, error: 'Invalid CSS property' })
        break
      }
      // Reject dangerous value patterns
      const dangerousValuePattern = /url\s*\(|expression\s*\(|<\/?\s*style|javascript:/i
      if (dangerousValuePattern.test(value)) {
        sendResponse({ ok: false, error: 'Invalid CSS value' })
        break
      }
      try {
        const targets = document.querySelectorAll(selector)
        targets.forEach(el => {
          (el as HTMLElement).style.setProperty(property, value)
        })
      } catch {
        sendResponse({ ok: false, error: 'Invalid selector' })
        break
      }
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

    case 'TOGGLE_INSPECT': {
      if (!isActive()) {
        setInspectMode(lastMode > 0 ? lastMode : 1)
      } else {
        setInspectMode(0)
      }
      sendResponse({ ok: true })
      break
    }

    case 'SHOW_SETTINGS': {
      showSettingsPopup()
      sendResponse({ ok: true })
      break
    }

    default:
      sendResponse({ error: 'Unknown message type' })
  }
  return true
})

// ─── Cleanup on page unload ───────────────────────────────────────────
window.addEventListener('pagehide', () => {
  hideOverlay()
  document.getElementById('stylesnap-floating-btn')?.remove()
  document.getElementById('stylesnap-overlay')?.remove()
  document.getElementById('stylesnap-preview-panel')?.remove()
})

// ─── Debug helpers (dev build only) ─────────────────────────────────
if (import.meta.env.DEV) {
;(window as any).debugShowOverlay = (targetSelector: string) => {
  const el = document.querySelector(targetSelector)
  if (!el) return 'element not found: ' + targetSelector
  const parsedCSS = parseElement(el as Element)
  showOverlay(el as Element, parsedCSS)
  return 'overlay shown for ' + targetSelector
}

;(window as any).debugInspectMode = () => inspectMode

// ─── Cross-world debug bridge (MAIN world → ISOLATED world) ───
// MAIN world JS can dispatch these events to call internal functions.
// Usage from page console:
//   document.dispatchEvent(new CustomEvent('stylesnap-debug-lock', { detail: { selector: '#test-btn' } }))
document.addEventListener('stylesnap-debug-lock', ((e: CustomEvent) => {
  const selector = e.detail?.selector as string | undefined
  if (selector) {
    const el = document.querySelector(selector)
    if (el) {
      lockElement(el)
      // Also show overlay (mirrors onClick logic)
      const parsedCSS = parseElement(el)
      showOverlay(el, parsedCSS)
    }
  }
}) as EventListener)

document.addEventListener('stylesnap-debug-toggle-compare', (() => {
  compareMode = !compareMode
  const btn = document.getElementById('stylesnap-action-compare') as HTMLElement | null
  if (btn) {
    if (compareMode) { btn.classList.add('active'); btn.title = 'Compare: ON' }
    else { btn.classList.remove('active'); btn.title = 'Compare: OFF' }
  }
  if (!compareMode) { removeCompareHighlight(); hideCompareTooltip() }
}) as EventListener)

document.addEventListener('stylesnap-debug-compare-state', ((e: CustomEvent) => {
  const cb = e.detail?.callback as ((d: unknown) => void) | undefined
  if (cb) cb({ compareMode, lockedElement: !!lockedElement, compareTarget: !!_compareTarget })
}) as EventListener)

document.addEventListener('stylesnap-debug-compare', ((e: CustomEvent) => {
  const selector = e.detail?.selector as string | undefined
  if (!selector) return
  const el = document.querySelector(selector)
  if (el && compareMode && lockedElement) {
    highlightCompareElement(el)
    const rect = el.getBoundingClientRect()
    showCompareTooltip(el, rect.left + rect.width / 2, rect.top)
  }
}) as EventListener)

document.addEventListener('stylesnap-debug-unlock', (() => {
  unlockElement()
}) as EventListener)

// Debug: trigger preview panel for export
document.addEventListener('stylesnap-debug-preview-css', (() => {
  if (!lockedElement) { showToast('Lock an element first'); return }
  const el = lockedElement as HTMLElement
  el.classList.remove(LOCKED_CLASS)
  const styles = window.getComputedStyle(el)
  el.classList.add(LOCKED_CLASS)
  const tag = el.tagName.toLowerCase()
  const id = el.id
  const cls = Array.from(el.classList).filter(c => !c.startsWith('stylesnap-')).join('.')
  const selector = id ? `#${id}` : cls ? `.${cls}` : tag
  const props: string[] = []
  for (let i = 0; i < styles.length; i++) {
    const prop = styles[i]
    const val = styles.getPropertyValue(prop)
    if (val && !['initial', 'none'].includes(val)) {
      props.push(`  ${prop}: ${val};`)
    }
  }
  const text = `${selector} {\n${props.join('\n')}\n}`
  showPreviewPanel({
    code: text, type: 'css',
    title: `${tag} — CSS`,
    previewHTML: extractPreviewHTML(el),
    previewCSS: text,
  })
}) as EventListener)

// Debug: trigger preview panel for Tailwind
document.addEventListener('stylesnap-debug-preview-tw', (() => {
  if (!lockedElement) { showToast('Lock an element first'); return }
  const el = lockedElement as HTMLElement
  el.classList.remove(LOCKED_CLASS)
  const styles = window.getComputedStyle(el)
  el.classList.add(LOCKED_CLASS)
  const classes = mapCSSToTailwind(styles)
  const tag = el.tagName.toLowerCase()
  const text = classes.length > 0
    ? `<!-- ${tag} → ${classes.length} Tailwind classes -->\nclass="${classes.join(' ')}"`
    : `/* No direct Tailwind mapping found for this element. */`
  showPreviewPanel({
    code: text, type: 'tailwind',
    title: `${tag} — Tailwind`,
    previewHTML: extractPreviewHTML(el),
  })
}) as EventListener)

// Debug: trigger preview panel for component (simulate AI generation)
document.addEventListener('stylesnap-debug-preview-component', (() => {
  if (!lockedElement) { showToast('Lock an element first'); return }
  const el = lockedElement as HTMLElement
  const previewHTML = extractPreviewHTML(el)
  showPreviewPanel({
    code: `export default function UpgradeButton() {\n  return (\n    <button className="bg-indigo-500 hover:bg-indigo-400 text-white font-semibold py-2.5 px-5 rounded-lg transition-all duration-200 hover:-translate-y-px hover:shadow-lg hover:shadow-indigo-500/40 text-sm cursor-pointer border-none">\n      Upgrade Now\n    </button>\n  )\n}`,
    type: 'component',
    title: `${el.tagName.toLowerCase()} — AI Component`,
    previewHTML,
  })
}) as EventListener)

// Debug: trigger preview panel for JSON
document.addEventListener('stylesnap-debug-preview-json', (() => {
  if (!lockedElement) { showToast('Lock an element first'); return }
  const el = lockedElement as HTMLElement
  el.classList.remove(LOCKED_CLASS)
  const styles = window.getComputedStyle(el)
  el.classList.add(LOCKED_CLASS)
  const obj: Record<string, string> = {}
  for (let i = 0; i < styles.length; i++) {
    const prop = styles[i]
    const val = styles.getPropertyValue(prop)
    if (val && !['initial', 'none'].includes(val)) obj[prop] = val
  }
  showPreviewPanel({
    code: JSON.stringify(obj, null, 2), type: 'json',
    title: `${el.tagName.toLowerCase()} — JSON`,
  })
}) as EventListener)
} // end if (import.meta.env.DEV)

