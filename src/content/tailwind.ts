/** CSS → Tailwind class mapping. Pure, stateless lookup tables + matcher. */

const TW_COLORS: Record<string, string[]> = {
  '#fef2f2': ['red-50'], '#fee2e2': ['red-100'], '#fecaca': ['red-200'], '#fca5a5': ['red-300'],
  '#f87171': ['red-400'], '#ef4444': ['red-500'], '#dc2626': ['red-600'], '#b91c1c': ['red-700'],
  '#991b1b': ['red-800'], '#7f1d1d': ['red-900'],
  '#fff7ed': ['orange-50'], '#ffedd5': ['orange-100'], '#fed7aa': ['orange-200'], '#fdba74': ['orange-300'],
  '#fb923c': ['orange-400'], '#f97316': ['orange-500'], '#ea580c': ['orange-600'], '#c2410c': ['orange-700'],
  '#9a3412': ['orange-800'], '#7c2d12': ['orange-900'],
  '#fffbeb': ['amber-50'], '#fef3c7': ['amber-100'], '#fde68a': ['amber-200'], '#fcd34d': ['amber-300'],
  '#fbbf24': ['amber-400'], '#f59e0b': ['amber-500'], '#d97706': ['amber-600'], '#b45309': ['amber-700'],
  '#92400e': ['amber-800'], '#78350f': ['amber-900'],
  '#fefce8': ['yellow-50'], '#fef9c3': ['yellow-100'], '#fef08a': ['yellow-200'], '#fde047': ['yellow-300'],
  '#facc15': ['yellow-400'], '#eab308': ['yellow-500'], '#ca8a04': ['yellow-600'], '#a16207': ['yellow-700'],
  '#854d0e': ['yellow-800'], '#713f12': ['yellow-900'],
  '#f7fee7': ['lime-50'], '#ecfccb': ['lime-100'], '#d9f99d': ['lime-200'], '#bef264': ['lime-300'],
  '#a3e635': ['lime-400'], '#84cc16': ['lime-500'], '#65a30d': ['lime-600'], '#4d7c0f': ['lime-700'],
  '#3f6212': ['lime-800'], '#365314': ['lime-900'],
  '#f0fdf4': ['green-50'], '#dcfce7': ['green-100'], '#bbf7d0': ['green-200'], '#86efac': ['green-300'],
  '#4ade80': ['green-400'], '#22c55e': ['green-500'], '#16a34a': ['green-600'], '#15803d': ['green-700'],
  '#166534': ['green-800'], '#14532d': ['green-900'],
  '#ecfdf5': ['emerald-50'], '#d1fae5': ['emerald-100'], '#a7f3d0': ['emerald-200'], '#6ee7b7': ['emerald-300'],
  '#34d399': ['emerald-400'], '#10b981': ['emerald-500'], '#059669': ['emerald-600'], '#047857': ['emerald-700'],
  '#065f46': ['emerald-800'], '#064e3b': ['emerald-900'],
  '#f0fdfa': ['teal-50'], '#ccfbf1': ['teal-100'], '#99f6e4': ['teal-200'], '#5eead4': ['teal-300'],
  '#2dd4bf': ['teal-400'], '#14b8a6': ['teal-500'], '#0d9488': ['teal-600'], '#0f766e': ['teal-700'],
  '#115e59': ['teal-800'], '#134e4a': ['teal-900'],
  '#ecfeff': ['cyan-50'], '#cffafe': ['cyan-100'], '#a5f3fc': ['cyan-200'], '#67e8f9': ['cyan-300'],
  '#22d3ee': ['cyan-400'], '#06b6d4': ['cyan-500'], '#0891b2': ['cyan-600'], '#0e7490': ['cyan-700'],
  '#155e75': ['cyan-800'], '#164e63': ['cyan-900'],
  '#f0f9ff': ['sky-50'], '#e0f2fe': ['sky-100'], '#bae6fd': ['sky-200'], '#7dd3fc': ['sky-300'],
  '#38bdf8': ['sky-400'], '#0ea5e9': ['sky-500'], '#0284c7': ['sky-600'], '#0369a1': ['sky-700'],
  '#075985': ['sky-800'], '#0c4a6e': ['sky-900'],
  '#eff6ff': ['blue-50'], '#dbeafe': ['blue-100'], '#bfdbfe': ['blue-200'], '#93c5fd': ['blue-300'],
  '#60a5fa': ['blue-400'], '#3b82f6': ['blue-500'], '#2563eb': ['blue-600'], '#1d4ed8': ['blue-700'],
  '#1e40af': ['blue-800'], '#1e3a8a': ['blue-900'],
  '#eef2ff': ['indigo-50'], '#e0e7ff': ['indigo-100'], '#c7d2fe': ['indigo-200'], '#a5b4fc': ['indigo-300'],
  '#818cf8': ['indigo-400'], '#6366f1': ['indigo-500'], '#4f46e5': ['indigo-600'], '#4338ca': ['indigo-700'],
  '#3730a3': ['indigo-800'], '#312e81': ['indigo-900'],
  '#f5f3ff': ['violet-50'], '#ede9fe': ['violet-100'], '#ddd6fe': ['violet-200'], '#c4b5fd': ['violet-300'],
  '#a78bfa': ['violet-400'], '#8b5cf6': ['violet-500'], '#7c3aed': ['violet-600'], '#6d28d9': ['violet-700'],
  '#5b21b6': ['violet-800'], '#4c1d95': ['violet-900'],
  '#faf5ff': ['purple-50'], '#f3e8ff': ['purple-100'], '#e9d5ff': ['purple-200'], '#d8b4fe': ['purple-300'],
  '#c084fc': ['purple-400'], '#a855f7': ['purple-500'], '#9333ea': ['purple-600'], '#7e22ce': ['purple-700'],
  '#6b21a8': ['purple-800'], '#581c87': ['purple-900'],
  '#fdf4ff': ['fuchsia-50'], '#fae8ff': ['fuchsia-100'], '#f5d0fe': ['fuchsia-200'], '#f0abfc': ['fuchsia-300'],
  '#e879f9': ['fuchsia-400'], '#d946ef': ['fuchsia-500'], '#c026d3': ['fuchsia-600'], '#a21caf': ['fuchsia-700'],
  '#86198f': ['fuchsia-800'], '#701a75': ['fuchsia-900'],
  '#fdf2f8': ['pink-50'], '#fce7f3': ['pink-100'], '#fbcfe8': ['pink-200'], '#f9a8d4': ['pink-300'],
  '#f472b6': ['pink-400'], '#ec4899': ['pink-500'], '#db2777': ['pink-600'], '#be185d': ['pink-700'],
  '#9d174d': ['pink-800'], '#831843': ['pink-900'],
  '#fff1f2': ['rose-50'], '#ffe4e6': ['rose-100'], '#fecdd3': ['rose-200'], '#fda4af': ['rose-300'],
  '#fb7185': ['rose-400'], '#f43f5e': ['rose-500'], '#e11d48': ['rose-600'], '#be123c': ['rose-700'],
  '#9f1239': ['rose-800'], '#881337': ['rose-900'],
  '#f8fafc': ['slate-50'], '#f1f5f9': ['slate-100'], '#e2e8f0': ['slate-200'], '#cbd5e1': ['slate-300'],
  '#94a3b8': ['slate-400'], '#64748b': ['slate-500'], '#475569': ['slate-600'], '#334155': ['slate-700'],
  '#1e293b': ['slate-800'], '#0f172a': ['slate-900'],
  '#f9fafb': ['gray-50'], '#f3f4f6': ['gray-100'], '#e5e7eb': ['gray-200'], '#d1d5db': ['gray-300'],
  '#9ca3af': ['gray-400'], '#6b7280': ['gray-500'], '#4b5563': ['gray-600'], '#374151': ['gray-700'],
  '#1f2937': ['gray-800'], '#111827': ['gray-900'],
  '#fafafa': ['neutral-50'], '#f5f5f5': ['neutral-100'], '#e5e5e5': ['neutral-200'], '#d4d4d4': ['neutral-300'],
  '#a3a3a3': ['neutral-400'], '#737373': ['neutral-500'], '#525252': ['neutral-600'], '#404040': ['neutral-700'],
  '#262626': ['neutral-800'], '#171717': ['neutral-900'],
  '#f4f4f5': ['zinc-100'], '#e4e4e7': ['zinc-200'], '#d4d4d8': ['zinc-300'], '#a1a1aa': ['zinc-400'],
  '#71717a': ['zinc-500'], '#52525b': ['zinc-600'], '#3f3f46': ['zinc-700'], '#27272a': ['zinc-800'],
  '#18181b': ['zinc-900'],
  '#ffffff': ['white'], '#fff': ['white'],
  '#000000': ['black'], '#000': ['black'],
  'transparent': ['transparent'], 'currentcolor': ['current'],
}

