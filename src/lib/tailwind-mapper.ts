/**
 * Tailwind CSS Mapper
 * Deterministically converts CSS property/value pairs to Tailwind utility classes
 * Coverage: ~90% of common patterns. AI fallback handles the rest.
 */
import { CSSPropertyMap } from '@/shared/types'

// ─── Tailwind Color Palette (v3.4) ────────────────────────────────
// Format: { hex: [colorName, shade] }
const TAILWIND_COLORS: Record<string, string> = {
  // slate
  '#f8fafc': 'slate-50', '#f1f5f9': 'slate-100', '#e2e8f0': 'slate-200',
  '#cbd5e1': 'slate-300', '#94a3b8': 'slate-400', '#64748b': 'slate-500',
  '#475569': 'slate-600', '#334155': 'slate-700', '#1e293b': 'slate-800',
  '#0f172a': 'slate-900', '#020617': 'slate-950',
  // gray
  '#f9fafb': 'gray-50', '#f3f4f6': 'gray-100', '#e5e7eb': 'gray-200',
  '#d1d5db': 'gray-300', '#9ca3af': 'gray-400', '#6b7280': 'gray-500',
  '#4b5563': 'gray-600', '#374151': 'gray-700', '#1f2937': 'gray-800',
  '#111827': 'gray-900', '#030712': 'gray-950',
  // zinc
  '#fafafa': 'zinc-50', '#f4f4f5': 'zinc-100', '#e4e4e7': 'zinc-200',
  '#d4d4d8': 'zinc-300', '#a1a1aa': 'zinc-400', '#71717a': 'zinc-500',
  '#52525b': 'zinc-600', '#3f3f46': 'zinc-700', '#27272a': 'zinc-800',
  '#18181b': 'zinc-900',   '#09090b': 'zinc-950',
  // stone
  '#fafaf9': 'stone-50', '#f5f5f4': 'stone-100', '#e7e5e4': 'stone-200',
  '#d6d3d1': 'stone-300', '#a8a29e': 'stone-400', '#78716c': 'stone-500',
  '#57534e': 'stone-600', '#44403c': 'stone-700', '#292524': 'stone-800',
  '#1c1917': 'stone-900', '#0c0a09': 'stone-950',
  // red
  '#fef2f2': 'red-50', '#fee2e2': 'red-100', '#fecaca': 'red-200',
  '#fca5a5': 'red-300', '#f87171': 'red-400', '#ef4444': 'red-500',
  '#dc2626': 'red-600', '#b91c1c': 'red-700', '#991b1b': 'red-800',
  '#7f1d1d': 'red-900', '#450a0a': 'red-950',
  // orange
  '#fff7ed': 'orange-50', '#ffedd5': 'orange-100', '#fed7aa': 'orange-200',
  '#fdba74': 'orange-300', '#fb923c': 'orange-400', '#f97316': 'orange-500',
  '#ea580c': 'orange-600', '#c2410c': 'orange-700', '#9a3412': 'orange-800',
  '#7c2d12': 'orange-900', '#431407': 'orange-950',
  // amber
  '#fffbeb': 'amber-50', '#fef3c7': 'amber-100', '#fde68a': 'amber-200',
  '#fcd34d': 'amber-300', '#fbbf24': 'amber-400', '#f59e0b': 'amber-500',
  '#d97706': 'amber-600', '#b45309': 'amber-700', '#92400e': 'amber-800',
  '#78350f': 'amber-900', '#451a03': 'amber-950',
  // yellow
  '#fefce8': 'yellow-50', '#fef9c3': 'yellow-100', '#fef08a': 'yellow-200',
  '#fde047': 'yellow-300', '#facc15': 'yellow-400', '#eab308': 'yellow-500',
  '#ca8a04': 'yellow-600', '#a16207': 'yellow-700', '#854d0e': 'yellow-800',
  '#713f12': 'yellow-900', '#422006': 'yellow-950',
  // lime
  '#f7fee7': 'lime-50', '#ecfccb': 'lime-100', '#d9f99d': 'lime-200',
  '#bef264': 'lime-300', '#a3e635': 'lime-400', '#84cc16': 'lime-500',
  '#65a30d': 'lime-600', '#4d7c0f': 'lime-700', '#3f6212': 'lime-800',
  '#365314': 'lime-900', '#1a2e05': 'lime-950',
  // green
  '#f0fdf4': 'green-50', '#dcfce7': 'green-100', '#bbf7d0': 'green-200',
  '#86efac': 'green-300', '#4ade80': 'green-400', '#22c55e': 'green-500',
  '#16a34a': 'green-600', '#15803d': 'green-700', '#166534': 'green-800',
  '#14532d': 'green-900', '#052e16': 'green-950',
  // emerald
  '#ecfdf5': 'emerald-50', '#d1fae5': 'emerald-100', '#a7f3d0': 'emerald-200',
  '#6ee7b7': 'emerald-300', '#34d399': 'emerald-400', '#10b981': 'emerald-500',
  '#059669': 'emerald-600', '#047857': 'emerald-700', '#065f46': 'emerald-800',
  '#064e3b': 'emerald-900', '#022c22': 'emerald-950',
  // teal
  '#f0fdfa': 'teal-50', '#ccfbf1': 'teal-100', '#99f6e4': 'teal-200',
  '#5eead4': 'teal-300', '#2dd4bf': 'teal-400', '#14b8a6': 'teal-500',
  '#0d9488': 'teal-600', '#0f766e': 'teal-700', '#115e59': 'teal-800',
  '#134e4a': 'teal-900', '#042f2e': 'teal-950',
  // cyan
  '#ecfeff': 'cyan-50', '#cffafe': 'cyan-100', '#a5f3fc': 'cyan-200',
  '#67e8f9': 'cyan-300', '#22d3ee': 'cyan-400', '#06b6d4': 'cyan-500',
  '#0891b2': 'cyan-600', '#0e7490': 'cyan-700', '#155e75': 'cyan-800',
  '#164e63': 'cyan-900', '#083344': 'cyan-950',
  // sky
  '#f0f9ff': 'sky-50', '#e0f2fe': 'sky-100', '#bae6fd': 'sky-200',
  '#7dd3fc': 'sky-300', '#38bdf8': 'sky-400', '#0ea5e9': 'sky-500',
  '#0284c7': 'sky-600', '#0369a1': 'sky-700', '#075985': 'sky-800',
  '#0c4a6e': 'sky-900', '#082f49': 'sky-950',
  // blue
  '#eff6ff': 'blue-50', '#dbeafe': 'blue-100', '#bfdbfe': 'blue-200',
  '#93c5fd': 'blue-300', '#60a5fa': 'blue-400', '#3b82f6': 'blue-500',
  '#2563eb': 'blue-600', '#1d4ed8': 'blue-700', '#1e40af': 'blue-800',
  '#1e3a8a': 'blue-900', '#172554': 'blue-950',
  // indigo
  '#eef2ff': 'indigo-50', '#e0e7ff': 'indigo-100', '#c7d2fe': 'indigo-200',
  '#a5b4fc': 'indigo-300', '#818cf8': 'indigo-400', '#6366f1': 'indigo-500',
  '#4f46e5': 'indigo-600', '#4338ca': 'indigo-700', '#3730a3': 'indigo-800',
  '#312e81': 'indigo-900', '#1e1b4b': 'indigo-950',
  // violet
  '#f5f3ff': 'violet-50', '#ede9fe': 'violet-100', '#ddd6fe': 'violet-200',
  '#c4b5fd': 'violet-300', '#a78bfa': 'violet-400', '#8b5cf6': 'violet-500',
  '#7c3aed': 'violet-600', '#6d28d9': 'violet-700', '#5b21b6': 'violet-800',
  '#4c1d95': 'violet-900', '#2e1065': 'violet-950',
  // purple
  '#faf5ff': 'purple-50', '#f3e8ff': 'purple-100', '#e9d5ff': 'purple-200',
  '#d8b4fe': 'purple-300', '#c084fc': 'purple-400', '#a855f7': 'purple-500',
  '#9333ea': 'purple-600', '#7e22ce': 'purple-700', '#6b21a8': 'purple-800',
  '#581c87': 'purple-900', '#3b0764': 'purple-950',
  // fuchsia
  '#fdf4ff': 'fuchsia-50', '#fae8ff': 'fuchsia-100', '#f5d0fe': 'fuchsia-200',
  '#f0abfc': 'fuchsia-300', '#e879f9': 'fuchsia-400', '#d946ef': 'fuchsia-500',
  '#c026d3': 'fuchsia-600', '#a21caf': 'fuchsia-700', '#86198f': 'fuchsia-800',
  '#701a75': 'fuchsia-900', '#4a044e': 'fuchsia-950',
  // pink
  '#fdf2f8': 'pink-50', '#fce7f3': 'pink-100', '#fbcfe8': 'pink-200',
  '#f9a8d4': 'pink-300', '#f472b6': 'pink-400', '#ec4899': 'pink-500',
  '#db2777': 'pink-600', '#be185d': 'pink-700', '#9d174d': 'pink-800',
  '#831843': 'pink-900', '#500724': 'pink-950',
  // rose
  '#fff1f2': 'rose-50', '#ffe4e6': 'rose-100', '#fecdd3': 'rose-200',
  '#fda4af': 'rose-300', '#fb7185': 'rose-400', '#f43f5e': 'rose-500',
  '#e11d48': 'rose-600', '#be123c': 'rose-700', '#9f1239': 'rose-800',
  '#881337': 'rose-900', '#4c0519': 'rose-950',
}

