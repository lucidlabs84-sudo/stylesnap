/**
 * Content Script
 * Injected into every page. Handles hover detection, CSS extraction,
 * element highlighting, and design token scanning.
 */

// Page-level CSS — absolute minimum rules that must apply to page elements
// (highlights, grid, guides). Everything else lives in Shadow DOM via ui.ts.
const PAGE_CSS = `
.stylesnap-highlight{outline:2px solid rgba(99,102,241,.9)!important;outline-offset:1px!important;background-color:rgba(99,102,241,.04)!important;cursor:crosshair!important}
.stylesnap-preview{outline:2px dashed rgba(168,85,247,.8)!important;outline-offset:1px!important;background-color:rgba(168,85,247,.03)!important;cursor:pointer!important}
.stylesnap-locked{outline:2px solid rgba(16,185,129,.9)!important;outline-offset:1px!important;background-color:rgba(16,185,129,.04)!important;cursor:crosshair!important}
.stylesnap-guide{position:fixed;background-color:rgba(99,102,241,.65);z-index:999990;pointer-events:none;display:none}
body.stylesnap-mode-guidelines .stylesnap-guide{display:block}
#stylesnap-guide-h{left:0;right:0;height:1px}
#stylesnap-guide-v{top:0;bottom:0;width:1px}
body.stylesnap-mode-grid *:not([data-stylesnap=true]):not([data-stylesnap=true] *){outline:1px solid rgba(147,51,234,.2)!important}
body.stylesnap-mode-grid *:not([data-stylesnap=true]):not([data-stylesnap=true] *):hover{outline:1px solid rgba(147,51,234,.6)!important;background-color:rgba(147,51,234,.05)!important}
`
const _pageStyle = document.createElement('style')
_pageStyle.id = 'stylesnap-page-css'
_pageStyle.textContent = PAGE_CSS
if (document.head) { document.head.appendChild(_pageStyle) }
else if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => { document.head.appendChild(_pageStyle) }, { once: true }) }

import { parseElement, extractComponentHTML, extractComponentCSS, formatCSS } from '@/lib/css-extractor'
import { extractDesignTokens } from '@/lib/token-extractor'
import { translations, TranslationKey } from '@/lib/i18n-core'
import {
  stAppend, $$,
  isColorValue, escapeHtml, classNameOf, colorBlock,
  SVG, showToast,
} from './ui'
import { getTailwindClasses } from './tailwind'
import { matchesAnyNode, parseRulePropsRaw, extractPseudoFromSelector } from './css-rules'
import { S, isActive, assistMode, OVERLAY_ID, HIGHLIGHT_CLASS, LOCKED_CLASS, PREVIEW_CLASS, FLOATING_BTN_ID } from './state'
import { showUpgradeModal } from './panels/modals'
import { showAIPrompt } from './panels/ai-prompt'
import { showSettingsPopup } from './panels/settings'
import { updateSidePanel, hideSidePanel, repositionSidePanel } from './side-panel'
import { initFloatingButton } from './floating-button'
import { showHintBar, hideHintBar } from './hint-bar'

import { getLicenseStatus } from '@/lib/license'
import type { ParsedCSS } from '@/shared/types'
import { computePosition, flip, shift, offset, autoUpdate } from '@floating-ui/dom'

// ─── State ────────────────────────────────────────────────────────────
// Mutable state + shared constants live in ./state (the `S` object).

// Init: load cached license
getLicenseStatus().then(s => { S.licenseIsPro = s.isPro })


// ─── Display format preferences ────────────────────────────────────────
let _colorFormat: 'rgb' | 'hex' | 'hsl' = 'rgb'
let _shortenCSS = true
let _showTW = true
let _overlaySide: 'left' | 'right' = 'right'

function reloadFormatSettings() {
  chrome.storage.local.get(['stylesnap_settings'], (res) => {
    const s = res.stylesnap_settings || {}
    _colorFormat = s.colorFormat || 'rgb'
    _shortenCSS = s.shortenCSS !== false
    S.showSidePanel = s.showSidePanel !== false
    _showTW = s.showTailwindOverlay !== false
    _overlaySide = s.overlaySide === 'left' ? 'left' : 'right'
    // NOTE: assist mode is applied in storage.onChanged (only when it actually
    // changed) — applying it here would fight the G-key/live mode cycling, whose
    // setInspectMode writes also trigger this reload.
    // Re-render the current overlay so other settings apply in real time
    rerenderOverlay()
  })
}

