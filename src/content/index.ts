/**
 * Content Script
 * Injected into every page. Handles hover detection, CSS extraction,
 * element highlighting, and design token scanning.
 */
import { parseElement, extractComponentCSS, extractComponentHTML } from '@/lib/css-extractor'
import { extractDesignTokens } from '@/lib/token-extractor'
import { collectAnnotatableElements } from '@/lib/annotator'
import type { ParsedCSS } from '@/shared/types'

// ─── State ────────────────────────────────────────────────────────────

let isActive = false
let lastHighlighted: Element | null = null
let lockedElement: Element | null = null
let assistMode = 1 // 0: Off, 1: Guidelines (Crosshairs), 2: Grid (Outlines)
const OVERLAY_ID = 'stylesnap-overlay'
const HIGHLIGHT_CLASS = 'stylesnap-highlight'
const LOCKED_CLASS = 'stylesnap-locked'

function updateAssistModeUI() {
  document.body.classList.remove('stylesnap-mode-guidelines', 'stylesnap-mode-grid')
  if (assistMode === 1) {
    document.body.classList.add('stylesnap-mode-guidelines')
  } else if (assistMode === 2) {
    document.body.classList.add('stylesnap-mode-grid')
  }
}

function initGuides() {
  const ids = ['stylesnap-guide-t', 'stylesnap-guide-b', 'stylesnap-guide-l', 'stylesnap-guide-r']
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
  if (assistMode !== 1) return
  const t = document.getElementById('stylesnap-guide-t')
  const b = document.getElementById('stylesnap-guide-b')
  const l = document.getElementById('stylesnap-guide-l')
  const r = document.getElementById('stylesnap-guide-r')
  if (t && b && l && r) {
    t.style.top = `${rect.top}px`
    b.style.top = `${rect.bottom}px`
    l.style.left = `${rect.left}px`
    r.style.left = `${rect.right}px`
  }
}

// ─── Overlay UI ───────────────────────────────────────────────────────

function getOrCreateOverlay(): HTMLElement {
  let overlay = document.getElementById(OVERLAY_ID)
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = OVERLAY_ID
    overlay.setAttribute('data-stylesnap', 'true')
    
    // Set initial language attribute
    chrome.storage.local.get(['language'], (res) => {
      overlay!.setAttribute('data-lang', res.language || 'en')
    })
    
    document.body.appendChild(overlay)
  }
  return overlay
}

function showOverlay(el: Element, parsedCSS: ParsedCSS) {
  const overlay = getOrCreateOverlay()
  const rect = el.getBoundingClientRect()

  const { styles, tailwindClasses = [], tailwindMatchRate = 0 } = parsedCSS
  const tailwindStr = tailwindClasses.slice(0, 8).join(' ') + (tailwindClasses.length > 8 ? ' …' : '')
  const matchPct = Math.round(tailwindMatchRate * 100)

  const cssPreview = Object.entries(styles)
    .slice(0, 8)
    .map(([k, v]) => `<span class="ss-prop">${k}:</span> <span class="ss-val">${v}</span>`)
    .join('\n')

  overlay.innerHTML = `
    <div class="ss-header">
      <span class="ss-tag">${el.tagName.toLowerCase()}</span>
      <span class="ss-dim">${Math.round(rect.width)}×${Math.round(rect.height)}</span>
      <span class="ss-match">TW ${matchPct}%</span>
    </div>
    ${tailwindStr ? `<div class="ss-tw">${tailwindStr}</div>` : ''}
    <pre class="ss-css">${cssPreview}</pre>
  `

  // Position overlay
  // 先将 display 设为 block 以便获取悬浮框的真实尺寸
  overlay.style.setProperty('display', 'block', 'important')
  const overlayRect = overlay.getBoundingClientRect()
  const overlayWidth = overlayRect.width || 320
  const overlayHeight = overlayRect.height || 150

  // 默认放在元素下方 (使用 fixed 定位，无需 scrollX/Y)
  let top = rect.bottom + 4
  let left = rect.left
  overlay.style.setProperty('transform', 'none', 'important') // 重置 transform

  // 如果下方空间不够，放在元素上方
  if (rect.bottom + overlayHeight + 10 > window.innerHeight) {
    top = rect.top - overlayHeight - 4
    
    // 如果上方空间也不够，就固定在视口底部
    if (top < 0) {
      top = window.innerHeight - overlayHeight - 10
    }
  }

  // 处理水平方向边界
  const maxLeft = window.innerWidth - overlayWidth - 10
  left = Math.max(10, Math.min(left, maxLeft))

  overlay.style.setProperty('top', `${top}px`, 'important')
  overlay.style.setProperty('left', `${left}px`, 'important')
}