// ─── Color distance helper (Delta E-like) ──────────────────────────
function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!m) return null
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

function colorDistance(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1)
  const rgb2 = hexToRgb(hex2)
  if (!rgb1 || !rgb2) return Infinity
  
  // Simple Euclidean distance in RGB space (good enough for Tailwind matching)
  return Math.sqrt(
    (rgb1[0] - rgb2[0]) ** 2 +
    (rgb1[1] - rgb2[1]) ** 2 +
    (rgb1[2] - rgb2[2]) ** 2
  )
}

function findClosestTailwindColor(hex: string): string | null {
  // Normalize hex format
  let normalizedHex = hex.toLowerCase().replace('#', '')
  if (normalizedHex.length === 3) {
    normalizedHex = normalizedHex.split('').map(c => c + c).join('')
  }
  normalizedHex = '#' + normalizedHex
  
  // Exact match
  if (TAILWIND_COLORS[normalizedHex]) {
    return TAILWIND_COLORS[normalizedHex]
  }
  
  // Find closest color (threshold: 30 in RGB space ≈ small difference)
  let closest: string | null = null
  let minDist = 30 // Threshold: don't match if too far
  
  for (const [twHex, className] of Object.entries(TAILWIND_COLORS)) {
    const dist = colorDistance(normalizedHex, twHex)
    if (dist < minDist) {
      minDist = dist
      closest = className
    }
  }
  
  return closest
}