/** Re-render the overlay for the current target so live settings changes show immediately. */
function rerenderOverlay() {
  const target = (S.lockedElement || S.lastHighlighted) as Element | null
  if (target && S.lastParsedCSS && document.body.contains(target)) {
    showOverlay(target, S.lastParsedCSS)
  }
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
  // Color: honor the user's color-format setting (was hardcoded to hex, which
  // made the RGB/HSL setting do nothing whenever Shorten CSS was on — the default).
  if (isColorValue(value)) {
    const c = convertColor(value, _colorFormat)
    return _colorFormat === 'hex' ? shortenColor(c) : c
  }
  return value
}

function formatDisplayValue(prop: string, value: string): string {
  if (_shortenCSS) return shortenValue(prop, value)
  if (isColorValue(value)) return convertColor(value, _colorFormat)
  return value
}

/**
 * Resolve var() references to real values using :root custom properties (or the
 * var()'s fallback). Used for pseudo/responsive blocks where getComputedStyle(el)
 * can't give the :hover/:focus-state value. Returns the original if unresolvable.
 */
function resolveVars(value: string): string {
  if (!value || !value.includes('var(')) return value
  const root = window.getComputedStyle(document.documentElement)
  // Replace innermost var(--name, fallback) repeatedly to handle nesting.
  let prev = ''
  let out = value
  let guard = 0
  while (out !== prev && guard++ < 10) {
    prev = out
    out = out.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*?))?\)/g, (full, name: string, fb?: string) => {
      const v = root.getPropertyValue(name).trim()
      if (v) return v
      return fb !== undefined ? fb.trim() : full
    })
  }
  return out
}

// ─── Mode icon mapping ────────────────────────────────────────────────
// SVG / CLOSE_X now imported from ./ui

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