function hideOverlay() {
  const overlay = document.getElementById(OVERLAY_ID)
  if (overlay) overlay.style.setProperty('display', 'none', 'important')
}

function highlightElement(el: Element) {
  if (lockedElement && el !== lockedElement) return
  removeHighlight()
  el.classList.add(HIGHLIGHT_CLASS)
  lastHighlighted = el
}

function removeHighlight() {
  if (lastHighlighted && lastHighlighted !== lockedElement) {
    lastHighlighted.classList.remove(HIGHLIGHT_CLASS)
    lastHighlighted = null
  }
}

function lockElement(el: Element) {
  if (lockedElement) {
    lockedElement.classList.remove(LOCKED_CLASS)
  }
  lockedElement = el
  el.classList.add(LOCKED_CLASS)
  el.classList.remove(HIGHLIGHT_CLASS)
  lastHighlighted = null

  const overlay = document.getElementById(OVERLAY_ID)
  if (overlay) {
    overlay.classList.add('ss-interactive')
  }
}

function unlockElement() {
  if (lockedElement) {
    lockedElement.classList.remove(LOCKED_CLASS)
    lockedElement = null
  }
  
  const overlay = document.getElementById(OVERLAY_ID)
  if (overlay) {
    overlay.classList.remove('ss-interactive')
  }
}

// ─── Event handlers ───────────────────────────────────────────────────

function onMouseMove(e: MouseEvent) {
  if (!isActive || lockedElement) return
  const el = document.elementFromPoint(e.clientX, e.clientY)
  if (!el || el.closest('[data-stylesnap]')) return
  if (el === lastHighlighted) return

  highlightElement(el)
  const parsedCSS = parseElement(el)
  showOverlay(el, parsedCSS)
  updateGuides(el.getBoundingClientRect())

  chrome.runtime.sendMessage({
    type: 'ELEMENT_HOVERED',
    payload: {
      parsedCSS,
      tagName: el.tagName.toLowerCase(),
      id: el.id,
      classList: Array.from(el.classList).filter(c => !c.startsWith('stylesnap-')),
      rect: { width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height), top: Math.round(el.getBoundingClientRect().top), left: Math.round(el.getBoundingClientRect().left) },
    },
  }).catch(() => {})
}