function normalizeHex(hex: string): string {
  hex = hex.replace('#', '')
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('')
  }
  return '#' + hex.toLowerCase()
}

interface TailwindResult {
  classes: string[]
  unmatched: CSSPropertyMap
  matchRate: number
}

type MappingFn = (value: string) => string | null

// ─── Utility helpers ─────────────────────────────────────────────────


function parsePx(val: string): number | null {
  const m = val.match(/^(-?[\d.]+)px$/)
  if (m) return parseFloat(m[1])
  const rm = val.match(/^(-?[\d.]+)rem$/)
  if (rm) return parseFloat(rm[1]) * 16
  const em = val.match(/^(-?[\d.]+)em$/)
  if (em) return parseFloat(em[1]) * 16
  return null
}

// Map pixel values to Tailwind spacing scale
function spacingClass(prefix: string, val: string): string | null {
  if (val === 'auto') return `${prefix}-auto`
  if (val === '0' || val === '0px') return `${prefix}-0`

  const px = parsePx(val)
  if (px !== null) {
    if (px === 0) return `${prefix}-0`
    const SCALE: Record<number, string> = {
    1: 'px',
    2: '0.5',
    4: '1',
    6: '1.5',
    8: '2',
    10: '2.5',
    12: '3',
    14: '3.5',
    16: '4',
    20: '5',
    24: '6',
    28: '7',
    32: '8',
    36: '9',
    40: '10',
    44: '11',
    48: '12',
    56: '14',
    64: '16',
    80: '20',
    96: '24',
    112: '28',
    128: '32',
    144: '36',
    160: '40',
    176: '44',
    192: '48',
    208: '52',
    224: '56',
    240: '60',
    256: '64',
    288: '72',
    320: '80',
    384: '96',
  }

  if (SCALE[px]) return `${prefix}-${SCALE[px]}`
  }

  // Fractional: auto
  if (val === 'auto') return `${prefix}-auto`

  // Percentage
  const pct = val.match(/^([\d.]+)%$/)
  if (pct) {
    const n = parseFloat(pct[1])
    const fractions: Record<number, string> = {
      50: '1/2', 33.333333: '1/3', 66.666667: '2/3',
      25: '1/4', 75: '3/4',
      20: '1/5', 40: '2/5', 60: '3/5', 80: '4/5',
      100: 'full',
    }
    for (const [k, v] of Object.entries(fractions)) {
      if (Math.abs(n - parseFloat(String(k))) < 0.1) return `${prefix}-${v}`
    }
  }

  return `${prefix}-[${val}]`
}

