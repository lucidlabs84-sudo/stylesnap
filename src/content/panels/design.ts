/** Design popup — page Colors + Fonts tabs. */
import { $$, stAppend, attachOutsideClose, showToast, CLOSE_X, closeHintPopups } from '../ui'


export function showDesignPopup(initialTab: 'colors' | 'fonts' = 'colors') {
  // Toggle: if already open, close it
  const existing = $$('stylesnap-design-popup')
  if (existing) { existing.remove(); return }
  // Close other hint popups (mutually exclusive)
  closeHintPopups('stylesnap-design-popup')

  const popup = document.createElement('div')
  popup.id = 'stylesnap-design-popup'
  popup.setAttribute('data-stylesnap', 'true')
  Object.assign(popup.style, {
    position: 'fixed',
    zIndex: '999994',
    background: 'var(--ss-bg-panel)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '10px',
    width: '300px',
    maxHeight: '480px',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    fontFamily: 'system-ui, sans-serif',
    color: '#e2e8f0',
    fontSize: '12px',
  })

  const chipGroupStyle = 'display:inline-flex;gap:2px;background:rgba(255,255,255,0.06);border-radius:6px;padding:2px;'
  const tabBtn = (tab: string, label: string, active: boolean) =>
    `<button class="ss-dpop-tab" data-tab="${tab}" style="background:${active ? 'rgba(99,102,241,0.25)' : 'none'};border:none;color:${active ? '#e2e8f0' : '#64748b'};padding:4px 12px;border-radius:4px;font-size:11px;cursor:pointer;font-family:system-ui,sans-serif;">${label}</button>`

  popup.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px 8px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="${chipGroupStyle}">
        ${tabBtn('colors', 'Colors', initialTab === 'colors')}
        ${tabBtn('fonts', 'Fonts', initialTab === 'fonts')}
      </div>
      <button id="ss-design-close" style="background:none;border:none;color:#64748b;cursor:pointer;padding:2px 4px;border-radius:4px;display:flex;">${CLOSE_X}</button>
    </div>
    <div id="ss-dpop-colors" style="display:${initialTab === 'colors' ? 'flex' : 'none'};flex-direction:column;flex:1;min-height:0;">
      <div style="flex:1;overflow-y:auto;padding:10px 12px 6px;" class="ss-hint-scroll">
        <div style="padding:16px;text-align:center;color:#94a3b8;font-size:11px;">Extracting colors…</div>
      </div>
      <div id="ss-dpop-color-actions" style="display:none;flex-shrink:0;padding:8px 12px;border-top:1px solid rgba(255,255,255,0.06);">
        <div style="display:flex;gap:6px;">
          <button id="ss-pal-copy-vars" style="flex:1;background:var(--ss-primary-bg);border:1px solid rgba(99,102,241,0.3);color:var(--ss-primary-lighter);border-radius:4px;padding:5px 6px;font-size:10px;cursor:pointer;">Copy CSS Vars</button>
          <button id="ss-pal-copy-json" style="flex:1;background:var(--ss-primary-bg);border:1px solid rgba(99,102,241,0.3);color:var(--ss-primary-lighter);border-radius:4px;padding:5px 6px;font-size:10px;cursor:pointer;">Copy JSON</button>
        </div>
      </div>
    </div>
    <div id="ss-dpop-fonts" style="display:${initialTab === 'fonts' ? 'flex' : 'none'};flex-direction:column;flex:1;min-height:0;">
      <div style="flex:1;overflow-y:auto;padding:10px 12px;" class="ss-hint-scroll">
        <div style="padding:16px;text-align:center;color:#94a3b8;font-size:11px;">Scanning fonts…</div>
      </div>
    </div>
  `
  stAppend(popup)

  // Position: centered below hint bar
  const hint = $$('stylesnap-hint-bar')
  const pw = 300
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

  // Tab switching — stopPropagation to prevent triggering closeOnOutside
  popup.querySelectorAll('.ss-dpop-tab').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      const tab = (btn as HTMLElement).dataset.tab as 'colors' | 'fonts'
      popup.querySelectorAll('.ss-dpop-tab').forEach(b => {
        ;(b as HTMLElement).style.background = b === btn ? 'rgba(99,102,241,0.25)' : 'none'
        ;(b as HTMLElement).style.color = b === btn ? '#e2e8f0' : '#64748b'
      })
      ;(popup.querySelector('#ss-dpop-colors') as HTMLElement).style.display = tab === 'colors' ? 'flex' : 'none'
      ;(popup.querySelector('#ss-dpop-fonts') as HTMLElement).style.display = tab === 'fonts' ? 'flex' : 'none'
    })
  })

  // Click outside to close — leak-proof, auto-cleans on any removal path
  attachOutsideClose(popup, { delay: 300 })

  // ── Colors tab ──────────────────────────────────────────────────────
  setTimeout(() => {
    try {
      // Collect colors directly via getComputedStyle — more reliable than extractDesignTokens
      const colorMap = new Map<string, string>() // hex → original rgb string
      const colorProps = ['color','background-color','border-top-color','border-bottom-color','border-left-color','border-right-color','outline-color','fill','stroke']
      document.querySelectorAll('*').forEach(node => {
        if ((node as HTMLElement).dataset?.stylesnap) return
        if ((node as Element).id?.startsWith('stylesnap-')) return
        const cs = window.getComputedStyle(node as HTMLElement)
        colorProps.forEach(p => {
          const v = cs.getPropertyValue(p)
          if (!v || v === 'rgba(0, 0, 0, 0)' || v === 'transparent') return
          const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
          if (!m) return
          const hex = '#' + [m[1],m[2],m[3]].map(x => parseInt(x).toString(16).padStart(2,'0')).join('')
          if (!colorMap.has(hex)) colorMap.set(hex, v)
        })
      })
      // Build simple color list
      const colors = Array.from(colorMap.entries()).map(([hex, rgb]) => ({
        value: hex, role: 'other' as const, rgb
      }))
      const colorsPanel = popup.querySelector('#ss-dpop-colors') as HTMLElement

      const scrollEl = colorsPanel.querySelector('.ss-hint-scroll') as HTMLElement
      const actionsEl = popup.querySelector('#ss-dpop-color-actions') as HTMLElement
      if (colors.length === 0) {
        scrollEl.innerHTML = `<div style="padding:16px;text-align:center;color:#94a3b8;font-size:11px;">No colors found</div>`
      } else {
        let paletteFmt = 'hex'
        const hexToRgb = (hex: string) => {
          const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
          return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] as [number,number,number] : null
        }
        const fmtColor = (hex: string, fmt: string) => {
          if (fmt === 'hex') return hex
          const rgb = hexToRgb(hex)
          if (!rgb) return hex
          const [r,g,b] = rgb
          if (fmt === 'rgb') return `rgb(${r}, ${g}, ${b})`
          const rf=r/255,gf=g/255,bf=b/255,max=Math.max(rf,gf,bf),min=Math.min(rf,gf,bf),l=(max+min)/2
          let h=0,s=0
          if(max!==min){const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);if(max===rf)h=((gf-bf)/d+(gf<bf?6:0))/6;else if(max===gf)h=((bf-rf)/d+2)/6;else h=((rf-gf)/d+4)/6}
          return `hsl(${Math.round(h*360)},${Math.round(s*100)}%,${Math.round(l*100)}%)`
        }
        const renderGrid = () => colors.map(c => {
          const display = fmtColor(c.value, paletteFmt)
          return `<div class="ss-design-swatch" data-hex="${c.value}" data-display="${display}" title="${display}" style="cursor:pointer;text-align:center;"><div style="width:100%;aspect-ratio:1;border-radius:6px;background:${c.value};border:1px solid rgba(255,255,255,0.1);"></div><div style="font-size:9px;color:#94a3b8;margin-top:2px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${display}</div></div>`
        }).join('')

        scrollEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:4px;margin-bottom:8px;">
            <span style="font-size:10px;color:#64748b;">${colors.length} colors</span>
            <div style="display:flex;gap:2px;background:rgba(255,255,255,0.05);border-radius:6px;padding:2px;margin-left:auto;">
              ${['hex','rgb','hsl'].map(f => `<button class="ss-pal-fmt" data-fmt="${f}" style="background:${f==='hex'?'rgba(99,102,241,0.25)':'none'};color:${f==='hex'?'#e2e8f0':'#94a3b8'};border:none;border-radius:4px;padding:2px 6px;font-size:10px;font-family:monospace;cursor:pointer;">${f.toUpperCase()}</button>`).join('')}
            </div>
          </div>
          <div id="ss-pal-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(52px,1fr));gap:6px;">${renderGrid()}</div>
        `
        actionsEl.style.display = 'block'

        const attachSwatchHandlers = () => {
          scrollEl.querySelectorAll('.ss-design-swatch').forEach(sw => {
            sw.addEventListener('click', () => {
              const text = (sw as HTMLElement).dataset.display || (sw as HTMLElement).dataset.hex || ''
              navigator.clipboard.writeText(text).then(() => showToast(`Copied ${text}`)).catch(() => {})
            })
          })
        }
        attachSwatchHandlers()
        scrollEl.querySelectorAll('.ss-pal-fmt').forEach(btn => {
          btn.addEventListener('click', () => {
            paletteFmt = (btn as HTMLElement).dataset.fmt || 'hex'
            scrollEl.querySelectorAll('.ss-pal-fmt').forEach(b => {
              ;(b as HTMLElement).style.background = b === btn ? 'rgba(99,102,241,0.25)' : 'none'
              ;(b as HTMLElement).style.color = b === btn ? '#e2e8f0' : '#94a3b8'
            })
            const grid = scrollEl.querySelector('#ss-pal-grid')
            if (grid) { grid.innerHTML = renderGrid(); attachSwatchHandlers() }
          })
        })
        popup.querySelector('#ss-pal-copy-vars')?.addEventListener('click', () => {
          const vars = colors.map((c,i) => `  --color-${i+1}: ${c.value};`).join('\n')
          navigator.clipboard.writeText(`:root {\n${vars}\n}`).then(() => showToast('Copied CSS variables')).catch(() => {})
        })
        popup.querySelector('#ss-pal-copy-json')?.addEventListener('click', () => {
          navigator.clipboard.writeText(JSON.stringify({colors: colors.map(c => c.value)},null,2)).then(() => showToast('Copied JSON')).catch(() => {})
        })
      }
    } catch { (popup.querySelector('#ss-dpop-colors .ss-hint-scroll') as HTMLElement).innerHTML = `<div style="padding:16px;text-align:center;color:#f87171;">Extraction failed</div>` }
  }, 50)

  // ── Fonts tab ───────────────────────────────────────────────────────
  setTimeout(() => {
    try {
      const fontMap = new Map<string, {sizes: Set<string>, weights: Set<string>}>()
      document.querySelectorAll('*').forEach(node => {
        if ((node as HTMLElement).dataset?.stylesnap) return
        if (node.id?.startsWith('stylesnap-')) return
        const cs = window.getComputedStyle(node as HTMLElement)
        const ff = cs.fontFamily.split(',')[0].replace(/['"]/g,'').trim()
        if (!ff) return
        if (!fontMap.has(ff)) fontMap.set(ff, {sizes: new Set(), weights: new Set()})
        const entry = fontMap.get(ff)!
        entry.sizes.add(cs.fontSize)
        entry.weights.add(cs.fontWeight)
      })
      const fontsScroll = popup.querySelector('#ss-dpop-fonts .ss-hint-scroll') as HTMLElement
      if (fontMap.size === 0) {
        fontsScroll.innerHTML = `<div style="padding:16px;text-align:center;color:#94a3b8;font-size:11px;">No fonts found</div>`
        return
      }
      const rows = Array.from(fontMap.entries()).map(([family, data]) => {
        const sizes = Array.from(data.sizes).sort((a,b) => parseFloat(a)-parseFloat(b)).slice(0,6).join(', ')
        const weights = Array.from(data.weights).sort((a,b) => +a - +b).join(', ')
        return `<div style="margin-bottom:10px;padding:8px;background:rgba(255,255,255,0.04);border-radius:6px;border:1px solid rgba(255,255,255,0.06);">
          <div style="font-weight:600;font-size:12px;color:#e2e8f0;margin-bottom:4px;">${family}</div>
          <div style="font-size:10px;color:#94a3b8;">Sizes: ${sizes}</div>
          <div style="font-size:10px;color:#94a3b8;">Weights: ${weights}</div>
          <div style="margin-top:4px;font-family:${family};font-size:13px;color:#cbd5e1;">The quick brown fox</div>
        </div>`
      }).join('')
      fontsScroll.innerHTML = `<div style="font-size:10px;color:#64748b;margin-bottom:8px;">${fontMap.size} font families</div>${rows}`
    } catch { /* noop */ }
  }, 80)
}


