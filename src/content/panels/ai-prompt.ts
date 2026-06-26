/** AI prompt generator — builds a paste-ready prompt from the locked element. */
import { $$, stAppend, showToast, classNameOf } from '../ui'
import { S, LOCKED_CLASS } from '../state'
import { mapCSSToTailwind } from '../tailwind'

export function extractARIA(el: Element, depth = 0): string {
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

export function extractDOMSummary(el: Element, depth = 0): string {
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

export function extractAnimations(el: Element): string {
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

export function showAIPrompt() {
  if (!S.lockedElement) { showToast('Lock an element first'); return }

  const el = S.lockedElement as HTMLElement
  el.classList.remove(LOCKED_CLASS)
  const styles = window.getComputedStyle(el)
  el.classList.add(LOCKED_CLASS)

  const tw = mapCSSToTailwind(styles)
  const dom = extractDOMSummary(el)
  const aria = extractARIA(el)
  const anim = extractAnimations(el)
  const tagName = el.tagName.toLowerCase()
  const twClassStr = tw.join(' ')
  const cssProps = S.lastParsedCSS?.styles
    ? Object.entries(S.lastParsedCSS.styles).slice(0, 30).map(([k, v]) => `  ${k}: ${v};`).join('\n')
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