function onClick(e: MouseEvent) {
  if (!isActive) return
  const el = document.elementFromPoint(e.clientX, e.clientY)
  
  // 如果点击的是 overlay 内部，不要触发解锁或新元素的锁定
  if (el && el.closest('#' + OVERLAY_ID)) {
    return
  }

  // 如果点击了扩展的 UI（例如右下角的悬浮按钮），直接忽略
  if (el && el.closest('[data-stylesnap]')) {
    return
  }

  e.preventDefault()
  e.stopPropagation()

  // 如果点到了非元素区域 (比如 document 空白)，或者点到了 `<html>`/`<body>`，视为空白处解锁
  if (!el || el === document.documentElement || el === document.body) {
    if (lockedElement) {
      unlockElement()
      chrome.runtime.sendMessage({ type: 'ELEMENT_UNLOCKED' }).catch(() => {})
      hideOverlay()
    }
    return
  }

  // 此时 el 是网页中有效的一个元素
  if (lockedElement) {
    // 无论点击的是已锁定的元素本身，还是其他有效元素，
    // 都认为用户的意图是“取消当前的锁定状态”
    unlockElement()
    chrome.runtime.sendMessage({ type: 'ELEMENT_UNLOCKED' }).catch(() => {})
    // 手动触发一次 hover 以更新高亮和信息框
    onMouseMove(e)
    return
  }

  // 当前没有锁定任何元素，正常执行锁定
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
  // Ignore if typing in an input
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable) {
    return
  }

  if (isActive && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault()
    e.stopPropagation()
    assistMode = (assistMode + 1) % 3
    updateAssistModeUI()
    
    // Save to settings
    chrome.storage.local.get(['stylesnap_settings'], (res) => {
      const s = res.stylesnap_settings || {}
      s.assistMode = assistMode
      chrome.storage.local.set({ stylesnap_settings: s })
    })
    
    // Show a quick toast
    const modeNames = ['Assist: OFF', 'Assist: Guidelines', 'Assist: Grid']
    showToast(modeNames[assistMode])

    const target = lockedElement || lastHighlighted
    if (target) {
      updateGuides(target.getBoundingClientRect())
    }
    return
  }

  if (e.key === 'Escape' && isActive) {
    e.preventDefault()
    e.stopPropagation()
    
    if (lockedElement) {
      // 第一次按 ESC 解除锁定
      unlockElement()
      chrome.runtime.sendMessage({ type: 'ELEMENT_UNLOCKED' }).catch(() => {})
      hideOverlay()
    } else {
      // 第二次按 ESC 退出审查模式
      disableInspector()
      chrome.runtime.sendMessage({ type: 'DISABLE_INSPECTOR' }).catch(() => {})
    }
  }
}

// ─── Toast Notification ────────────────────────────────────────────────

let toastTimeout: number | null = null
function showToast(message: string) {
  let toast = document.getElementById('stylesnap-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'stylesnap-toast'
    toast.setAttribute('data-stylesnap', 'true')
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '80px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(15, 23, 42, 0.9)',
      color: '#fff',
      padding: '8px 16px',
      borderRadius: '8px',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      fontWeight: '500',
      zIndex: '2147483647',
      pointerEvents: 'none',
      transition: 'opacity 0.2s ease',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      border: '1px solid rgba(255,255,255,0.1)'
    })
    document.body.appendChild(toast)
  }
  
  toast.textContent = message
  toast.style.opacity = '1'
  
  if (toastTimeout) window.clearTimeout(toastTimeout)
  toastTimeout = window.setTimeout(() => {
    if (toast) toast.style.opacity = '0'
  }, 2000)
}

function onScroll() {
  if (!isActive) return
  const target = lockedElement || lastHighlighted
  if (target) {
    updateGuides(target.getBoundingClientRect())
  }
}

// ─── Inspector control ────────────────────────────────────────────────

