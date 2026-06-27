/**
 * CSS Extractor
 * Reads computed styles from DOM elements and cleans browser noise
 * Now supports hybrid extraction: stylesheet parsing + computed styles fallback
 */
import { CSSPropertyMap, ParsedCSS } from '@/shared/types'
import { CSS_KEY_PROPERTIES, CSS_PROPERTIES_TO_SKIP } from '@/shared/constants'
import { cssToTailwind } from './tailwind-mapper'
import { parseCSSRules, mergeRules, groupMediaRules, groupPseudoClassRules } from './css-rule-parser'

// Browser default values that are meaningless to show
const BROWSER_DEFAULTS: CSSPropertyMap = {
  display: 'inline',
  position: 'static',
  'z-index': 'auto',
  opacity: '1',
  visibility: 'visible',
  overflow: 'visible',
  'overflow-x': 'visible',
  'overflow-y': 'visible',
  cursor: 'auto',
  float: 'none',
  clear: 'none',
  'text-align': 'start',
  'text-decoration': 'none solid rgb(0, 0, 0)',
  'text-transform': 'none',
  'font-style': 'normal',
  'font-variant': 'normal',
  'white-space': 'normal',
  'word-wrap': 'normal',
  'border-collapse': 'separate',
  'border-spacing': '0px 0px',
  'list-style-type': 'disc',
  'caption-side': 'top',
  'empty-cells': 'show',
  'table-layout': 'auto',
  'background-attachment': 'scroll',
  'background-clip': 'border-box',
  'background-origin': 'padding-box',
  'background-position': '0% 0%',
  'background-repeat': 'repeat',
  'background-size': 'auto',
  'background-color': 'rgba(0, 0, 0, 0)',
  'border-top-color': 'rgb(0, 0, 0)',
  'border-right-color': 'rgb(0, 0, 0)',
  'border-bottom-color': 'rgb(0, 0, 0)',
  'border-left-color': 'rgb(0, 0, 0)',
  'border-top-style': 'none',
  'border-right-style': 'none',
  'border-bottom-style': 'none',
  'border-left-style': 'none',
  'border-top-width': '0px',
  'border-right-width': '0px',
  'border-bottom-width': '0px',
  'border-left-width': '0px',
  'border-top-left-radius': '0px',
  'border-top-right-radius': '0px',
  'border-bottom-left-radius': '0px',
  'border-bottom-right-radius': '0px',
  'outline-color': 'rgb(0, 0, 0)',
  'outline-style': 'none',
  'outline-width': '0px',
  margin: '0px',
  'margin-top': '0px',
  'margin-right': '0px',
  'margin-bottom': '0px',
  'margin-left': '0px',
  padding: '0px',
  'padding-top': '0px',
  'padding-right': '0px',
  'padding-bottom': '0px',
  'padding-left': '0px',
  top: 'auto',
  right: 'auto',
  bottom: 'auto',
  left: 'auto',
  width: 'auto',
  height: 'auto',
  'min-width': '0px',
  'min-height': '0px',
  'max-width': 'none',
  'max-height': 'none',
  flex: '0 1 auto',
  'flex-direction': 'row',
  'flex-wrap': 'nowrap',
  'align-items': 'normal',
  'align-content': 'normal',
  'justify-content': 'normal',
  gap: 'normal',
  'grid-template-columns': 'none',
  'grid-template-rows': 'none',
  'box-shadow': 'none',
  transition: 'all 0s ease 0s',
  transform: 'none',
  animation: 'none 0s ease 0s 1 normal none running',
  'letter-spacing': 'normal',
  'line-height': 'normal',
}

/**
 * Extract computed CSS from an element, filtering browser defaults
 */
export function extractComputedCSS(el: Element): CSSPropertyMap {
  // Temporarily strip StyleSnap's own marker classes so their injected styles
  // (outline / cursor:crosshair / background highlight) don't leak into the
  // captured computed CSS. Synchronous remove→read→restore = no visible flash.
  const stripped = Array.from(el.classList).filter(c => c.startsWith('stylesnap-'))
  if (stripped.length) el.classList.remove(...stripped)
  const computed = window.getComputedStyle(el)
  const result: CSSPropertyMap = {}

  for (const prop of CSS_KEY_PROPERTIES) {
    if (CSS_PROPERTIES_TO_SKIP.has(prop)) continue
    const value = computed.getPropertyValue(prop).trim()
    if (!value) continue
    const defaultVal = BROWSER_DEFAULTS[prop]
    if (defaultVal && value === defaultVal) continue
    result[prop] = value
  }

  if (stripped.length) el.classList.add(...stripped)
  return result
}

