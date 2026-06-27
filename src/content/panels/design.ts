/**
 * Tokens panel — the page's design system in one view.
 * Shows CSS custom properties (--tokens) grouped by kind (colors / typography /
 * spacing / radius / shadow), and falls back to scanning computed colors & fonts
 * so pages without CSS variables still show something useful.
 * (Exported as showDesignPopup / panel id stylesnap-design-popup for back-compat.)
 */
import { $$, stAppend, attachOutsideClose, showToast, CLOSE_X, closeHintPopups, escapeHtml, isColorValue } from '../ui'

interface Token { name: string; value: string }

/** Collect resolved :root / html custom properties (skip our own stylesheet). */
function collectRootVars(): Token[] {
  const names = new Set<string>()
  for (const sheet of Array.from(document.styleSheets)) {
    const ownerId = (sheet.ownerNode as Element | null)?.id || ''
    if (ownerId.startsWith('stylesnap')) continue
    let rules: CSSRuleList
    try { rules = sheet.cssRules } catch { continue } // cross-origin
    for (const rule of Array.from(rules)) {
      if (rule.type !== CSSRule.STYLE_RULE) continue
      const sr = rule as CSSStyleRule
      const sel = sr.selectorText || ''
      if (!/(^|,)\s*(:root|html)\s*(,|$)/.test(sel)) continue
      for (let i = 0; i < sr.style.length; i++) {
        const p = sr.style[i]
        if (p.startsWith('--')) names.add(p)
      }
    }
  }
  const rootCS = window.getComputedStyle(document.documentElement)
  const out: Token[] = []
  for (const name of names) {
    const value = rootCS.getPropertyValue(name).trim()
    if (value) out.push({ name, value })
  }
  return out
}

type Kind = 'color' | 'font' | 'spacing' | 'radius' | 'shadow' | 'misc'
function classify(name: string, value: string): Kind {
  const n = name.toLowerCase()
  if (/radius|rounded/.test(n)) return 'radius'
  if (/shadow|elevation/.test(n)) return 'shadow'
  if (isColorValue(value)) return 'color'
  if (/font|family|text|leading|tracking|weight/.test(n)) return 'font'
  if (/space|spacing|gap|size|width|height|inset|margin|padding/.test(n) && /^-?[\d.]/.test(value)) return 'spacing'
  if (/^-?[\d.]+(px|rem|em|%|vh|vw)/.test(value)) return 'spacing'
  return 'misc'
}

function normalizeHex(value: string): string {
  const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (m) return '#' + [m[1], m[2], m[3]].map(x => parseInt(x).toString(16).padStart(2, '0')).join('')
  return value.toLowerCase()
}

/** Scan computed colors across the page (fallback when there are no color tokens). */
function scanColors(): string[] {
  const colorMap = new Map<string, true>()
  const props = ['color', 'background-color', 'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color', 'outline-color', 'fill', 'stroke']
  const all = document.querySelectorAll('*')
  const nodes = all.length > 500 ? Array.from(all).slice(0, 500) : Array.from(all)
  for (const node of nodes) {
    if ((node as HTMLElement).dataset?.stylesnap) continue
    if ((node as Element).id?.startsWith('stylesnap-')) continue
    const cs = window.getComputedStyle(node as HTMLElement)
    for (const p of props) {
      const v = cs.getPropertyValue(p)
      if (!v || v === 'rgba(0, 0, 0, 0)' || v === 'transparent') continue
      const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      if (!m) continue
      colorMap.set('#' + [m[1], m[2], m[3]].map(x => parseInt(x).toString(16).padStart(2, '0')).join(''), true)
    }
  }
  return Array.from(colorMap.keys())
}

