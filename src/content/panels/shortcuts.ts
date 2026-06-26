/** Keyboard shortcuts help panel. */
import { $$, stAppend, attachOutsideClose } from '../ui'

export function toggleShortcutsPanel() {
  const existing = $$('stylesnap-shortcuts-panel')
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

// ─── History Panel (Feature 4) ────────────────────────────────────────
