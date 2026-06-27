/**
 * UI foundation layer — zero app state.
 * Shadow-DOM host, element lookup, leak-proof outside-close, HTML/DOM helpers,
 * shared icons, toast, and the h() DOM builder. Imported by every UI module.
 */
import { SHADOW_FLOATING_BTN_CSS, SHADOW_HINT_BAR_CSS } from './shadow-styles'
import OVERLAY_CSS from './overlay.css?inline'

const SHADOW_HOST_ID = 'stylesnap-root'

// ─── Shadow DOM isolation (prevents page CSS from polluting extension UI) ───
let _stShadow: ShadowRoot | null = null
export function getStShadow(): ShadowRoot {
  if (_stShadow) return _stShadow
  const host = document.createElement('div')
  host.id = SHADOW_HOST_ID
  host.setAttribute('data-stylesnap', 'true')
  // Use !important so aggressive host-page CSS (e.g. `div { position: relative
  // !important; width: 100% }`) can't force our 0×0 host into normal flow and
  // add page scrollbars.
  const hostCss: Record<string, string> = {
    position: 'fixed', top: '0', left: '0', width: '0', height: '0',
    margin: '0', padding: '0', border: '0', 'z-index': '9999990', overflow: 'visible',
  }
  for (const [k, v] of Object.entries(hostCss)) host.style.setProperty(k, v, 'important')
  document.body.appendChild(host)
  _stShadow = host.attachShadow({ mode: 'open' })
  const fbStyle = document.createElement('style')
  fbStyle.textContent = SHADOW_FLOATING_BTN_CSS + '\n' + SHADOW_HINT_BAR_CSS + '\n' + OVERLAY_CSS + '\n' +
    '@keyframes ss-bubble-pulse { 0%, 100% { transform: translateY(0); box-shadow: 0 4px 16px rgba(99,102,241,0.5); } 50% { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(99,102,241,0.7); } }'
  _stShadow.appendChild(fbStyle)
  return _stShadow
}
export function stAppend(el: HTMLElement) { getStShadow().appendChild(el) }
export function $$(id: string): HTMLElement | null {
  return (_stShadow ? _stShadow.getElementById(id) : null) || document.getElementById(id)
}

/**
 * Attach "click-outside (and optional Esc) to close" to a shadow-DOM panel,
 * with leak-proof cleanup: a MutationObserver tears down the document-level
 * listeners whenever the panel leaves the DOM — regardless of which path
 * removed it (close button, item click, mutual-exclusion, programmatic remove).
 * Uses composedPath() so clicks inside the shadow tree are correctly detected.
 * Returns a close() that removes the panel and runs onClose.
 */
export function attachOutsideClose(
  panel: HTMLElement,
  opts: { onClose?: () => void; esc?: boolean; delay?: number } = {},
): () => void {
  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    document.removeEventListener('click', onClick)
    if (opts.esc) document.removeEventListener('keydown', onKey)
    obs.disconnect()
  }
  const close = () => {
    cleanup()
    if (panel.isConnected) panel.remove()
    opts.onClose?.()
  }
  const onClick = (ev: MouseEvent) => { if (!ev.composedPath().includes(panel)) close() }
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); close() } }
  const root = panel.getRootNode() as ShadowRoot | Document
  const obs = new MutationObserver(() => { if (!panel.isConnected) cleanup() })
  obs.observe(root, { childList: true, subtree: true })
  setTimeout(() => {
    if (done) return
    document.addEventListener('click', onClick)
    if (opts.esc) document.addEventListener('keydown', onKey)
  }, opts.delay ?? 100)
  return close
}

// ─── HTML / value helpers ─────────────────────────────────────────────
export function isColorValue(val: string): boolean {
  if (!val) return false
  const v = val.trim().toLowerCase()
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return true
  if (/^rgb\(/.test(v) || /^rgba\(/.test(v)) return true
  if (/^hsl\(/.test(v) || /^hsla\(/.test(v)) return true
  const namedColors = ['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert']
  if (namedColors.includes(v)) return false
  if (CSS.supports('color', v)) return true
  return false
}

/** HTML-escape user-supplied values to prevent XSS when injecting into innerHTML */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Safe className accessor — SVG elements expose SVGAnimatedString (no .split/.replace) */
export function classNameOf(el: Element): string {
  const cn = (el as HTMLElement).className
  return typeof cn === 'string' ? cn : (el.getAttribute('class') || '')
}

/** Color preview block HTML */
export function colorBlock(val: string): string {
  const safe = val.replace(/"/g, '').replace(/[<>]/g, '')
  return `<span class="ss-color-block" style="background:${safe}"></span> `
}

// ─── Shared icons ─────────────────────────────────────────────────────
/** Shared SVG attribute string — all Lucide-line icons use this */
export const SVG = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"'
/** Shared close (X) icon, 14×14 */
export const CLOSE_X = `<svg ${SVG} width="14" height="14"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`

// ─── Toast ────────────────────────────────────────────────────────────
let toastTimeout: number | null = null
export function showToast(message: string) { showToastImpl(message, 2000) }
export function showToastImpl(message: string, duration: number) {
  let toast = $$('stylesnap-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'stylesnap-toast'
    toast.setAttribute('data-stylesnap', 'true')
    Object.assign(toast.style, {
      position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(15, 23, 42, 0.9)', color: '#fff', padding: '8px 16px',
      borderRadius: '8px', fontFamily: 'system-ui, sans-serif', fontSize: '13px',
      fontWeight: '500', zIndex: '999993', pointerEvents: 'none',
      transition: 'opacity 0.2s ease', boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      border: '1px solid rgba(255,255,255,0.1)',
    })
    stAppend(toast)
  }
  toast.textContent = message
  toast.style.opacity = '1'
  if (toastTimeout) window.clearTimeout(toastTimeout)
  if (duration > 0) {
    toastTimeout = window.setTimeout(() => { if (toast) toast.style.opacity = '0' }, duration)
  }
}

// ─── h(): tiny DOM builder ────────────────────────────────────────────
type HChild = Node | string | number | false | null | undefined
type HProps = Record<string, unknown>
/**
 * Build a real DOM node. Events bind at creation (no string→querySelector
 * two-step). `style`/`dataset` accept objects; `html` is a trusted-SVG escape
 * hatch; everything else becomes an attribute. Falsy children are skipped.
 */
export function h(tag: string, props: HProps = {}, ...children: HChild[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v as object)
    else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v as object)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    else if (k === 'className') el.className = String(v)
    else if (k === 'html') el.innerHTML = String(v)
    else el.setAttribute(k, String(v))
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue
    el.appendChild(typeof c === 'object' ? (c as Node) : document.createTextNode(String(c)))
  }
  return el
}

/** Close all hint-bar popups except the one with the given id (mutual exclusion). */
export function closeHintPopups(exceptId?: string) {
  ['stylesnap-design-popup', 'stylesnap-history-popup', 'stylesnap-settings-popup'].forEach(id => {
    if (id !== exceptId) $$(id)?.remove()
  })
}
