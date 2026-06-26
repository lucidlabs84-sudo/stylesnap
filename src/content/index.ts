/**
 * Content Script
 * Injected into every page. Handles hover detection, CSS extraction,
 * element highlighting, and design token scanning.
 */

import './overlay.css'

import { parseElement, extractComponentHTML, extractComponentCSS, formatCSS } from '@/lib/css-extractor'
import { extractDesignTokens } from '@/lib/token-extractor'
import { detectLang, translations, TranslationKey } from '@/lib/i18n-core'
import {
  stAppend, $$, attachOutsideClose,
  isColorValue, escapeHtml, classNameOf, colorBlock,
  SVG, CLOSE_X, showToast, closeHintPopups,
} from './ui'
import { mapCSSToTailwind, getTailwindClasses } from './tailwind'
import { S, isActive, assistMode, OVERLAY_ID, HIGHLIGHT_CLASS, LOCKED_CLASS, PREVIEW_CLASS, FLOATING_BTN_ID } from './state'
import { showUpgradeModal } from './panels/modals'
import { showAIPrompt } from './panels/ai-prompt'
import { showDesignPopup } from './panels/design'
import { toggleShortcutsPanel } from './panels/shortcuts'
import { showPreviewPanel, extractPreviewHTML } from './panels/preview-dev'
import { updateSidePanel, hideSidePanel } from './side-panel'
import { showSettingsPopup } from './panels/settings'

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

