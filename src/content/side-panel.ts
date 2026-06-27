/** Side panel — Box Model visualization shown beside the overlay when locked. */
import { $$, stAppend, CLOSE_X } from './ui'

const SIDE_PANEL_ID = 'stylesnap-side-panel'

/** Build the box model HTML.  ml/mr now sit in the margin layer, not border. */
function buildBoxModelHTML(el: HTMLElement, rect: DOMRect): string {
  const cs = window.getComputedStyle(el)
  const get = (p: string) => {
    const n = parseFloat(cs.getPropertyValue(p))
    if (isNaN(n) || n === 0) return '0'
    return (n === Math.round(n) ? String(Math.round(n)) : n.toFixed(1)) + 'px'
  }
  const mt = get('margin-top'), mr = get('margin-right'), mb = get('margin-bottom'), ml = get('margin-left')
  const bt = get('border-top-width'), br = get('border-right-width'), bb = get('border-bottom-width'), bl = get('border-left-width')
  const pt = get('padding-top'), pr = get('padding-right'), pb = get('padding-bottom'), pl = get('padding-left')
  const w = Math.round(rect.width), h = Math.round(rect.height)

  return `<div class="ss-boxmodel">
    <div class="ss-bm-margin">
      <div class="ss-bm-edge-top-bot">${mt}</div>
      <div class="ss-bm-mid-row">
        <span class="ss-bm-edge-side">${ml}</span>
        <div class="ss-bm-border">
          <div class="ss-bm-edge-top-bot">${bt}</div>
          <div class="ss-bm-mid-row">
            <span class="ss-bm-edge-side">${bl}</span>
            <div class="ss-bm-padding">
              <div class="ss-bm-edge-top-bot">${pt}</div>
              <div class="ss-bm-content">${w}\u00D7${h}</div>
              <div class="ss-bm-edge-top-bot">${pb}</div>
            </div>
            <span class="ss-bm-edge-side">${br}</span>
          </div>
          <div class="ss-bm-edge-top-bot">${bb}</div>
        </div>
        <span class="ss-bm-edge-side">${mr}</span>
      </div>
      <div class="ss-bm-edge-top-bot">${mb}</div>
    </div>
    <div class="ss-bm-edge-labels">
      <span>M:${mt} ${mr} ${mb} ${ml}</span>
      <span>B:${bt} ${br} ${bb} ${bl}</span>
      <span>P:${pt} ${pr} ${pb} ${pl}</span>
    </div>
  </div>`
}

export function updateSidePanel(el: HTMLElement, overlay: HTMLElement) {
  let panel = $$(SIDE_PANEL_ID)
  if (!panel) {
    panel = document.createElement('div')
    panel.id = SIDE_PANEL_ID
    panel.setAttribute('data-stylesnap', 'true')
    Object.assign(panel.style, {
      // Above the overlay (999991) but below the hint-bar popups (999994) so
      // Design/History/Settings are never covered by the box-model panel.
      position: 'fixed', zIndex: '999992',
      background: 'var(--ss-bg-panel)',
      border: '1px solid var(--ss-primary-border)',
      borderRadius: '10px', width: '220px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
      fontFamily: 'system-ui,sans-serif', fontSize: '11px',
      color: '#e2e8f0', overflow: 'hidden',
      opacity: '0', transition: 'opacity 0.15s ease-out',
    })
    stAppend(panel)

    // Build structure once, bind close button once
    panel.innerHTML = `
      <div class="ss-sp-header" style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <span style="font-size:10px;font-weight:600;color:#64748b;letter-spacing:0.05em;text-transform:uppercase;">Box Model</span>
        <button id="ss-sp-close" title="Close" style="background:none;border:none;color:#475569;cursor:pointer;padding:2px;display:flex;border-radius:3px;">${CLOSE_X}</button>
      </div>
      <div id="ss-bm-body" style="padding:10px;"></div>
    `
    panel.querySelector('#ss-sp-close')?.addEventListener('click', () => {
      panel!.style.opacity = '0'
      setTimeout(() => panel!.remove(), 160)
    })

    // Trigger fade-in on next paint frame
    requestAnimationFrame(() => requestAnimationFrame(() => {
      panel!.style.opacity = '1'
    }))
  }

  // Re-render body only if values changed
  const rect = el.getBoundingClientRect()
  const hash = `${rect.width},${rect.height},${el.offsetWidth},${el.offsetHeight},${window.getComputedStyle(el).margin}`
  if (panel.dataset.lastHash === hash) {
    positionSidePanel(panel, overlay)
    return
  }
  panel.dataset.lastHash = hash

  const body = panel.querySelector('#ss-bm-body')
  if (body) body.innerHTML = buildBoxModelHTML(el, rect)

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

/** Re-anchor the existing side panel to the overlay (e.g. on scroll/resize). */
export function repositionSidePanel(overlay: HTMLElement) {
  const panel = $$(SIDE_PANEL_ID)
  if (panel) positionSidePanel(panel, overlay)
}

export function hideSidePanel() {
  const panel = $$(SIDE_PANEL_ID)
  if (!panel) return
  panel.style.opacity = '0'
  setTimeout(() => panel.remove(), 160)
}
