/** Side panel (Box Model + live Preview) shown beside the overlay when locked. */
import { $$, stAppend, CLOSE_X } from './ui'
import type { ParsedCSS } from '@/shared/types'

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

export function updateSidePanel(el: HTMLElement, parsedCSS: ParsedCSS | null, overlay: HTMLElement) {
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

export function hideSidePanel() {
  $$(SIDE_PANEL_ID)?.remove()
}