// HSL → RGB converter (pure math, no browser APIs — Worker-safe)
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(100, s)) / 100
  l = Math.max(0, Math.min(100, l)) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60)      { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else              { r = c; b = x }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

function rgbToHexStr(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('')
}

// Robust color parser: handles rgb, rgba, hsl, hsla (both legacy & modern syntax)
function parseColorToHex(val: string): { hex: string; alpha?: number } | null {
  const patterns: Array<{ re: RegExp; kind: 'rgb' | 'hsl' }> = [
    { re: /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/, kind: 'rgb' },
    { re: /^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\s*\)$/, kind: 'rgb' },
    { re: /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:,\s*([\d.]+))?\s*\)$/, kind: 'hsl' },
    { re: /^hsla?\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+))?\s*\)$/, kind: 'hsl' },
  ]
  for (const { re, kind } of patterns) {
    const m = val.match(re)
    if (!m) continue
    const aVal = m[4] !== undefined ? parseFloat(m[4]) : undefined
    const alpha = aVal !== undefined && aVal < 1 ? aVal : undefined
    if (kind === 'rgb') {
      return { hex: rgbToHexStr(+m[1], +m[2], +m[3]), alpha }
    } else {
      const [r, g, b] = hslToRgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]))
      return { hex: rgbToHexStr(r, g, b), alpha }
    }
  }
  return null
}

// Convert color to Tailwind color class
// Common CSS named colors → hex, so keyword colors (e.g. `color: green`) map to
// a palette/arbitrary class instead of falling through as unmatched.
const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', orange: '#ffa500', purple: '#800080', gray: '#808080', grey: '#808080',
  silver: '#c0c0c0', gold: '#ffd700', pink: '#ffc0cb', brown: '#a52a2a', cyan: '#00ffff',
  aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', lime: '#00ff00', navy: '#000080',
  teal: '#008080', olive: '#808000', maroon: '#800000', indigo: '#4b0082', violet: '#ee82ee',
  coral: '#ff7f50', salmon: '#fa8072', khaki: '#f0e68c', crimson: '#dc143c', tomato: '#ff6347',
  turquoise: '#40e0d0', skyblue: '#87ceeb', slategray: '#708090', slategrey: '#708090',
  darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
  dodgerblue: '#1e90ff', royalblue: '#4169e1', steelblue: '#4682b4', forestgreen: '#228b22',
  seagreen: '#2e8b57', hotpink: '#ff69b4', chocolate: '#d2691e', beige: '#f5f5dc', ivory: '#fffff0',
  rebeccapurple: '#663399',
}

function colorClass(prefix: string, val: string): string | null {
  if (!val || val === 'transparent' || val === 'rgba(0, 0, 0, 0)') {
    return `${prefix}-transparent`
  }
  if (val === 'currentColor' || val === 'currentcolor') return `${prefix}-current`
  if (val === 'inherit') return `${prefix}-inherit`
  // Resolve a CSS keyword color to hex, then fall through to the hex handling.
  const named = NAMED_COLORS[val.toLowerCase()]
  if (named) val = named

  // Try parseColorToHex first (handles rgb/rgba/hsl/hsla in all syntaxes)
  const parsed = parseColorToHex(val)
  if (parsed) {
    const twColor = findClosestTailwindColor(parsed.hex)
    if (twColor) {
      if (parsed.alpha !== undefined) {
        return `${prefix}-${twColor}/${Math.round(parsed.alpha * 100)}`
      }
      return `${prefix}-${twColor}`
    }
    if (parsed.alpha !== undefined) {
      return `${prefix}-[${parsed.hex}]/${Math.round(parsed.alpha * 100)}`
    }
    return `${prefix}-[${parsed.hex}]`
  }

  // Handle hex format directly
  if (val.startsWith('#')) {
    const hex = normalizeHex(val)
    const twColor = findClosestTailwindColor(hex)
    if (twColor) return `${prefix}-${twColor}`
    return `${prefix}-[${hex}]`
  }

  // Fallback: unrecognized CSS color functions (oklch, display-p3, lab, etc.)
  if (val.includes('(') && val.includes(')')) {
    return `${prefix}-[${val.replace(/\s+/g, '_')}]`
  }

  return null
}

// Expand a margin/padding shorthand (1–4 values) into Tailwind per-side classes.
// 1: p-{a} · 2: py-{a} px-{b} · 3: pt-{a} px-{b} pb-{c} · 4: pt-{a} pr-{b} pb-{c} pl-{d}.
// Zero sides are dropped (they're the default). Returns a space-joined class string.
function boxShorthand(p: string, v: string): string | null {
  const t = v.trim()
  if (!t || t === '0px' || t === '0') return null
  const parts = t.split(/\s+/)
  if (parts.length === 1) return spacingClass(p, parts[0])
  const side = (pref: string, val: string) => (val === '0px' || val === '0') ? null : spacingClass(pref, val)
  let out: (string | null)[]
  if (parts.length === 2) out = [side(p + 'y', parts[0]), side(p + 'x', parts[1])]
  else if (parts.length === 3) out = [side(p + 't', parts[0]), side(p + 'x', parts[1]), side(p + 'b', parts[2])]
  else out = [side(p + 't', parts[0]), side(p + 'r', parts[1]), side(p + 'b', parts[2]), side(p + 'l', parts[3])]
  const cls = out.filter(Boolean)
  return cls.length ? cls.join(' ') : null
}

