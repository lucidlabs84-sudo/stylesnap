/** Inspection history panel (session list of locked elements). */
import { $$, stAppend, attachOutsideClose, showToast, CLOSE_X, closeHintPopups } from '../ui'
import { S } from '../state'
import { parseElement } from '@/lib/css-extractor'
import { lockElement, unlockElement, showOverlay } from '../index'

export function showHistoryPanel() {
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