export function updateModeUI() {
  document.body.classList.remove('stylesnap-mode-guidelines', 'stylesnap-mode-grid')
  if (S.inspectMode === 2) document.body.classList.add('stylesnap-mode-guidelines')
  else if (S.inspectMode === 3) document.body.classList.add('stylesnap-mode-grid')

  // floating button state
  const btn = $$(FLOATING_BTN_ID)
  if (!btn) return

  // active ring animation
  if (S.inspectMode > 0) btn.classList.add('is-active')
  else btn.classList.remove('is-active')

  const badge = btn.querySelector('.stylesnap-mode-badge') as HTMLElement | null
  if (badge) {
    if (S.inspectMode > 0) {
      badge.innerHTML = MODE_ICON_SVG[S.inspectMode]
      badge.style.background = MODE_BADGE_COLOR[S.inspectMode]
      badge.style.setProperty('border', 'none', 'important')
      badge.style.setProperty('display', 'flex', 'important')
    } else {
      badge.innerHTML = ''
      badge.style.setProperty('display', 'none', 'important')
    }
  }

  refreshGuides(null)  // on mode switch: draw lock set, clear hover (no stale lines)
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

export function setInspectMode(newMode: number) {
  const wasActive = isActive()
  S.inspectMode = newMode
  const nowActive = isActive()

  // remember last used mode (for UI hint on next page load)
  if (newMode > 0) S.lastMode = newMode

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

  updateModeUI()  // also positions/hides the guides based on the new mode

  // persist
  chrome.storage.local.get(['stylesnap_settings'], (res) => {
    const s = res.stylesnap_settings || {}
    s.inspectMode = S.inspectMode
    if (newMode > 0) s.lastUsedMode = newMode
    chrome.storage.local.set({ stylesnap_settings: s })
  })
}

// ─── Guides ───────────────────────────────────────────────────────────

// Guides live in the shadow root with fully inline styles + JS-driven
// visibility, so they don't depend on the page-global stylesheet, body
// classes, or token resolution (all of which proved fragile across pages).
function initGuides() {
  // Two sets of 4 edge-aligned guide lines (top/bottom/left/right of an element's
  // bounding box, each extended across the viewport): 'lock' = the locked element
  // (indigo), 'hover' = the element under the cursor (cyan). Self-contained in the
  // shadow root, fully inline-styled, JS-driven visibility — no global CSS deps.
  // Low z-index within the shadow so they render beneath the overlay/panels.
  const GUIDE_SETS = { lock: 'rgba(99,102,241,0.8)', hover: 'rgba(34,211,238,0.85)' } as const
  ;(Object.keys(GUIDE_SETS) as Array<keyof typeof GUIDE_SETS>).forEach(set => {
    ;(['t', 'b', 'l', 'r'] as const).forEach(edge => {
      const id = `ss-guide-${set}-${edge}`
      if ($$(id)) return
      const el = document.createElement('div')
      el.id = id
      el.setAttribute('data-stylesnap', 'true')
      const horizontal = edge === 't' || edge === 'b'
      // Use left:0;right:0 / top:0;bottom:0 (NOT 100vw/100vh): 100vw includes the
      // scrollbar width, so a fixed full-width line overflows and forces a
      // horizontal scrollbar onto the page.
      el.style.cssText = `position:fixed;pointer-events:none;z-index:1;display:none;background:${GUIDE_SETS[set]};`
        + (horizontal ? 'left:0;right:0;height:1px;' : 'top:0;bottom:0;width:1px;')
      stAppend(el)
    })
  })
}

function drawGuideSet(set: 'lock' | 'hover', rect: DOMRect) {
  const t = $$(`ss-guide-${set}-t`), b = $$(`ss-guide-${set}-b`)
  const l = $$(`ss-guide-${set}-l`), r = $$(`ss-guide-${set}-r`)
  if (!t || !b || !l || !r) return
  t.style.top = `${Math.round(rect.top)}px`; t.style.display = 'block'
  b.style.top = `${Math.round(rect.bottom)}px`; b.style.display = 'block'
  l.style.left = `${Math.round(rect.left)}px`; l.style.display = 'block'
  r.style.left = `${Math.round(rect.right)}px`; r.style.display = 'block'
}

function hideGuideSet(set: 'lock' | 'hover') {
  ;(['t', 'b', 'l', 'r'] as const).forEach(edge => {
    const e = $$(`ss-guide-${set}-${edge}`)
    if (e) e.style.display = 'none'
  })
}

/**
 * Reconcile both guide sets. The lock set follows S.lockedElement. The hover set
 * is drawn ONLY for an explicitly-passed element (the one truly under the cursor
 * right now) — never from stale state — so switching INTO guidelines mode doesn't
 * paint leftover lines on an element the mouse has since left.
 *   - hoverEl undefined → leave the hover set as-is (used by lock-only refreshes)
 *   - hoverEl null      → hide the hover set
 *   - hoverEl element   → draw the hover set on it
 */
function refreshGuides(hoverEl?: Element | null) {
  if (assistMode() !== 1) { hideGuideSet('lock'); hideGuideSet('hover'); return }
  // Lock set
  if (S.lockedElement && document.body.contains(S.lockedElement)) {
    drawGuideSet('lock', S.lockedElement.getBoundingClientRect())
  } else hideGuideSet('lock')
  // Hover set — when not locked, the hovered element is the primary focus and
  // uses the lock set instead (so a plain hover shows one clean set).
  if (hoverEl === undefined) return
  if (hoverEl && document.body.contains(hoverEl) && hoverEl !== S.lockedElement) {
    if (S.lockedElement) drawGuideSet('hover', hoverEl.getBoundingClientRect())
    else drawGuideSet('lock', hoverEl.getBoundingClientRect())
  } else hideGuideSet('hover')
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
    overlay.setAttribute('data-lang', 'en')  // UI is English-only
    stAppend(overlay)
  }
  return overlay
}