/**
 * Get the CSS selector for an element
 */
export function getSelector(el: Element): string {
  if (el.id) return `#${el.id}`

  const classes = Array.from(el.classList)
    .filter(c => !c.startsWith('stylesnap-'))
    .slice(0, 3)

  if (classes.length > 0) {
    return `${el.tagName.toLowerCase()}.${classes.join('.')}`
  }

  // Walk up tree to build nth-child selector
  const parts: string[] = []
  let current: Element | null = el
  let depth = 0

  while (current && depth < 4) {
    const parent: Element | null = current.parentElement
    if (!parent) break

    const siblings = Array.from(parent.children)
    const index = siblings.indexOf(current) + 1
    const tag = current.tagName.toLowerCase()

    if (current.id) {
      parts.unshift(`#${current.id}`)
      break
    }

    const classStr = Array.from(current.classList)
      .filter(c => !c.startsWith('stylesnap-'))
      .slice(0, 2)
      .join('.')

    parts.unshift(classStr ? `${tag}.${classStr}` : `${tag}:nth-child(${index})`)
    current = parent
    depth++
  }

  return parts.join(' > ')
}

/**
 * Format CSS map to a CSS string
 */
export function formatCSS(styles: CSSPropertyMap, selector = ''): string {
  const props = Object.entries(styles)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')

  if (!selector) return props
  return `${selector} {\n${props}\n}`
}

/**
 * Parse an element and return full ParsedCSS
 * Uses hybrid extraction: tries stylesheet parsing first, falls back to computed styles
 */
export function parseElement(el: Element): ParsedCSS {
  // Try using stylesheet parsing
  const rules = parseCSSRules(el)

  let styles: CSSPropertyMap
  let responsiveStyles: Record<string, CSSPropertyMap> | undefined
  let interactionStyles: { hover?: CSSPropertyMap; focus?: CSSPropertyMap; active?: CSSPropertyMap } | undefined
  const warnings: string[] = []

  if (rules.crossOriginWarning) {
    // Fallback: use computed styles
    styles = extractComputedCSS(el)
    warnings.push('Detected cross-origin stylesheets. Some styles may not be fully extracted.')
  } else {
    // Use parsed results
    styles = mergeRules(rules.baseRules)

    // Only use responsive/styles if we got meaningful results
    const mediaGrouped = groupMediaRules(rules.mediaRules)
    if (Object.keys(mediaGrouped).length > 0) {
      responsiveStyles = mediaGrouped
    }

    const pseudoGrouped = groupPseudoClassRules(rules.pseudoClassRules)
    if (pseudoGrouped.hover || pseudoGrouped.focus || pseudoGrouped.active) {
      interactionStyles = pseudoGrouped
    }
  }

  // Ensure we have some styles
  if (Object.keys(styles).length === 0) {
    styles = extractComputedCSS(el)
  }

  // Merge inline styles (user edits via overlay) — inline styles override stylesheet values
  const inline = (el as HTMLElement).style
  if (inline && inline.length > 0) {
    for (let i = 0; i < inline.length; i++) {
      const prop = inline[i]
      const val = inline.getPropertyValue(prop)
      if (val && val !== '') {
        styles[prop] = val
      }
    }
  }

  const selector = getSelector(el)

  // Call cssToTailwind (simplified - no responsive/interaction classes)
  const tailwindResult = cssToTailwind(styles)

  const result: ParsedCSS = {
    selector,
    styles,
    html: el.outerHTML.slice(0, 500),   // light preview
    tailwindClasses: tailwindResult.classes,
    tailwindMatchRate: tailwindResult.matchRate,
  }

  // Add new fields if available
  if (responsiveStyles) {
    result.responsiveStyles = responsiveStyles
  }
  if (interactionStyles) {
    result.interactionStyles = interactionStyles
  }
  if (warnings.length > 0) {
    result.warnings = warnings
  }

  return result
}