// Split a value on top-level whitespace, keeping parenthesised groups intact
// (so `1px solid rgb(0, 0, 0)` → ['1px','solid','rgb(0, 0, 0)'], not split mid-rgb).
function splitTopLevel(v: string): string[] {
  const out: string[] = []
  let depth = 0, cur = ''
  for (const ch of v) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (/\s/.test(ch) && depth === 0) { if (cur) { out.push(cur); cur = '' } }
    else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

const BORDER_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'none', 'hidden', 'groove', 'ridge', 'inset', 'outset'])

// Expand a `border`/`outline` shorthand into width + style + color classes.
function borderShorthand(prefix: 'border' | 'outline', v: string): string | null {
  const t = v.trim()
  if (t === '0' || t === '0px' || t === 'none') return prefix === 'border' ? 'border-0' : 'outline-none'
  let width: string | undefined, style: string | undefined, color: string | undefined
  for (const tok of splitTopLevel(t)) {
    if (BORDER_STYLES.has(tok)) style = tok
    else if (/^[\d.]+(px|em|rem)$/.test(tok) || tok === 'thin' || tok === 'medium' || tok === 'thick') width = tok
    else color = color ? `${color} ${tok}` : tok
  }
  const out: (string | null)[] = []
  if (width) {
    const px = parsePx(width) ?? ({ thin: 1, medium: 3, thick: 5 } as Record<string, number>)[width]
    const wmap: Record<number, string> = prefix === 'border'
      ? { 0: 'border-0', 1: 'border', 2: 'border-2', 4: 'border-4', 8: 'border-8' }
      : { 0: 'outline-0', 1: 'outline-1', 2: 'outline-2', 4: 'outline-4', 8: 'outline-8' }
    out.push(px != null && wmap[px] ? wmap[px] : `${prefix}-[${width}]`)
  } else {
    out.push(prefix === 'border' ? 'border' : 'outline')
  }
  if (style && style !== 'solid') out.push(`${prefix}-${style}`)
  if (color) out.push(colorClass(prefix, color))
  const cls = out.filter(Boolean)
  return cls.length ? cls.join(' ') : null
}

// ─── Property mappers ─────────────────────────────────────────────────

const DISPLAY_MAP: Record<string, string> = {
  'block': 'block',
  'inline-block': 'inline-block',
  'inline': 'inline',
  'flex': 'flex',
  'inline-flex': 'inline-flex',
  'grid': 'grid',
  'inline-grid': 'inline-grid',
  'table': 'table',
  'table-cell': 'table-cell',
  'table-row': 'table-row',
  'none': 'hidden',
  'contents': 'contents',
  'list-item': 'list-item',
}

const POSITION_MAP: Record<string, string> = {
  static: 'static',
  fixed: 'fixed',
  absolute: 'absolute',
  relative: 'relative',
  sticky: 'sticky',
}

const OVERFLOW_MAP: Record<string, string> = {
  auto: 'overflow-auto',
  hidden: 'overflow-hidden',
  visible: 'overflow-visible',
  scroll: 'overflow-scroll',
  clip: 'overflow-clip',
}

const FONT_WEIGHT_MAP: Record<string, string> = {
  '100': 'font-thin',
  '200': 'font-extralight',
  '300': 'font-light',
  '400': 'font-normal',
  '500': 'font-medium',
  '600': 'font-semibold',
  '700': 'font-bold',
  '800': 'font-extrabold',
  '900': 'font-black',
}

const TEXT_ALIGN_MAP: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
  start: 'text-start',
  end: 'text-end',
}

const FLEX_DIRECTION_MAP: Record<string, string> = {
  row: 'flex-row',
  'row-reverse': 'flex-row-reverse',
  column: 'flex-col',
  'column-reverse': 'flex-col-reverse',
}

const ALIGN_ITEMS_MAP: Record<string, string> = {
  flex_start: 'items-start',
  'flex-start': 'items-start',
  flex_end: 'items-end',
  'flex-end': 'items-end',
  center: 'items-center',
  baseline: 'items-baseline',
  stretch: 'items-stretch',
}