// Convert #rgb / #rrggbb to lowercase hex for lookup
function normalizeHex(val: string): string {
  if (val === 'transparent' || val === 'currentcolor') return val
  if (val.startsWith('#')) {
    const m = val.match(/^#([0-9a-fA-F]{3,8})$/)
    if (!m) return val.toLowerCase()
    const hex = m[1]
    if (hex.length === 3) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    if (hex.length === 4) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    if (hex.length === 8) return `#${hex.slice(0, 6)}`
    return `#${hex}`
  }
  // rgb / rgba
  const m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (m) {
    const r = parseInt(m[1], 10), g = parseInt(m[2], 10), b = parseInt(m[3], 10)
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
  }
  return val.toLowerCase()
}

function matchColor(val: string): string | null {
  const hex = normalizeHex(val)
  return TW_COLORS[hex]?.[0] ?? null
}

// px → Tailwind spacing scale (4px = 1 unit)
const TW_SPACING: [number, string][] = [
  [0, '0'], [2, '0.5'], [4, '1'], [6, '1.5'], [8, '2'], [10, '2.5'], [12, '3'], [14, '3.5'],
  [16, '4'], [20, '5'], [24, '6'], [28, '7'], [32, '8'], [36, '9'], [40, '10'], [44, '11'],
  [48, '12'], [56, '14'], [64, '16'], [72, '18'], [80, '20'], [96, '24'], [112, '28'],
  [128, '32'], [144, '36'], [160, '40'], [176, '44'], [192, '48'], [208, '52'], [224, '56'],
  [240, '60'], [256, '64'], [288, '72'], [320, '80'], [384, '96'],
]

function matchSpacing(px: number): string | null {
  for (let i = TW_SPACING.length - 1; i >= 0; i--) {
    if (px >= TW_SPACING[i][0] - 0.5 && px <= TW_SPACING[i][0] + 0.5) return TW_SPACING[i][1]
  }
  return null
}

const TW_FONT_SIZE: [string, number][] = [
  ['xs', 12], ['sm', 14], ['base', 16], ['lg', 18], ['xl', 20],
  ['2xl', 24], ['3xl', 30], ['4xl', 36], ['5xl', 48], ['6xl', 60], ['7xl', 72], ['8xl', 96], ['9xl', 128],
]
const TW_FONT_WEIGHT: Record<string, string> = { '100': 'thin', '200': 'extralight', '300': 'light', '400': 'normal', '500': 'medium', '600': 'semibold', '700': 'bold', '800': 'extrabold', '900': 'black' }
const TW_BORDER_RADIUS: [string, number][] = [
  ['none', 0], ['sm', 2], ['', 4], ['md', 6], ['lg', 8], ['xl', 12], ['2xl', 16], ['3xl', 24],
]
const TW_SHADOW: Record<string, string> = {
  '0 1px 2px 0 rgba(0,0,0,0.05)': 'sm', '0 1px 3px 0 rgba(0,0,0,0.1)': 'DEFAULT',
  '0 4px 6px -1px rgba(0,0,0,0.1)': 'md', '0 10px 15px -3px rgba(0,0,0,0.1)': 'lg',
  '0 20px 25px -5px rgba(0,0,0,0.1)': 'xl', '0 25px 50px -12px rgba(0,0,0,0.25)': '2xl',
}

export function mapCSSToTailwind(styles: CSSStyleDeclaration): string[] {
  const classes: string[] = []
  const props = new Map<string, string>()
  for (let i = 0; i < styles.length; i++) {
    const p = styles[i]
    const v = styles.getPropertyValue(p)
    if (v && !['initial', 'none', 'auto', 'normal'].includes(v) && v !== 'rgba(0, 0, 0, 0)') {
      props.set(p, v)
    }
  }

  // Color props
  for (const [cssProp, twPrefix] of [['color', 'text'], ['background-color', 'bg'], ['border-color', 'border']] as const) {
    const val = props.get(cssProp)
    if (val) {
      const c = matchColor(val)
      if (c) classes.push(`${twPrefix}-${c}`)
    }
  }

  // Spacing: padding / margin / gap / width / height
  for (const [cssProp, twPrefix] of [
    ['padding', 'p'], ['padding-top', 'pt'], ['padding-right', 'pr'], ['padding-bottom', 'pb'], ['padding-left', 'pl'],
    ['padding-inline', 'px'], ['padding-block', 'py'],
    ['margin', 'm'], ['margin-top', 'mt'], ['margin-right', 'mr'], ['margin-bottom', 'mb'], ['margin-left', 'ml'],
    ['gap', 'gap'], ['row-gap', 'gap-y'], ['column-gap', 'gap-x'],
    ['width', 'w'], ['min-width', 'min-w'], ['max-width', 'max-w'],
    ['height', 'h'], ['min-height', 'min-h'], ['max-height', 'max-h'],
  ] as const) {
    const val = props.get(cssProp)
    if (val) {
      const px = parseFloat(val)
      if (!isNaN(px)) {
        const s = matchSpacing(px)
        if (s) classes.push(`${twPrefix}-${s}`)
      }
    }
  }

  // Font size
  const fontSize = props.get('font-size')
  if (fontSize) {
    const px = parseFloat(fontSize)
    if (!isNaN(px)) {
      for (const [name, size] of TW_FONT_SIZE) {
        if (Math.abs(px - size) <= 1) { classes.push(`text-${name}`); break }
      }
    }
  }

  // Font weight
  const fontWeight = props.get('font-weight')
  if (fontWeight && TW_FONT_WEIGHT[fontWeight]) classes.push(`font-${TW_FONT_WEIGHT[fontWeight]}`)

  // Line height
  const lineHeight = props.get('line-height')
  if (lineHeight) {
    const n = parseFloat(lineHeight)
    if (!isNaN(n)) {
      if (n >= 2.4 && n <= 2.6) classes.push('leading-loose')
      else if (n >= 1.6 && n <= 1.8) classes.push('leading-relaxed')
      else if (n >= 1.4 && n <= 1.55) classes.push('leading-normal')
      else if (n >= 1.2 && n <= 1.35) classes.push('leading-snug')
      else if (n >= 0.95 && n <= 1.1) classes.push('leading-tight')
      else {
        // Try px matching
        const s = matchSpacing(n)
        if (s) classes.push(`leading-[${n}px]`)
        else classes.push(`leading-[${n}]`)
      }
    }
  }

  // Border radius
  const borderRadius = props.get('border-radius')
  if (borderRadius) {
    const px = parseFloat(borderRadius)
    if (!isNaN(px)) {
      if (px >= 999) classes.push('rounded-full')
      else {
        for (const [name, size] of TW_BORDER_RADIUS) {
          if (Math.abs(px - size) <= 1) { classes.push(name ? `rounded-${name}` : 'rounded'); break }
        }
      }
    }
  }

  // Display
  const display = props.get('display')
  if (display === 'flex') classes.push('flex')
  else if (display === 'grid') classes.push('grid')
  else if (display === 'block') classes.push('block')
  else if (display === 'inline-block') classes.push('inline-block')
  else if (display === 'inline') classes.push('inline')
  else if (display === 'inline-flex') classes.push('inline-flex')
  else if (display === 'none') classes.push('hidden')

  // Flex direction
  const flexDir = props.get('flex-direction')
  if (flexDir === 'column') classes.push('flex-col')
  else if (flexDir === 'row') classes.push('flex-row')
  else if (flexDir === 'column-reverse') classes.push('flex-col-reverse')

  // Align / Justify
  const alignMap: Record<string, string> = { 'center': 'center', 'flex-start': 'start', 'flex-end': 'end', 'stretch': 'stretch', 'space-between': 'between', 'space-around': 'around', 'space-evenly': 'evenly' }
  const alignItems = props.get('align-items')
  if (alignItems && alignMap[alignItems]) classes.push(`items-${alignMap[alignItems]}`)
  const justifyContent = props.get('justify-content')
  if (justifyContent && alignMap[justifyContent]) classes.push(`justify-${alignMap[justifyContent]}`)

  // Text align
  const textAlign = props.get('text-align')
  if (textAlign === 'center') classes.push('text-center')
  else if (textAlign === 'right') classes.push('text-right')
  else if (textAlign === 'justify') classes.push('text-justify')

  // Cursor
  const cursor = props.get('cursor')
  if (cursor === 'pointer') classes.push('cursor-pointer')
  else if (cursor === 'not-allowed') classes.push('cursor-not-allowed')
  else if (cursor === 'wait') classes.push('cursor-wait')

  // Opacity
  const opacity = props.get('opacity')
  if (opacity && opacity !== '1') {
    const n = parseInt(String(parseFloat(opacity) * 100))
    if (!isNaN(n) && n % 5 === 0 && n <= 100) classes.push(`opacity-${n}`)
  }

  // Box shadow
  const boxShadow = props.get('box-shadow')
  if (boxShadow && boxShadow !== 'none') {
    const matched = TW_SHADOW[boxShadow]
    if (matched) classes.push(matched === 'DEFAULT' ? 'shadow' : `shadow-${matched}`)
    else classes.push('shadow-lg') // best-effort fallback
  }

  // Position
  const position = props.get('position')
  if (position === 'relative') classes.push('relative')
  else if (position === 'absolute') classes.push('absolute')
  else if (position === 'fixed') classes.push('fixed')
  else if (position === 'sticky') classes.push('sticky')

  // Overflow
  const overflow = props.get('overflow')
  if (overflow === 'hidden') classes.push('overflow-hidden')
  else if (overflow === 'auto') classes.push('overflow-auto')
  else if (overflow === 'scroll') classes.push('overflow-scroll')

  return classes
}

import { LOCKED_CLASS } from './state'
/** Computed-style → space-joined Tailwind class string for an element. */
export function getTailwindClasses(el: Element): string {
  const htmlEl = el as HTMLElement
  htmlEl.classList.remove(LOCKED_CLASS)
  const styles = window.getComputedStyle(htmlEl)
  htmlEl.classList.add(LOCKED_CLASS)
  return mapCSSToTailwind(styles).join(' ')
}
