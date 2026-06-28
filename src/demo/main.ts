/**
 * StyleSnap Web Demo — Live CSS Extraction
 * Runs the REAL extension core modules directly on the website.
 * Users hover over demo elements to see actual computed CSS + Tailwind conversion.
 *
 * Built as a standalone Vite bundle (not CRX). Chrome APIs are polyfilled
 * so the core extraction modules work without a browser extension context.
 */
import './chrome-polyfill'
import { parseElement } from '../lib/css-extractor'
import type { ParsedCSS } from '../shared/types'

// ─── Demo elements ──────────────────────────────────────────────────────────

interface DemoSpec {
  tag: string
  attrs?: Record<string, string>
  style?: Record<string, string>
  text?: string
  inner?: string
}

const DEMO_SPECS: DemoSpec[] = [
  {
    tag: 'button',
    attrs: { class: 'demo-btn-primary' },
    style: {
      background: '#6366f1', color: '#fff', border: 'none',
      borderRadius: '8px', padding: '12px 24px', fontSize: '15px',
      fontWeight: '600', cursor: 'pointer',
      boxShadow: '0 4px 14px rgba(99,102,241,0.4)',
      transition: 'all 0.2s ease',
    },
    text: 'Get Started',
  },
  {
    tag: 'div',
    attrs: { class: 'demo-card' },
    style: {
      background: '#fff', borderRadius: '12px', padding: '20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1), 0 8px 24px rgba(0,0,0,0.06)',
      maxWidth: '280px',
      border: '1px solid rgba(0,0,0,0.06)',
    },
    inner: `<h3 style="margin:0 0 8px;font-size:17px;font-weight:600;color:#0f172a;">Premium Plan</h3>
<p style="margin:0 0 16px;font-size:14px;color:#64748b;line-height:1.5;">Unlimited CSS extraction, Tailwind export, and more.</p>
<div style="font-size:28px;font-weight:700;color:#6366f1;">$29<span style="font-size:14px;color:#94a3b8;font-weight:400;"> lifetime</span></div>`,
  },
  {
    tag: 'span',
    attrs: { class: 'demo-badge' },
    style: {
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      background: 'rgba(52,211,153,0.12)', color: '#059669',
      padding: '4px 10px', borderRadius: '6px', fontSize: '12px',
      fontWeight: '600',
    },
    text: '✓ Active',
  },
  {
    tag: 'input',
    attrs: { type: 'text', placeholder: 'Search styles...', class: 'demo-input' },
    style: {
      width: '100%', padding: '10px 14px', fontSize: '14px',
      border: '1px solid #e2e8f0', borderRadius: '8px',
      outline: 'none',
      background: '#f8fafc', color: '#0f172a',
    },
  },
]

// ─── CSS Panel ──────────────────────────────────────────────────────────────

let panel: HTMLElement | null = null
let activeEl: Element | null = null
let hideTimer: number | null = null
let panelVisible = false

function getOrCreatePanel(): HTMLElement {
  if (panel) return panel
  panel = document.createElement('div')
  panel.id = 'ss-demo-panel'
  Object.assign(panel.style, {
    position: 'fixed',
    top: '0', left: '0',
    minWidth: '300px', maxWidth: '380px',
    background: 'rgba(15,23,42,0.98)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: '10px',
    padding: '0',
    zIndex: '99999',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '12px',
    color: '#e2e8f0',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(99,102,241,0.1)',
    opacity: '0',
    pointerEvents: 'none',
    transform: 'translateY(4px)',
    transition: 'opacity 0.15s ease, transform 0.15s ease',
  })
  document.body.appendChild(panel)

  // Mouse interaction: show panel on enter, hide on leave
  panel.addEventListener('mouseenter', () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null } })
  panel.addEventListener('mouseleave', hidePanel)

  return panel
}

function positionPanel(el: Element) {
  const p = getOrCreatePanel()
  const rect = el.getBoundingClientRect()
  const panelW = 360

  // Horizontal: prefer right of element, fall back to left
  let left = rect.right + 12
  if (left + panelW > window.innerWidth - 16) {
    left = rect.left - panelW - 12
    if (left < 8) left = 8
  }

  // Vertical: center-align with element, clamp to viewport
  let top = rect.top + rect.height / 2 - 180
  if (top < 8) top = 8
  if (top + 400 > window.innerHeight - 8) top = window.innerHeight - 408

  p.style.left = `${Math.round(left)}px`
  p.style.top = `${Math.round(top)}px`
}