/** Scan computed font families (fallback when there are no font tokens). */
function scanFonts(): string[] {
  const fonts = new Set<string>()
  const all = document.querySelectorAll('*')
  const nodes = all.length > 500 ? Array.from(all).slice(0, 500) : Array.from(all)
  for (const node of nodes) {
    if ((node as HTMLElement).dataset?.stylesnap) continue
    if ((node as Element).id?.startsWith('stylesnap-')) continue
    const ff = window.getComputedStyle(node as HTMLElement).fontFamily.split(',')[0].replace(/['"]/g, '').trim()
    if (ff) fonts.add(ff)
  }
  return Array.from(fonts).slice(0, 12)
}

export function showDesignPopup() {
  const existing = $$('stylesnap-design-popup')
  if (existing) { existing.remove(); return }
  closeHintPopups('stylesnap-design-popup')

  const popup = document.createElement('div')
  popup.id = 'stylesnap-design-popup'
  popup.setAttribute('data-stylesnap', 'true')
  Object.assign(popup.style, {
    position: 'fixed', zIndex: '999994',
    background: 'var(--ss-bg-panel)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '10px', width: '320px', maxHeight: '480px',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    fontFamily: 'system-ui, sans-serif', color: '#e2e8f0', fontSize: '12px',
  })

  popup.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px 8px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,0.06);">
      <span style="font-size:13px;font-weight:600;">Tokens</span>
      <button id="ss-design-close" style="background:none;border:none;color:#64748b;cursor:pointer;padding:2px 4px;border-radius:4px;display:flex;">${CLOSE_X}</button>
    </div>
    <div id="ss-tok-body" class="ss-hint-scroll" style="flex:1;overflow-y:auto;padding:10px 12px;">
      <div style="padding:16px;text-align:center;color:#94a3b8;font-size:11px;">Extracting tokens…</div>
    </div>
    <div style="flex-shrink:0;padding:8px 12px;border-top:1px solid rgba(255,255,255,0.06);display:flex;gap:6px;">
      <button id="ss-tok-copy-vars" style="flex:1;background:var(--ss-primary-bg);border:1px solid rgba(99,102,241,0.3);color:var(--ss-primary-lighter);border-radius:4px;padding:5px 6px;font-size:10px;cursor:pointer;">Copy CSS Vars</button>
      <button id="ss-tok-copy-json" style="flex:1;background:var(--ss-primary-bg);border:1px solid rgba(99,102,241,0.3);color:var(--ss-primary-lighter);border-radius:4px;padding:5px 6px;font-size:10px;cursor:pointer;">Copy JSON</button>
    </div>
  `
  stAppend(popup)

  // Position centered below the hint bar
  const hint = $$('stylesnap-hint-bar')
  const pw = 320
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
  attachOutsideClose(popup, { delay: 300 })

  // ── Extract + render (deferred so the panel paints first) ──
  setTimeout(() => {
    try {
      const vars = collectRootVars()
      const byKind: Record<Kind, Token[]> = { color: [], font: [], spacing: [], radius: [], shadow: [], misc: [] }
      for (const t of vars) byKind[classify(t.name, t.value)].push(t)

      // Colors: token colors + scanned colors not already represented by a token
      const tokenHexes = new Set(byKind.color.map(t => normalizeHex(t.value)))
      const scannedColors = scanColors().filter(hex => !tokenHexes.has(hex))
      const colorSwatches = [
        ...byKind.color.map(t => ({ name: t.name, value: t.value, hex: normalizeHex(t.value) })),
        ...scannedColors.map(hex => ({ name: '', value: hex, hex })),
      ]

      // Fonts: font tokens + scanned families
      const fontTokens = byKind.font
      const scannedFonts = scanFonts()

      const body = popup.querySelector('#ss-tok-body') as HTMLElement
      const sections: string[] = []

      // — Colors —
      if (colorSwatches.length) {
        const grid = colorSwatches.map(c => {
          const label = c.name || c.hex
          const copyVal = c.name ? `var(${c.name})` : c.hex
          return `<div class="ss-tok-color" data-copy="${escapeHtml(copyVal)}" title="${escapeHtml(c.name ? c.name + ' = ' + c.value : c.value)}" style="cursor:pointer;text-align:center;min-width:0;">
            <div style="width:100%;aspect-ratio:1;border-radius:6px;background:${escapeHtml(c.value)};border:1px solid rgba(255,255,255,0.12);"></div>
            <div style="font-size:8.5px;color:#94a3b8;margin-top:2px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(label)}</div>
          </div>`
        }).join('')
        sections.push(sectionHTML('Colors', colorSwatches.length,
          `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(54px,1fr));gap:6px;">${grid}</div>`))
      }

      // — Typography —
      if (fontTokens.length || scannedFonts.length) {
        const tokRows = fontTokens.map(t => kvRow(t.name, t.value)).join('')
        const fontRows = scannedFonts.map(f => `<div class="ss-tok-row" data-copy="${escapeHtml(f)}" title="Click to copy" style="cursor:pointer;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span style="font-family:'${escapeHtml(f)}',sans-serif;font-size:13px;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(f)}</span>
          <span style="font-size:13px;color:#64748b;font-family:'${escapeHtml(f)}',sans-serif;flex-shrink:0;">Ag</span>
        </div>`).join('')
        sections.push(sectionHTML('Typography', fontTokens.length + scannedFonts.length, tokRows + fontRows))
      }

      // — Spacing / Radius / Shadow (vars only) —
      if (byKind.spacing.length) sections.push(sectionHTML('Spacing', byKind.spacing.length, byKind.spacing.map(t => kvRow(t.name, t.value)).join('')))
      if (byKind.radius.length) sections.push(sectionHTML('Radius', byKind.radius.length, byKind.radius.map(t => kvRow(t.name, t.value)).join('')))
      if (byKind.shadow.length) sections.push(sectionHTML('Shadow', byKind.shadow.length, byKind.shadow.map(t => kvRow(t.name, t.value)).join('')))
      if (byKind.misc.length) sections.push(sectionHTML('Other', byKind.misc.length, byKind.misc.map(t => kvRow(t.name, t.value)).join('')))

      body.innerHTML = sections.length
        ? sections.join('')
        : `<div style="padding:16px;text-align:center;color:#94a3b8;font-size:11px;">No tokens or colors found</div>`

      // Click-to-copy for swatches & rows
      body.querySelectorAll<HTMLElement>('[data-copy]').forEach(el => {
        el.addEventListener('click', () => {
          const text = el.dataset.copy || ''
          navigator.clipboard.writeText(text).then(() => showToast(`Copied ${text}`)).catch(() => {})
        })
      })

      // Footer: copy all
      const allTokens = [...byKind.color, ...byKind.font, ...byKind.spacing, ...byKind.radius, ...byKind.shadow, ...byKind.misc]
      popup.querySelector('#ss-tok-copy-vars')?.addEventListener('click', () => {
        const lines = allTokens.length
          ? allTokens.map(t => `  ${t.name}: ${t.value};`)
          : colorSwatches.map((c, i) => `  --color-${i + 1}: ${c.value};`)
        navigator.clipboard.writeText(`:root {\n${lines.join('\n')}\n}`).then(() => showToast('Copied CSS variables')).catch(() => {})
      })
      popup.querySelector('#ss-tok-copy-json')?.addEventListener('click', () => {
        const obj = allTokens.length
          ? Object.fromEntries(allTokens.map(t => [t.name, t.value]))
          : { colors: colorSwatches.map(c => c.value) }
        navigator.clipboard.writeText(JSON.stringify(obj, null, 2)).then(() => showToast('Copied JSON')).catch(() => {})
      })
    } catch {
      const body = popup.querySelector('#ss-tok-body') as HTMLElement
      if (body) body.innerHTML = `<div style="padding:16px;text-align:center;color:#f87171;">Extraction failed</div>`
    }
  }, 50)
}

function sectionHTML(title: string, count: number, inner: string): string {
  return `<div style="margin-bottom:14px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
      <span style="font-size:10px;font-weight:600;color:#64748b;letter-spacing:0.05em;text-transform:uppercase;">${title}</span>
      <span style="font-size:9px;color:#475569;">${count}</span>
    </div>
    ${inner}
  </div>`
}

function kvRow(name: string, value: string): string {
  return `<div class="ss-tok-row" data-copy="${escapeHtml(`var(${name})`)}" title="${escapeHtml(name + ' = ' + value)}" style="cursor:pointer;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:space-between;gap:8px;font-family:monospace;font-size:10px;">
    <span style="color:var(--ss-primary-lighter);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</span>
    <span style="color:#94a3b8;flex-shrink:0;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(value)}</span>
  </div>`
}