/**
 * Extract CSS for a component (element + all descendants)
 */
export function extractComponentCSS(el: Element, maxDepth = 5): string {
  const lines: string[] = []

  function traverse(node: Element, depth: number) {
    if (depth > maxDepth) return
    const styles = extractComputedCSS(node)
    if (Object.keys(styles).length > 0) {
      const sel = getSelector(node)
      lines.push(formatCSS(styles, sel))
    }
    for (const child of Array.from(node.children)) {
      traverse(child, depth + 1)
    }
  }

  traverse(el, 0)
  return lines.join('\n\n')
}

// URL resolution helpers — convert relative paths to absolute
const URL_ATTRS = new Set(['src', 'href', 'srcset', 'poster', 'data-src', 'action', 'data-href'])

function isExternalUrl(val: string): boolean {
  return /^(data:|javascript:|mailto:|tel:|#|https?:\/\/)/.test(val)
}

function resolveUrl(val: string, origin: string): string {
  if (!val || isExternalUrl(val)) return val
  if (val.startsWith('//')) return 'https:' + val
  try { return new URL(val, origin).href } catch { return val }
}

function resolveSrcset(srcset: string, origin: string): string {
  return srcset.split(',').map(part => {
    const trimmed = part.trim()
    const m = trimmed.match(/^(\S+)(\s+.+)?$/)
    if (!m) return trimmed
    return resolveUrl(m[1], origin) + (m[2] || '')
  }).join(', ')
}

function resolveAttrUrl(name: string, value: string): string {
  if (!URL_ATTRS.has(name)) return value
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    if (!base) return value
    return name === 'srcset' ? resolveSrcset(value, base) : resolveUrl(value, base)
  } catch { return value }
}

/**
 * Get simplified HTML of an element (without scripts, with inline classes)
 */
export function extractComponentHTML(el: Element, maxDepth = 5): string {
  function cleanNode(node: Element, depth: number): string {
    if (depth > maxDepth) return ''
    if (node.tagName === 'STYLE' || node.tagName === 'SCRIPT') return '' // skip style/script tags — CSS goes in CSS tab
    if (node.tagName === 'LINK' && node.getAttribute('rel') === 'stylesheet') return '' // skip link stylesheets

    const tag = node.tagName.toLowerCase()
    const id = node.id ? ` id="${node.id}"` : ''
    const classes = Array.from(node.classList)
      .filter(c => !c.startsWith('stylesnap-'))
      .join(' ')
    const classAttr = classes ? ` class="${classes}"` : ''

    // Copy relevant attributes (resolve relative URLs → absolute)
    const attrs: string[] = []
    for (const attr of Array.from(node.attributes)) {
      if (['id', 'class', 'style'].includes(attr.name)) continue
      if (attr.name.startsWith('on')) continue // skip event handlers
      if (attr.name.startsWith('data-stylesnap')) continue
      attrs.push(`${attr.name}="${resolveAttrUrl(attr.name, attr.value)}"`)
    }
    const attrStr = attrs.length ? ' ' + attrs.join(' ') : ''

    const selfClosing = ['img', 'input', 'br', 'hr', 'link', 'meta', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr']
    if (selfClosing.includes(tag)) {
      return `<${tag}${id}${classAttr}${attrStr} />`
    }

    const children = Array.from(node.children)
      .map(child => cleanNode(child, depth + 1))
      .filter(Boolean)
      .join('\n')

    // Collect text nodes (even when mixed with child elements)
    const textNodes = Array.from(node.childNodes)
      .filter(n => n.nodeType === 3) // TEXT_NODE
      .map(n => n.textContent?.trim())
      .filter(Boolean)
      .join(' ')
    const text = textNodes || ''

    const content = children || text
    const indent = '  '.repeat(depth)
    if (children && text) {
      // Mixed: children + inline text (like <a><svg/> text</a>)
      return `${indent}<${tag}${id}${classAttr}${attrStr}>\n${children}\n${text}\n${indent}</${tag}>`
    }

    if (!content) return `${indent}<${tag}${id}${classAttr}${attrStr}></${tag}>`

    return `${indent}<${tag}${id}${classAttr}${attrStr}>\n${content}\n${indent}</${tag}>`
  }

  return cleanNode(el, 0)
}