function showPanel(el: Element) {
  if (activeEl === el && panelVisible) return
  activeEl = el
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }

  const parsed = parseElement(el)
  const p = getOrCreatePanel()
  positionPanel(el)
  renderPanelContent(p, el, parsed)

  requestAnimationFrame(() => {
    p.style.opacity = '1'
    p.style.transform = 'translateY(0)'
    p.style.pointerEvents = 'auto'
    panelVisible = true
  })
}

function hidePanel() {
  if (!panel) return
  hideTimer = window.setTimeout(() => {
    if (!panel || !panelVisible) return
    panel.style.opacity = '0'
    panel.style.transform = 'translateY(4px)'
    panel.style.pointerEvents = 'none'
    panelVisible = false
  }, 200)
}

// ─── Panel Content Renderer ─────────────────────────────────────────────────

const STYLE_SECTIONS: { label: string; keys: string[] }[] = [
  { label: 'Layout', keys: ['display', 'width', 'height', 'max-width', 'min-width', 'max-height', 'min-height', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'position', 'top', 'right', 'bottom', 'left', 'z-index'] },
  { label: 'Typography', keys: ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-transform', 'color', 'word-wrap', 'word-break', 'white-space'] },
  { label: 'Visual', keys: ['background', 'background-color', 'background-image', 'background-size', 'background-position', 'opacity', 'border', 'border-width', 'border-style', 'border-color', 'border-radius', 'box-shadow', 'outline', 'cursor'] },
  { label: 'Flex/Grid', keys: ['flex', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'align-content', 'gap', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row'] },
  { label: 'Other', keys: ['overflow', 'overflow-x', 'overflow-y', 'transform', 'transition', 'animation', 'filter', 'backdrop-filter', 'pointer-events', 'user-select', 'visibility'] },
]

function isColor(val: string): boolean {
  return /^(#|rgb|rgba|hsl|hsla|color\(|var\(--)/i.test(val.trim())
}

function colorSwatch(val: string): string {
  const safe = val.replace(/"/g, '').replace(/[<>]/g, '')
  return `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${safe};border:1px solid rgba(255,255,255,0.15);margin-right:6px;vertical-align:middle;flex-shrink:0;"></span>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderPanelContent(panel: HTMLElement, _el: Element, parsed: ParsedCSS) {
  const tag = _el.tagName.toLowerCase()
  const cls = (_el as HTMLElement).className || ''
  const styles = parsed.styles

  // Collect style properties into sections
  const sectionsHTML = STYLE_SECTIONS.map(section => {
    const props = section.keys.filter(k => styles[k])
    if (props.length === 0) return ''
    const rows = props.map(k => {
      const val = styles[k]
      const swatch = isColor(val) ? colorSwatch(val) : ''
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="color:#94a3b8;flex-shrink:0;">${esc(k)}</span>
        <span style="color:#e2e8f0;text-align:right;display:flex;align-items:center;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${swatch}${esc(val)}</span>
      </div>`
    }).join('')
    return `<div style="margin-bottom:6px;">
      <div style="color:#6366f1;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;padding-left:2px;">${section.label}</div>
      ${rows}
    </div>`
  }).join('')

  // Tailwind classes
  const twClasses = parsed.tailwindClasses || []
  const twHTML = twClasses.length > 0
    ? `<div style="margin-top:8px;border-top:1px solid rgba(99,102,241,0.2);padding-top:8px;">
        <div style="color:#818cf8;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">🌀 Tailwind</div>
        <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.15);border-radius:6px;padding:8px;font-family:'SF Mono',Monaco,monospace;font-size:11px;color:#a5b4fc;word-break:break-all;line-height:1.6;">
          ${esc(twClasses.join(' '))}
        </div>
      </div>`
    : ''

  // Dimensions from computed styles
  const rect = _el.getBoundingClientRect()
  const cs = window.getComputedStyle(_el)
  const dimsHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11px;color:#94a3b8;">
    <span style="background:rgba(99,102,241,0.12);padding:2px 8px;border-radius:4px;color:#e2e8f0;font-family:monospace;font-size:12px;font-weight:600;">${tag}${cls ? '.' + esc(cls).split(' ').join('.') : ''}</span>
    <span>${Math.round(rect.width)}×${Math.round(rect.height)}</span>
    <span>·</span>
    <span>${cs.fontFamily.split(',')[0]}</span>
    <span>${cs.fontSize}</span>
  </div>`

  panel.innerHTML = `
    <div style="padding:12px;">
      ${dimsHTML}
      ${sectionsHTML}
      ${twHTML}
      <div style="margin-top:10px;display:flex;gap:6px;">
        <button id="ss-demo-copy-css" style="flex:1;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.25);color:#a5b4fc;padding:6px;border-radius:6px;font-size:11px;font-weight:500;cursor:pointer;">📋 Copy CSS</button>
        <button id="ss-demo-copy-tw" style="flex:1;background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.2);color:#c4b5fd;padding:6px;border-radius:6px;font-size:11px;font-weight:500;cursor:pointer;">🌀 Copy TW</button>
        <a href="/stylesnap" id="ss-demo-pro" style="flex:1;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;color:#fff;padding:6px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;line-height:1.6;">Get Pro ✨</a>
      </div>
    </div>
  `

  // Wire up buttons
  const copyCSS = panel.querySelector('#ss-demo-copy-css')
  const copyTW = panel.querySelector('#ss-demo-copy-tw')
  copyCSS?.addEventListener('click', (e) => { e.stopPropagation(); showDemoToast('Install StyleSnap to copy CSS anywhere! 🚀') })
  copyTW?.addEventListener('click', (e) => { e.stopPropagation(); showDemoToast('Install StyleSnap for Tailwind export! 🌀') })
}

// ─── Demo Toast ─────────────────────────────────────────────────────────────

let toastTimer: number | null = null
function showDemoToast(msg: string) {
  let toast = document.getElementById('ss-demo-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'ss-demo-toast'
    Object.assign(toast.style, {
      position: 'fixed', bottom: '100px', left: '50%', transform: 'translateX(-50%)',
      background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
      color: '#fff', padding: '10px 20px', borderRadius: '8px',
      fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontWeight: '600',
      zIndex: '100000', transition: 'opacity 0.3s ease, transform 0.3s ease',
      boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
      pointerEvents: 'none',
    })
    toast.style.opacity = '0'
    toast.style.transform = 'translateX(-50%) translateY(10px)'
    document.body.appendChild(toast)
  }
  toast.textContent = msg
  toast.style.opacity = '1'
  toast.style.transform = 'translateX(-50%) translateY(0)'
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transform = 'translateX(-50%) translateY(10px)'
  }, 2500)
}

// ─── Initialize Demo Section ────────────────────────────────────────────────

let container: HTMLElement | null = null

export function initDemo(mountEl: HTMLElement) {
  container = mountEl
  container.style.cssText = 'display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:center;padding:16px 0;'

  for (const spec of DEMO_SPECS) {
    const el = document.createElement(spec.tag)
    if (spec.attrs) for (const [k, v] of Object.entries(spec.attrs)) el.setAttribute(k, v)
    if (spec.style) for (const [k, v] of Object.entries(spec.style)) (el as HTMLElement).style.setProperty(k, v)
    if (spec.text) el.textContent = spec.text
    if (spec.inner) el.innerHTML = spec.inner

    // For input: set placeholder via attribute
    if (spec.tag === 'input' && spec.attrs?.placeholder) {
      (el as HTMLInputElement).placeholder = spec.attrs.placeholder
    }

    el.setAttribute('data-ss-demo', 'true')

    el.addEventListener('mouseenter', () => showPanel(el))
    el.addEventListener('mouseleave', () => hidePanel())

    container.appendChild(el)
  }
}

// Auto-init when script loads — look for mount point
// Uses MutationObserver as fallback for SPAs where mount point appears after script load
function autoInit() {
  let tries = 0
  const MAX_TRIES = 20
  const INTERVAL_MS = 200

  function attempt() {
    const mount = document.getElementById('stylesnap-demo')
    if (mount) {
      console.log('[StyleSnap Demo] Mount point found, initializing...')
      initDemo(mount)
      return
    }
    tries++
    if (tries < MAX_TRIES) {
      setTimeout(attempt, INTERVAL_MS)
    } else {
      console.warn('[StyleSnap Demo] Mount point #stylesnap-demo not found after', MAX_TRIES * INTERVAL_MS, 'ms')
    }
  }

  // Also watch for the mount point being added dynamically
  const observer = new MutationObserver(() => {
    const mount = document.getElementById('stylesnap-demo')
    if (mount && !container) {
      console.log('[StyleSnap Demo] Mount point detected via MutationObserver')
      observer.disconnect()
      initDemo(mount)
    }
  })
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true })

  attempt()
}