function reloadFormatSettings() {
  chrome.storage.local.get(['stylesnap_settings'], (res) => {
    const s = res.stylesnap_settings || {}
    _colorFormat = s.colorFormat || 'rgb'
    _shortenCSS = s.shortenCSS !== false
    S.showSidePanel = s.showSidePanel !== false
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

function updateModeUI() {
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

  const target = S.lockedElement || S.lastHighlighted
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

  updateModeUI()

  // persist
  chrome.storage.local.get(['stylesnap_settings'], (res) => {
    const s = res.stylesnap_settings || {}
    s.S.inspectMode = S.inspectMode
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
  const isPro = S.licenseIsPro
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
  if (S.overlayCleanup) { S.overlayCleanup(); S.overlayCleanup = null }

  // Floating UI: smart placement with flip + shift
  // Use generation counter to discard stale async position updates
  const gen = ++S.overlayGen
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
      if (gen !== S.overlayGen) return
      overlay.style.setProperty('left', `${Math.round(x)}px`, 'important')
      overlay.style.setProperty('top', `${Math.round(y)}px`, 'important')
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

  // Do an immediate position update first
  updatePosition()
  // Only auto-track when hovering (not locked) — locked overlay stays put
  if (!isCurrentlyLocked) {
    S.overlayCleanup = autoUpdate(el, overlay, updatePosition)
  }

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

  // ─── Side panel (Box Model + Preview) — only when locked ───────────
  if (S.showSidePanel && isCurrentlyLocked) {
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
  if (S.overlayCleanup) { S.overlayCleanup(); S.overlayCleanup = null }
  // Clean up any open export menu
  const menu = $$('stylesnap-export-menu')
  if (menu) menu.remove()
  hideSidePanel()
}

// ─── Side Panel (Box Model + Preview) ────────────────────────────────

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

function lockElement(el: Element) {
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

function unlockElement() {
  if (S.lockedElement) {
    S.lockedElement.classList.remove(LOCKED_CLASS)
    S.lockedElement = null
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
  const ov = $$(OVERLAY_ID)
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
  const ov = $$(OVERLAY_ID)
  if (!ov) return
  ov.querySelectorAll('.ss-val-diff').forEach((el) => {
    el.classList.remove('ss-val-diff')
    el.removeAttribute('data-compare')
  })
}

function highlightCompareElement(el: Element | null) {
  if (!el || el === S.lockedElement) return
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
  if (!el || el.closest('[data-stylesnap]')) {
    removeCompareHighlight()
    hideCompareTooltip()
    return
  }

  // If an element is locked, show preview dashed outline on other elements
  // (but keep overlay frozen on the locked element)
  if (S.lockedElement) {
    if (!S.compareMode) {
      if (el === S.lockedElement || el === S.lastHighlighted) return
      removeHighlight()
      el.classList.add(PREVIEW_CLASS)
      S.lastHighlighted = el
      return
    }
    // Compare mode: keep existing logic
    if (el === S.lockedElement) {
      removeCompareHighlight()
      hideCompareTooltip()
      return
    }
    highlightCompareElement(el)
    showCompareTooltip(el, e.clientX, e.clientY)
    return
  }

  if (el === S.lastHighlighted) return

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
    if (S.inspectMode === 1) setInspectMode(2)
    else if (S.inspectMode === 2) setInspectMode(3)
    else if (S.inspectMode === 3) setInspectMode(1)
    const labels = ['Off', 'Inspect', 'Guidelines', 'Grid']
    showToast(`Mode: ${labels[S.inspectMode]}`)
    const target = S.lockedElement || S.lastHighlighted
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
    if (S.lockedElement) {
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
// showToast / showToastImpl now imported from ./ui

// ─── History Panel ────────────────────────────────────────────────────
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
    if (S.history.length === 0) return `<div style="padding:16px;text-align:center;color:#94a3b8;">No history yet — lock elements with click</div>`
    return S.history.map((item, i) => `
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
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <span style="font-weight:600;font-size:13px;">History</span>
      <span style="font-size:11px;color:#64748b;">${S.history.length} items</span>
      <button id="ss-history-close" style="margin-left:auto;background:none;border:none;color:#64748b;cursor:pointer;padding:2px 4px;border-radius:4px;display:flex;">${CLOSE_X}</button>
    </div>
    <div id="ss-history-list">${renderItems()}</div>
  `
  stAppend(popup)

  popup.querySelector('#ss-history-close')?.addEventListener('click', () => popup.remove())

  popup.querySelectorAll('.ss-history-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt((item as HTMLElement).dataset.idx || '0')
      const snap = S.history[idx]
      if (!snap) return
      popup.remove()
      // Prefer the exact element we locked before (stored reference); only fall
      // back to the selector (first match) if it has been detached from the DOM.
      let target: Element | null = snap.el && document.body.contains(snap.el) ? snap.el : null
      if (!target) { try { target = document.querySelector(snap.selector) } catch (_) {} }
      if (target && document.body.contains(target)) {
        // Element still exists — lock and show overlay
        unlockElement()
        lockElement(target as Element)
        const parsedCSS = parseElement(target)
        S.lastParsedCSS = parsedCSS
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


function onScroll() {
  if (!isActive()) return
  const target = S.lockedElement || S.lastHighlighted
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
      const overlay = $$(OVERLAY_ID)
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

document.addEventListener('stylesnap-debug-toggle-compare', (() => {
  S.compareMode = !S.compareMode
  const btn = document.getElementById('stylesnap-action-compare') as HTMLElement | null
  if (btn) {
    if (S.compareMode) { btn.classList.add('active'); btn.title = 'Compare: ON' }
    else { btn.classList.remove('active'); btn.title = 'Compare: OFF' }
  }
  if (!S.compareMode) { removeCompareHighlight(); hideCompareTooltip() }
}) as EventListener)

document.addEventListener('stylesnap-debug-compare-state', ((e: CustomEvent) => {
  const cb = e.detail?.callback as ((d: unknown) => void) | undefined
  if (cb) cb({ compareMode: S.compareMode, lockedElement: !!S.lockedElement, compareTarget: !!_compareTarget })
}) as EventListener)

document.addEventListener('stylesnap-debug-compare', ((e: CustomEvent) => {
  const selector = e.detail?.selector as string | undefined
  if (!selector) return
  const el = document.querySelector(selector)
  if (el && S.compareMode && S.lockedElement) {
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
  if (!S.lockedElement) { showToast('Lock an element first'); return }
  const el = S.lockedElement as HTMLElement
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
  if (!S.lockedElement) { showToast('Lock an element first'); return }
  const el = S.lockedElement as HTMLElement
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
  if (!S.lockedElement) { showToast('Lock an element first'); return }
  const el = S.lockedElement as HTMLElement
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
  if (!S.lockedElement) { showToast('Lock an element first'); return }
  const el = S.lockedElement as HTMLElement
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