export function showOverlay(el: Element, parsedCSS: ParsedCSS) {
  const overlay = getOrCreateOverlay()
  // Single choke point for every hover/lock/nav — cache the current parsed CSS
  // so Copy CSS / Prompt / CodePen always have it (was only set during DOM nav).
  S.lastParsedCSS = parsedCSS
  const rect = el.getBoundingClientRect()

  const { styles, tailwindClasses = [], tailwindMatchRate = 0 } = parsedCSS

  // Resolve var() to its real (computed) value so the CSS is copy-paste-ready in
  // any project — a `var(--radius-sm)` reference breaks outside the source project.
  // The browser's computed value for the property IS the fully-resolved value.
  // Keep the original var() per prop for a tooltip. Mutating `styles` (the same
  // object behind S.lastParsedCSS) makes panel + Copy + CodePen all consistent.
  const varOriginals: Record<string, string> = {}
  {
    const elh = el as HTMLElement
    const stripped = Array.from(elh.classList).filter(c => c.startsWith('stylesnap-'))
    if (stripped.length) elh.classList.remove(...stripped)
    const cs = window.getComputedStyle(elh)
    for (const k of Object.keys(styles)) {
      if (styles[k].includes('var(')) {
        const resolved = cs.getPropertyValue(k).trim()
        if (resolved && resolved !== styles[k]) {
          varOriginals[k] = styles[k]
          styles[k] = resolved
        }
      }
    }
    if (stripped.length) elh.classList.add(...stripped)
  }

  // ─── Immediate position reset to avoid flash at stale position
  overlay.style.setProperty('left', `${Math.round(rect.left)}px`, 'important')
  overlay.style.setProperty('top', `${Math.round(rect.bottom + 4)}px`, 'important')

  // ─── Filter browser defaults ──────────────────────────

  // ─── Filter browser defaults ──────────────────────────
  const filteredStyles = filterDefaultStyles(el, styles)
  const allProps = Object.entries(filteredStyles)

  // ─── Tailwind: Free limited display ───────────────────
  const isPro = S.licenseIsPro
  const MAX_FREE_TW = 4
  const twSlice = isPro ? tailwindClasses.length : Math.min(tailwindClasses.length, MAX_FREE_TW)
  const twHidden = tailwindClasses.length - twSlice
  const tailwindStr = !_showTW ? '' : tailwindClasses.slice(0, twSlice).join(' ')
    + (twHidden > 0 ? ` <span class="ss-tw-more">+${twHidden} more</span>` : '')
  const twUpgradeBar = (_showTW && !isPro && twHidden > 0)
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

  // Helper: render one property as a line with color block + copy button.
  // `original` is the pre-resolved var() (for pseudo/responsive); main block
  // falls back to varOriginals[k].
  const perLineProp = (k: string, v: string, original?: string) => {
    const displayVal = formatDisplayValue(k, v)
    const cBlock = isColorValue(v) ? colorBlock(v) : ''
    const orig = original ?? varOriginals[k]
    return `<span class="ss-prop-row"><span class="ss-prop">${escapeHtml(k)}:</span> ${cBlock}<span class="ss-val" data-prop="${escapeHtml(k)}" data-original="${escapeHtml(v)}" title="${orig ? escapeHtml(orig) + ' — click to edit' : 'Click to edit'}">${escapeHtml(displayVal)}<svg class="ss-val-edit-icon" ${SVG} width="9" height="9" style="opacity:0;margin-left:3px;vertical-align:middle;transition:opacity 0.15s;flex-shrink:0;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span>;<button class="ss-val-copy-btn" data-text="${escapeHtml(`${k}: ${displayVal};`)}" title="Copy"><svg ${SVG} width="9" height="9"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></span>`
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
        lines.push(perLineProp(k, resolveVars(v), v.includes('var(') ? v : undefined))
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
        lines.push(perLineProp(k, resolveVars(v), v.includes('var(') ? v : undefined))
      }
      if (lines.length > 0) {
        responsiveInline += `\n<div class="ss-section-card ss-card-responsive"><div class="ss-section-card-header">${respIcon} <span class="ss-section-card-tag">@media ${escapeHtml(query)}</span></div><pre class="ss-css ss-flat-list">${lines.join('\n')}</pre></div>`
      }
    }
  }

  const expandBtn = hasMore
    ? `<div class="ss-expand"><button class="ss-expand-btn" data-expanded="0">Show all ${allProps.length} properties</button></div>`
    : ''

  const isCurrentlyLocked = !!S.lockedElement

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
      ${_showTW ? `<span class="ss-match">TW ${matchPct}%</span>` : ''}
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
        ${_showTW ? `<button class="ss-tw-copy-btn" title="Copy Tailwind classes" style="opacity:${matchPct >= 30 ? '1' : '0.4'};">
          <svg ${SVG} width="12" height="12"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/><path d="M8 12s1-2 4-2 4 2 4 2"/></svg> TW
        </button>` : ''}
        <button class="ss-ai-btn" title="Generate AI Prompt">
          <svg ${SVG} width="12" height="12"><path d="M15 4 20 9 9 20 4 20 4 15Z"/><path d="m13 6 5 5"/></svg> Prompt
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
  if (S.overlayCleanup) { S.overlayCleanup(); S.overlayCleanup = null }

  // Floating UI: smart placement with flip + shift
  // Use generation counter to discard stale async position updates
  const gen = ++S.overlayGen
  const updatePosition = () => {
    computePosition(el, overlay, {
      strategy: 'fixed',
      // overlaySide controls which corner the overlay anchors to.
      // left → align to the element's left edge (bottom-start);
      // right → align to the element's right edge (bottom-end).
      placement: _overlaySide === 'left' ? 'bottom-start' : 'bottom-end',
      middleware: [
        offset(4),
        flip({ fallbackPlacements: _overlaySide === 'left' ? ['top-start', 'right-start', 'left-start'] : ['top-end', 'left-start', 'right-start'] }),
        shift({ padding: 8 }),
      ],
    }).then(({ x, y }) => {
      // Discard if a newer showOverlay call has happened
      if (gen !== S.overlayGen) return
      // Clamp into the viewport: flip()+shift() don't constrain the main axis, so
      // a huge locked element (e.g. a full-page container) can push the overlay
      // off the top/edge. Clamp using the overlay's real size.
      const pad = 8
      const ow = overlay.offsetWidth || 0
      const oh = overlay.offsetHeight || 0
      const cx = Math.max(pad, Math.min(x, window.innerWidth - ow - pad))
      const cy = Math.max(pad, Math.min(y, window.innerHeight - oh - pad))
      overlay.style.setProperty('left', `${Math.round(cx)}px`, 'important')
      overlay.style.setProperty('top', `${Math.round(cy)}px`, 'important')
      // Keep guides anchored to the element on scroll/resize too
      if (S.lockedElement) {
        refreshGuides(S.lastHighlighted)  // keep lock + hover sets following on scroll
        repositionSidePanel(overlay)
      }
    }).catch(() => {
      // Fallback: position below element with naive calc
      if (gen !== S.overlayGen) return
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

  // Do an immediate position update first, then auto-track on scroll/resize
  // for BOTH hover and locked — a locked overlay must follow its element when
  // the page scrolls (previously it stayed frozen in place).
  updatePosition()
  S.overlayCleanup = autoUpdate(el, overlay, updatePosition)

  // ─── Inline edit + per-value copy handlers (reusable for expand) ───
  function attachCSSHandlers(container: HTMLElement) {
    container.querySelectorAll('.ss-val').forEach((valEl) => {
      const applyVal = (span: HTMLElement) => {
        span.setAttribute('contenteditable', 'false')
        const prop = span.dataset.prop
        const newVal = span.textContent?.trim() || ''
        span.dataset.original = newVal
        if (prop && S.lockedElement) {
          ;(S.lockedElement as HTMLElement).style.setProperty(prop, newVal)
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
      const target = S.lockedElement || S.lastHighlighted
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
      const target = S.lockedElement || S.lastHighlighted
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
      if (!S.lockedElement) { showToast('Lock an element first'); return }
      exportCSSToCodePen()
    })
  }

  // Footer AI button
  const aiBtn = overlay.querySelector('.ss-ai-btn') as HTMLElement | null
  if (aiBtn && !aiBtn.dataset.bound) {
    aiBtn.dataset.bound = 'true'
    aiBtn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      if (!S.lockedElement) { showToast('Lock an element first'); return }
      showAIPrompt()
    })
  }

  // Side panel — hide on small viewports to avoid crowding
  if (S.showSidePanel && isCurrentlyLocked && window.innerWidth >= 900) {
    updateSidePanel(el as HTMLElement, overlay)
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
  if (S.overlayCleanup) { S.overlayCleanup(); S.overlayCleanup = null }
  // Clean up any open export menu
  const menu = $$('stylesnap-export-menu')
  if (menu) menu.remove()
  hideSidePanel()
}

// ─── Inline edit ────────────────────────────────────────────────────

function highlightElement(el: Element) {
  if (S.lockedElement && el !== S.lockedElement) return
  removeHighlight()
  el.classList.add(HIGHLIGHT_CLASS)
  S.lastHighlighted = el
}

function removeHighlight() {
  if (S.lastHighlighted && S.lastHighlighted !== S.lockedElement) {
    S.lastHighlighted.classList.remove(HIGHLIGHT_CLASS, PREVIEW_CLASS)
    S.lastHighlighted = null
  }
}

export function lockElement(el: Element) {
  if (S.lockedElement) S.lockedElement.classList.remove(LOCKED_CLASS)
  // Clean up highlight/preview classes before adding lock
  el.classList.remove(HIGHLIGHT_CLASS, PREVIEW_CLASS)
  S.lockedElement = el
  el.classList.add(LOCKED_CLASS)
  S.lastHighlighted = null
  // Push to inspection history (Feature 4)
  const _hcls = classNameOf(el).split(/\s+/).filter(c => c && !c.startsWith('stylesnap-')).slice(0, 2).join('.')
  const _hsnap = {
    el,
    tag: el.tagName.toLowerCase(),
    selector: el.id ? '#' + el.id : el.tagName.toLowerCase() + (_hcls ? '.' + _hcls : ''),
    snippet: (el as HTMLElement).outerHTML.slice(0, 80),
    parsedCSS: S.lastParsedCSS,
    timestamp: Date.now(),
  }
  S.history.unshift(_hsnap)
  if (S.history.length > 10) S.history.pop()
  // Stop auto-tracking — locked overlay stays fixed
  if (S.overlayCleanup) { S.overlayCleanup(); S.overlayCleanup = null }
  const overlay = $$(OVERLAY_ID)
  if (overlay) {
    overlay.classList.remove('ss-interactive')
    overlay.classList.add('ss-active')
    updateLockIcon(overlay, true)
  }
}

export function unlockElement() {
  if (S.lockedElement) {
    S.lockedElement.classList.remove(LOCKED_CLASS)
    S.lockedElement = null
  }
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
      const text = (owner.textContent || '').replace(/\/\*[\s\S]*?\*\//g, '')
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
  if (S.lastParsedCSS && S.lastParsedCSS.styles && Object.keys(S.lastParsedCSS.styles).length > 0) {
    const output = formatCSS(S.lastParsedCSS.styles, S.lastParsedCSS.selector)
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
  if (!el || el.closest('[data-stylesnap]')) return

  // If an element is locked, show preview dashed outline on other elements
  // (but keep overlay frozen on the locked element)
  if (S.lockedElement) {
    if (el === S.lockedElement || el === S.lastHighlighted) return
    removeHighlight()
    el.classList.add(PREVIEW_CLASS)
    S.lastHighlighted = el
    refreshGuides(el)  // locked set stays; hover set follows this element
    return
  }

  if (el === S.lastHighlighted) return

  highlightElement(el)
  const parsedCSS = parseElement(el)
  showOverlay(el, parsedCSS)
  const rect = el.getBoundingClientRect()
  refreshGuides(el)

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
    if (S.lockedElement) {
      unlockElement()
      chrome.runtime.sendMessage({ type: 'ELEMENT_UNLOCKED' }).catch(() => {})
      hideOverlay()
    }
    return
  }

  if (S.lockedElement) {
    // Click on a different element → swap lock
    if (el !== S.lockedElement) {
      lockElement(el)
      const parsedCSS = parseElement(el)
      showOverlay(el, parsedCSS)
      refreshGuides(null)
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
  refreshGuides(null)

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
    if (S.inspectMode === 1) setInspectMode(2)
    else if (S.inspectMode === 2) setInspectMode(3)
    else if (S.inspectMode === 3) setInspectMode(1)
    const labels = ['Off', 'Inspect', 'Guidelines', 'Grid']
    showToast(`Mode: ${labels[S.inspectMode]}`)
    // guides handled by setInspectMode → updateModeUI → refreshGuides
    return
  }

  if (e.key === 'Escape' && isActive()) {
    e.preventDefault()
    e.stopPropagation()
    // Priority: unlock, then exit inspect mode
    if (S.lockedElement) {
      unlockElement()
      chrome.runtime.sendMessage({ type: 'ELEMENT_UNLOCKED' }).catch(() => {})
      hideOverlay()
      return
    }
    setInspectMode(0)
    chrome.runtime.sendMessage({ type: 'DISABLE_INSPECTOR' }).catch(() => {})
  }

  // ─── DOM tree navigation (Arrow keys) ───
  const navEl = S.lockedElement || S.lastHighlighted
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
      S.lastParsedCSS = parsedCSS

      if (S.lockedElement) {
        // Navigate from locked element → lock on new element
        unlockElement()
        lockElement(target)
        // Don't call highlightElement — locked visual is sufficient,
        // and adding HIGHLIGHT_CLASS on top of LOCKED_CLASS causes it to
        // never be cleaned up (removeHighlight skips when S.lastHighlighted===S.lockedElement)
      } else {
        // Navigate from hovered element → hover new element
        removeHighlight()
        S.lastHighlighted = target
        highlightElement(target)
      }

      showOverlay(target, parsedCSS)
      refreshGuides(target as Element)
      showToast(`${tag(target)} ${(target as HTMLElement).id ? '#' + (target as HTMLElement).id : classNameOf(target) ? '.' + classNameOf(target).split(/\s+/).filter(c => c && !c.startsWith('stylesnap-')).slice(0,2).join('.') : ''}`)
    }
  }
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
    // If the selector targets this element (not just descendants), use it for the main block.
    // Check membership in ALL matches — `=== querySelector(s)` only works when el is the
    // first match, so duplicate-shaped elements (2nd, 3rd …) were misclassified. (E4)
    const isElSelector = sel.split(',').some(s => {
      try {
        const clean = s.trim().replace(/:hover|:focus|:active/g, '')
        return Array.from(document.querySelectorAll(clean)).includes(el)
      } catch { return false }
    })
    if (isElSelector) elSelectors.push(sel)
    else otherSelectors.push(sel)
  }

  // Main element block — use the SAME source as Copy CSS (S.lastParsedCSS, via
  // formatCSS) so the inspected element's rule is byte-identical in both. The
  // descendant / pseudo / media rules below are appended only so the component
  // still renders in CodePen.
  if (S.lastParsedCSS && S.lastParsedCSS.styles && Object.keys(S.lastParsedCSS.styles).length > 0) {
    cssLines.push(formatCSS(S.lastParsedCSS.styles, S.lastParsedCSS.selector))
  } else if (elSelectors.length > 0 || Object.keys(computedFallback).length > 0) {
    // Fallback (no cached parse): original component-derived main block.
    const mainProps: Record<string, string> = { ...computedFallback }
    for (const sel of elSelectors) {
      Object.assign(mainProps, resolveProps(el, rules.get(sel)!))
    }
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
  const el = S.lockedElement as HTMLElement
  if (!el) return
  const title = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
  submitCodePen({
    title: `StyleSnap — ${title} (CSS)`,
    html: extractComponentHTML(el, 2),
    css: `/* Exported by StyleSnap */\n${getComponentCSSForExport(el)}`,
    editors: '110',
  })
}

function onScroll() {
  if (!isActive()) return
  refreshGuides(S.lastHighlighted)  // re-anchor lock + hover sets to current rects
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
    if (changes.stylesnap_settings) {
      const newSettings = changes.stylesnap_settings.newValue
      const oldSettings = changes.stylesnap_settings.oldValue
      if (newSettings) {
        reloadFormatSettings()
        // Apply assist mode ONLY when it actually changed (so this doesn't fight
        // setInspectMode's own writes from G-key cycling). assist 0/1/2 → mode 1/2/3.
        const newAssist = newSettings.assistMode ?? 1
        if (oldSettings && newAssist !== (oldSettings.assistMode ?? 1) && S.inspectMode > 0) {
          setInspectMode(newAssist + 1)
        }
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
      if (S.inspectMode === 0) setInspectMode(1)
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
        setInspectMode(S.lastMode > 0 ? S.lastMode : 1)
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
  $$('stylesnap-floating-btn')?.remove()
  $$('stylesnap-overlay')?.remove()
  $$('stylesnap-preview-panel')?.remove()
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

;(window as any).debugInspectMode = () => S.inspectMode

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

document.addEventListener('stylesnap-debug-unlock', (() => {
  unlockElement()
}) as EventListener)

} // end if (import.meta.env.DEV)