const JUSTIFY_CONTENT_MAP: Record<string, string> = {
  flex_start: 'justify-start',
  'flex-start': 'justify-start',
  flex_end: 'justify-end',
  'flex-end': 'justify-end',
  center: 'justify-center',
  'space-between': 'justify-between',
  'space-around': 'justify-around',
  'space-evenly': 'justify-evenly',
  stretch: 'justify-stretch',
}

const FONT_SIZE_MAP: Record<number, string> = {
  12: 'text-xs',
  14: 'text-sm',
  16: 'text-base',
  18: 'text-lg',
  20: 'text-xl',
  24: 'text-2xl',
  30: 'text-3xl',
  36: 'text-4xl',
  48: 'text-5xl',
  60: 'text-6xl',
  72: 'text-7xl',
  96: 'text-8xl',
  128: 'text-9xl',
}

const OPACITY_MAP: Record<string, string> = {
  '0': 'opacity-0',
  '0.05': 'opacity-5',
  '0.1': 'opacity-10',
  '0.15': 'opacity-15',
  '0.2': 'opacity-20',
  '0.25': 'opacity-25',
  '0.3': 'opacity-30',
  '0.35': 'opacity-35',
  '0.4': 'opacity-40',
  '0.45': 'opacity-45',
  '0.5': 'opacity-50',
  '0.6': 'opacity-60',
  '0.7': 'opacity-70',
  '0.75': 'opacity-75',
  '0.8': 'opacity-80',
  '0.9': 'opacity-90',
  '0.95': 'opacity-95',
  '1': 'opacity-100',
}

// ─── Main property → Tailwind mappers ─────────────────────────────────

