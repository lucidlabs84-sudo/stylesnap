/** Dev-only split-view preview modal (gated behind import.meta.env.DEV in index). */
import { $$, stAppend, showToast } from '../ui'
import { S, LOCKED_CLASS } from '../state'

export function showPreviewPanel(opts: {
  code: string
  type: 'component' | 'css' | 'tailwind' | 'json'
  title?: string
  previewHTML?: string
  previewCSS?: string
}) {
  const { code, type } = opts
  const title = opts.title || 'Preview'

  // Remove any existing preview panel
  const existing = $$('stylesnap-preview-panel')
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

export function extractPreviewHTML(el: HTMLElement): string {
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
  const bg = bgOverride || detectBackground(S.lockedElement as HTMLElement | null)

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