function enableInspector() {
  if (isActive) return
  isActive = true
  initGuides()
  
  // Load assistMode from settings
  chrome.storage.local.get(['stylesnap_settings'], (res) => {
    if (res.stylesnap_settings && res.stylesnap_settings.assistMode !== undefined) {
      assistMode = res.stylesnap_settings.assistMode
    } else {
      assistMode = 1 // default
    }
    updateAssistModeUI()
  })

  document.addEventListener('mousemove', onMouseMove, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('scroll', onScroll, true)

  const btn = document.getElementById(FLOATING_BTN_ID)
  if (btn) {
    btn.classList.add('is-active')
  }
}

function disableInspector() {
  isActive = false
  assistMode = 0
  updateAssistModeUI()
  document.removeEventListener('mousemove', onMouseMove, true)
  document.removeEventListener('click', onClick, true)
  document.removeEventListener('keydown', onKeyDown, true)
  document.removeEventListener('scroll', onScroll, true)
  unlockElement()
  removeHighlight()
  hideOverlay()

  const btn = document.getElementById(FLOATING_BTN_ID)
  if (btn) {
    btn.classList.remove('is-active')
  }
}

// ─── Floating Button UI ────────────────────────────────────────────────

const FLOATING_BTN_ID = 'stylesnap-floating-btn'

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
      border-radius: 50% !important; /* 关键修复：确保容器本身是正圆形，裁剪超出部分的流光 */
      cursor: pointer !important;
      z-index: 2147483647 !important;
      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s, opacity 0.3s ease !important;
      user-select: none !important;
      border: none !important;
      outline: none !important;
      background: transparent !important;
      overflow: visible !important;
      display: flex !important;
      align-items: center !important;
      box-sizing: border-box !important;
      width: 40px !important;
      height: 40px !important;
      opacity: 0.4 !important; /* 默认半透明以防遮挡 */
    }
    #stylesnap-floating-btn:hover,
    #stylesnap-floating-btn.is-active,
    #stylesnap-floating-btn.is-dragging {
      opacity: 1 !important; /* 交互时恢复不透明 */
    }
    #stylesnap-floating-btn-inner {
      position: relative !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 40px !important;
      height: 40px !important;
      background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
      border-radius: 50% !important;
      z-index: 2 !important;
      box-sizing: border-box !important;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4) !important;
      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s !important;
    }
    #stylesnap-floating-btn:hover #stylesnap-floating-btn-inner,
    #stylesnap-floating-btn.is-dragging #stylesnap-floating-btn-inner {
      transform: scale(1.05) translateY(-2px) !important;
    }
    #stylesnap-floating-btn.is-active #stylesnap-floating-btn-inner {
      background: linear-gradient(135deg, #10b981, #059669) !important;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4) !important;
    }
    /* 流光外壳包裹层，用于裁剪溢出 */
    #stylesnap-floating-btn-ring {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: 100% !important;
      border-radius: 50% !important;
      overflow: hidden !important;
      z-index: 1 !important;
      pointer-events: none !important;
    }

    #stylesnap-floating-btn-ring::before {
      content: '' !important;
      position: absolute !important;
      top: 50% !important;
      left: 50% !important;
      width: 140% !important;
      height: 140% !important;
      background: conic-gradient(transparent, #6ee7b7, transparent 30%) !important;
      transform-origin: center center !important;
      animation: stylesnap-btn-rotate 2s linear infinite !important;
      display: none !important;
    }
    #stylesnap-floating-btn.is-active #stylesnap-floating-btn-ring::before {
      display: block !important;
    }
    /* 悬浮面板 */
    #stylesnap-floating-panel {
      position: absolute !important;
      right: 48px !important; /* 在按钮左侧展开 */
      top: 50% !important;
      transform: translateY(-50%) scale(0.9) !important;
      transform-origin: right center !important;
      background: #1e293b !important;
      border: 1px solid rgba(255,255,255,0.1) !important;
      border-radius: 12px !important;
      padding: 6px !important;
      display: flex !important;
      gap: 4px !important;
      opacity: 0 !important;
      visibility: hidden !important;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.1) !important;
      z-index: 1 !important;
      pointer-events: none !important;
    }
    
    /* 
      关键修复：增加一个不可见的“桥梁”区域 
      防止鼠标从按钮移动到面板时，因为存在缝隙导致 hover 状态丢失 
    */
    #stylesnap-floating-panel::after {
      content: '' !important;
      position: absolute !important;
      right: -10px !important; /* 填补 right: 48px 产生的空隙 */
      top: 0 !important;
      bottom: 0 !important;
      width: 20px !important;
      background: transparent !important;
    }

    #stylesnap-floating-btn:hover #stylesnap-floating-panel,
    #stylesnap-floating-panel:hover {
      opacity: 1 !important;
      visibility: visible !important;
      transform: translateY(-50%) scale(1) !important;
      pointer-events: auto !important;
    }
    .stylesnap-panel-item {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 32px !important;
      height: 32px !important;
      border-radius: 8px !important;
      background: transparent !important;
      color: #94a3b8 !important;
      border: none !important;
      cursor: pointer !important;
      transition: all 0.15s !important;
    }
    .stylesnap-panel-item:hover {
      background: rgba(255,255,255,0.1) !important;
      color: #fff !important;
    }
    .stylesnap-panel-item svg {
      width: 16px !important;
      height: 16px !important;
    }
    
    @keyframes stylesnap-btn-rotate {
      0% { transform: translate(-50%, -50%) rotate(0deg); }
      100% { transform: translate(-50%, -50%) rotate(360deg); }
    }
    .stylesnap-logo-icon {
      width: 24px !important;
      height: 24px !important;
      background: #fff !important;
      color: #6366f1 !important;
      border-radius: 8px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 16px !important;
      font-weight: 900 !important;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important;
      font-family: ui-sans-serif, system-ui, sans-serif !important;
      box-sizing: border-box !important;
      transition: color 0.2s, transform 0.2s !important;
    }
    #stylesnap-floating-btn.is-active .stylesnap-logo-icon {
      color: #10b981 !important;
    }
    #stylesnap-floating-btn:active .stylesnap-logo-icon {
      transform: scale(0.9) !important;
    }
  `
  document.head.appendChild(style)
}

function initFloatingButton() {
  chrome.storage.local.get(['stylesnap_settings'], (res) => {
    const s = res.stylesnap_settings || {}
    if (s.showFloatingBtn === false) {
      const existing = document.getElementById(FLOATING_BTN_ID)
      if (existing) existing.remove()
      return
    }

    if (document.getElementById(FLOATING_BTN_ID)) return

    injectFloatingBtnStyles()

    const btn = document.createElement('button')
    btn.id = FLOATING_BTN_ID
    btn.setAttribute('data-stylesnap', 'true')
    btn.title = 'StyleSnap\nLeft Click: Toggle Inspect\nRight Click: Open Panel\nDrag: Move Button' // 鼠标悬停提示
    
    btn.innerHTML = `
      <div id="stylesnap-floating-btn-ring"></div>
      <div id="stylesnap-floating-btn-inner">
        <div class="stylesnap-logo-icon">S</div>
      </div>
      <div id="stylesnap-floating-panel">
        <button class="stylesnap-panel-item" id="stylesnap-action-inspect" title="Inspect Element">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 3h18v18H3zM12 8v8M8 12h8"/>
          </svg>
        </button>
        <button class="stylesnap-panel-item" id="stylesnap-action-panel" title="Open Side Panel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
        </button>
      </div>
    `

    // ─── Drag and Drop Logic ───
    let isDragging = false
    let hasMoved = false
    let startX = 0
    let startY = 0
    let initialRight = 24
    let initialBottom = 24

    // Load saved position
    chrome.storage.local.get(['stylesnap_btn_pos'], (res) => {
      if (res.stylesnap_btn_pos) {
        btn.style.setProperty('right', `${res.stylesnap_btn_pos.right}px`, 'important')
        btn.style.setProperty('bottom', `${res.stylesnap_btn_pos.bottom}px`, 'important')
      }
    })

    btn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return // Only left click
      isDragging = true
      hasMoved = false
      startX = e.clientX
      startY = e.clientY
      
      // Get current computed style
      const rect = btn.getBoundingClientRect()
      initialRight = window.innerWidth - rect.right
      initialBottom = window.innerHeight - rect.bottom
      
      // Add grabbing style
      btn.classList.add('is-dragging')
      btn.style.setProperty('cursor', 'grabbing', 'important')
      btn.style.setProperty('transition', 'none', 'important') // Disable transition during drag
      
      e.preventDefault() // Prevent text selection
    })

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return
      
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      
      // Consider it a drag only if moved more than 3px
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMoved = true
      }
      
      if (hasMoved) {
        let newRight = initialRight - dx
        let newBottom = initialBottom - dy
        
        // Boundaries
        const padding = 10
        const btnSize = 40
        newRight = Math.max(padding, Math.min(newRight, window.innerWidth - btnSize - padding))
        newBottom = Math.max(padding, Math.min(newBottom, window.innerHeight - btnSize - padding))
        
        btn.style.setProperty('right', `${newRight}px`, 'important')
        btn.style.setProperty('bottom', `${newBottom}px`, 'important')
      }
    })

    window.addEventListener('mouseup', () => {
      if (!isDragging) return
      isDragging = false
      
      // Restore styles
      btn.classList.remove('is-dragging')
      btn.style.setProperty('cursor', 'pointer', 'important')
      btn.style.setProperty('transition', 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s, opacity 0.3s ease', 'important')
      
      if (hasMoved) {
        // Save new position
        const rect = btn.getBoundingClientRect()
        chrome.storage.local.set({
          stylesnap_btn_pos: {
            right: window.innerWidth - rect.right,
            bottom: window.innerHeight - rect.bottom
          }
        })
      }
    })

    // ─── Click & Context Menu Logic ───
    const btnInner = btn.querySelector('#stylesnap-floating-btn-inner')
    const actionInspect = btn.querySelector('#stylesnap-action-inspect')
    const actionPanel = btn.querySelector('#stylesnap-action-panel')

    btnInner?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      
      if (hasMoved) return
      
      // Default action: toggle inspector
      if (isActive) {
        disableInspector()
        chrome.runtime.sendMessage({ type: 'DISABLE_INSPECTOR' }).catch(() => {})
      } else {
        enableInspector()
        chrome.runtime.sendMessage({ type: 'INIT_INSPECTOR' }).catch(() => {})
      }
    })

    actionInspect?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (isActive) {
        disableInspector()
        chrome.runtime.sendMessage({ type: 'DISABLE_INSPECTOR' }).catch(() => {})
      } else {
        enableInspector()
        chrome.runtime.sendMessage({ type: 'INIT_INSPECTOR' }).catch(() => {})
      }
    })

    actionPanel?.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }).catch(() => {})
    })

    document.body.appendChild(btn)
  })
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFloatingButton)
} else {
  initFloatingButton()
}

// ─── Message handling ─────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.language) {
      const lang = changes.language.newValue
      // Update overlay language
      const overlay = document.getElementById(OVERLAY_ID)
      if (overlay) {
        overlay.setAttribute('data-lang', lang || 'en')
      }
    }
    
    if (changes.stylesnap_settings) {
      const newSettings = changes.stylesnap_settings.newValue
      if (newSettings) {
        if (newSettings.assistMode !== undefined) {
          assistMode = newSettings.assistMode
          updateAssistModeUI()
        }
        
        // Handle floating button visibility toggle
        if (newSettings.showFloatingBtn !== undefined) {
          const btn = document.getElementById(FLOATING_BTN_ID)
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
      enableInspector()
      sendResponse({ ok: true })
      break

    case 'DISABLE_INSPECTOR':
      disableInspector()
      sendResponse({ ok: true })
      break

    case 'EDIT_CSS': {
      const { selector, property, value } = message.payload as { selector: string; property: string; value: string }
      const targets = document.querySelectorAll(selector)
      targets.forEach(el => {
        (el as HTMLElement).style.setProperty(property, value)
      })
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

    case 'COLLECT_ELEMENTS': {
      try {
        const elements = collectAnnotatableElements()
        sendResponse({ elements })
      } catch (e: unknown) {
        sendResponse({ error: (e as Error).message })
      }
      break
    }

    default:
      sendResponse({ error: 'Unknown message type' })
  }
  return true // keep channel open for async responses
})