const PROPERTY_MAPPERS: Record<string, MappingFn> = {
  // Layout
  display: (v) => DISPLAY_MAP[v] || null,
  position: (v) => POSITION_MAP[v] || null,
  overflow: (v) => OVERFLOW_MAP[v] || null,
  'overflow-x': (v) => v === 'hidden' ? 'overflow-x-hidden' : v === 'auto' ? 'overflow-x-auto' : null,
  'overflow-y': (v) => v === 'hidden' ? 'overflow-y-hidden' : v === 'auto' ? 'overflow-y-auto' : null,

  // Sizing
  width: (v) => {
    if (v === '100%') return 'w-full'
    if (v === '100vw') return 'w-screen'
    if (v === 'auto') return 'w-auto'
    if (v === 'fit-content') return 'w-fit'
    if (v === 'min-content') return 'w-min'
    if (v === 'max-content') return 'w-max'
    return spacingClass('w', v)
  },
  height: (v) => {
    if (v === '100%') return 'h-full'
    if (v === '100vh') return 'h-screen'
    if (v === 'auto') return 'h-auto'
    if (v === 'fit-content') return 'h-fit'
    return spacingClass('h', v)
  },
  'min-width': (v) => v === '0px' ? null : spacingClass('min-w', v),
  'min-height': (v) => v === '0px' ? null : spacingClass('min-h', v),
  'max-width': (v) => {
    if (v === 'none') return null
    const BREAKPOINTS: Record<string, string> = {
      '640px': 'max-w-sm', '768px': 'max-w-md', '1024px': 'max-w-lg',
      '1280px': 'max-w-xl', '1536px': 'max-w-2xl',
    }
    return BREAKPOINTS[v] || spacingClass('max-w', v)
  },
  'max-height': (v) => v === 'none' ? null : spacingClass('max-h', v),

  // Spacing — shorthand (expand N-value shorthands into per-side classes; a bare
  // `p-[0px 25px]` is invalid Tailwind — arbitrary values can't contain spaces).
  margin: (v) => v === 'auto' ? 'm-auto' : boxShorthand('m', v),
  padding: (v) => boxShorthand('p', v),

  // Individual spacing
  'margin-top': (v) => v === '0px' ? null : spacingClass('mt', v),
  'margin-right': (v) => v === '0px' ? null : spacingClass('mr', v),
  'margin-bottom': (v) => v === '0px' ? null : spacingClass('mb', v),
  'margin-left': (v) => v === '0px' ? null : spacingClass('ml', v),
  'padding-top': (v) => v === '0px' ? null : spacingClass('pt', v),
  'padding-right': (v) => v === '0px' ? null : spacingClass('pr', v),
  'padding-bottom': (v) => v === '0px' ? null : spacingClass('pb', v),
  'padding-left': (v) => v === '0px' ? null : spacingClass('pl', v),

  // Position
  top: (v) => v === 'auto' ? null : spacingClass('top', v),
  right: (v) => v === 'auto' ? null : spacingClass('right', v),
  bottom: (v) => v === 'auto' ? null : spacingClass('bottom', v),
  left: (v) => v === 'auto' ? null : spacingClass('left', v),

  // Colors
  color: (v) => colorClass('text', v),
  'background-color': (v) => {
    if (v === 'rgba(0, 0, 0, 0)' || v === 'transparent') return 'bg-transparent'
    return colorClass('bg', v)
  },
  'border-color': (v) => colorClass('border', v),
  'outline-color': (v) => colorClass('outline', v),

  // Shorthands
  border: (v) => borderShorthand('border', v),
  outline: (v) => borderShorthand('outline', v),
  // `background` shorthand — a plain color, gradient, or url() all map via
  // colorClass (its arbitrary-value fallback wraps gradient/url in bg-[...]).
  background: (v) => {
    if (v === 'none') return null
    return colorClass('bg', v)
  },
  // `font` shorthand (e.g. `italic 700 16px/1.5 Arial`) — pull out the size and
  // the family; weight/style are emitted when present. Best-effort, returns what
  // it can parse.
  font: (v) => {
    const parts: string[] = []
    const sizeMatch = v.match(/(\d*\.?\d+(?:px|rem|em))(?:\s*\/\s*\S+)?/)
    if (sizeMatch) {
      const px = parsePx(sizeMatch[1])
      parts.push(px && FONT_SIZE_MAP[px] ? FONT_SIZE_MAP[px] : `text-[${sizeMatch[1]}]`)
    }
    if (/\bitalic\b/.test(v)) parts.push('italic')
    const weightMatch = v.match(/\b([1-9]00)\b/)
    if (weightMatch && FONT_WEIGHT_MAP[weightMatch[1]]) parts.push(FONT_WEIGHT_MAP[weightMatch[1]])
    if (/\bserif\b/.test(v) && !/sans-serif/.test(v)) parts.push('font-serif')
    else if (/sans-serif|\bsans\b/.test(v)) parts.push('font-sans')
    else if (/\bmono(space)?\b/.test(v)) parts.push('font-mono')
    return parts.length ? parts.join(' ') : null
  },

  // Typography
  'font-size': (v) => {
    const px = parsePx(v)
    if (px && FONT_SIZE_MAP[px]) return FONT_SIZE_MAP[px]
    return v ? `text-[${v}]` : null
  },
  'font-weight': (v) => FONT_WEIGHT_MAP[v] || null,
  'font-family': (v) => {
    if (v.includes('sans')) return 'font-sans'
    if (v.includes('serif')) return 'font-serif'
    if (v.includes('mono')) return 'font-mono'
    return `font-['${v.split(',')[0].trim().replace(/['"]/g, '')}']`
  },
  'font-style': (v) => v === 'italic' ? 'italic' : v === 'normal' ? 'not-italic' : null,
  'line-height': (v) => {
    const lh: Record<string, string> = {
      '1': 'leading-none',
      '1.25': 'leading-tight',
      '1.375': 'leading-snug',
      '1.5': 'leading-normal',
      '1.625': 'leading-relaxed',
      '2': 'leading-loose',
    }
    return lh[v] || `leading-[${v}]`
  },
  'text-align': (v) => TEXT_ALIGN_MAP[v] || null,
  'text-decoration': (v) => {
    if (v.includes('underline')) return 'underline'
    if (v.includes('line-through')) return 'line-through'
    if (v.includes('none')) return 'no-underline'
    return null
  },
  'text-transform': (v) => ({
    uppercase: 'uppercase', lowercase: 'lowercase',
    capitalize: 'capitalize', none: 'normal-case',
  }[v] || null),
  'letter-spacing': (v) => {
    const ls: Record<string, string> = {
      '-0.05em': 'tracking-tighter', '-0.025em': 'tracking-tight',
      '0em': 'tracking-normal', '0.025em': 'tracking-wide',
      '0.05em': 'tracking-wider', '0.1em': 'tracking-widest',
    }
    return ls[v] || `tracking-[${v}]`
  },

  // Border
  'border-width': (v) => {
    const bw: Record<string, string> = { '0px': 'border-0', '1px': 'border', '2px': 'border-2', '4px': 'border-4', '8px': 'border-8' }
    return bw[v] || `border-[${v}]`
  },
  'border-style': (v) => v === 'none' ? 'border-none' : v === 'solid' ? 'border-solid' : v === 'dashed' ? 'border-dashed' : v === 'dotted' ? 'border-dotted' : null,
  'border-radius': (v) => {
    if (v === '0px') return 'rounded-none'
    if (v === '9999px' || v === '50%') return 'rounded-full'
    const br: Record<string, string> = {
      '2px': 'rounded-sm', '4px': 'rounded', '6px': 'rounded-md',
      '8px': 'rounded-lg', '12px': 'rounded-xl', '16px': 'rounded-2xl',
      '24px': 'rounded-3xl',
    }
    return br[v] || `rounded-[${v}]`
  },
  'border-top-left-radius': (v) => v === '0px' ? null : `rounded-tl-[${v}]`,
  'border-top-right-radius': (v) => v === '0px' ? null : `rounded-tr-[${v}]`,
  'border-bottom-left-radius': (v) => v === '0px' ? null : `rounded-bl-[${v}]`,
  'border-bottom-right-radius': (v) => v === '0px' ? null : `rounded-br-[${v}]`,

  // Shadow
  'box-shadow': (v) => {
    if (v === 'none') return 'shadow-none'
    const shadows: Record<string, string> = {
      '0 1px 2px 0 rgb(0 0 0 / 0.05)': 'shadow-sm',
      '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)': 'shadow',
      '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)': 'shadow-md',
      '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)': 'shadow-lg',
      '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)': 'shadow-xl',
      '0 25px 50px -12px rgb(0 0 0 / 0.25)': 'shadow-2xl',
      'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)': 'shadow-inner',
    }
    return shadows[v] || `shadow-[${v.replace(/\s+/g, '_')}]`
  },

  // Opacity
  opacity: (v) => OPACITY_MAP[v] || `opacity-[${v}]`,

  // Flex
  'flex-direction': (v) => FLEX_DIRECTION_MAP[v] || null,
  'flex-wrap': (v) => ({ wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' }[v] || null),
  'align-items': (v) => ALIGN_ITEMS_MAP[v] || null,
  'justify-content': (v) => JUSTIFY_CONTENT_MAP[v] || null,
  'align-self': (v) => ({
    auto: 'self-auto', 'flex-start': 'self-start', 'flex-end': 'self-end',
    center: 'self-center', baseline: 'self-baseline', stretch: 'self-stretch',
  }[v] || null),
  flex: (v) => {
    if (v === '1 1 0%') return 'flex-1'
    if (v === '1 1 auto') return 'flex-auto'
    if (v === '0 0 auto') return 'flex-none'
    if (v === '1 0 0%') return 'grow'
    return null
  },
  gap: (v) => v === '0px' ? null : spacingClass('gap', v),
  'row-gap': (v) => v === '0px' ? null : spacingClass('gap-y', v),
  'column-gap': (v) => v === '0px' ? null : spacingClass('gap-x', v),

  // Z-index
  'z-index': (v) => {
    const zi: Record<string, string> = { '0': 'z-0', '10': 'z-10', '20': 'z-20', '30': 'z-30', '40': 'z-40', '50': 'z-50', 'auto': 'z-auto' }
    return zi[v] || `z-[${v}]`
  },

  // Visibility
  visibility: (v) => v === 'hidden' ? 'invisible' : v === 'visible' ? 'visible' : null,

  // Cursor
  cursor: (v) => {
    const cur: Record<string, string> = {
      auto: 'cursor-auto', default: 'cursor-default', pointer: 'cursor-pointer',
      wait: 'cursor-wait', text: 'cursor-text', move: 'cursor-move',
      'not-allowed': 'cursor-not-allowed', crosshair: 'cursor-crosshair', grab: 'cursor-grab',
    }
    return cur[v] || null
  },

  // White space
  'white-space': (v) => ({
    normal: 'whitespace-normal', nowrap: 'whitespace-nowrap',
    pre: 'whitespace-pre', 'pre-wrap': 'whitespace-pre-wrap', 'pre-line': 'whitespace-pre-line',
  }[v] || null),

  // Transform
  transform: (v) => v === 'none' ? null : `[transform:${v}]`,

  // Transition
  transition: (v) => {
    if (v === 'none' || v.includes('0s')) return null
    if (v.includes('all')) return 'transition-all'
    if (v.includes('color') || v.includes('background')) return 'transition-colors'
    if (v.includes('opacity')) return 'transition-opacity'
    if (v.includes('transform')) return 'transition-transform'
    return 'transition'
  },
}

// ─── Main export ─────────────────────────────────────────────────────

export function cssToTailwind(styles: CSSPropertyMap): TailwindResult {
  const classes: string[] = []
  const unmatched: CSSPropertyMap = {}
  let matched = 0
  let total = 0

  for (const [prop, value] of Object.entries(styles)) {
    if (!value) continue
    total++
    const mapper = PROPERTY_MAPPERS[prop]
    if (mapper) {
      const cls = mapper(value)
      if (cls) {
        classes.push(cls)
        matched++
      } else {
        unmatched[prop] = value
      }
    } else {
      unmatched[prop] = value
    }
  }

  return {
    classes: [...new Set(classes)],
    unmatched,
    matchRate: total === 0 ? 1 : matched / total,
  }
}
