/**
 * Design Token Extractor (Simplified)
 * Only extracts color palette for the color board
 */
import type { ColorToken, DesignTokens } from '@/shared/types'

// ─── Color utilities ─────────────────────────────────────────────────

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('')
}

function parseColor(value: string): { r: number; g: number; b: number; a: number } | null {
  if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return null

  let m = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)
  if (m) return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]), a: 1 }

  m = value.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/)
  if (m) {
    const a = parseFloat(m[4])
    if (a === 0) return null
    return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]), a }
  }

  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if (hex.length === 3) {
      return { r: parseInt(hex[0] + hex[0], 16), g: parseInt(hex[1] + hex[1], 16), b: parseInt(hex[2] + hex[2], 16), a: 1 }
    }
    if (hex.length === 6) {
      return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 }
    }
  }

  return null
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

function colorDistance(c1: { r: number; g: number; b: number }, c2: { r: number; g: number; b: number }): number {
  return Math.sqrt(Math.pow(c1.r - c2.r, 2) + Math.pow(c1.g - c2.g, 2) + Math.pow(c1.b - c2.b, 2))
}

// Group similar colors (within threshold)
function clusterColors(colors: Array<{ color: { r: number; g: number; b: number; a: number }; selector: string }>): ColorToken[] {
  const clusters: Array<{ center: { r: number; g: number; b: number; a: number }; members: typeof colors }> = []
  const THRESHOLD = 20

  for (const item of colors) {
    let nearest = -1
    let minDist = Infinity

    for (let i = 0; i < clusters.length; i++) {
      const dist = colorDistance(item.color, clusters[i].center)
      if (dist < minDist) {
        minDist = dist
        nearest = i
      }
    }

    if (nearest >= 0 && minDist < THRESHOLD) {
      clusters[nearest].members.push(item)
      // Update center to mean
      const m = clusters[nearest].members
      clusters[nearest].center = {
        r: m.reduce((s, x) => s + x.color.r, 0) / m.length,
        g: m.reduce((s, x) => s + x.color.g, 0) / m.length,
        b: m.reduce((s, x) => s + x.color.b, 0) / m.length,
        a: m.reduce((s, x) => s + x.color.a, 0) / m.length,
      }
    } else {
      clusters.push({ center: { ...item.color }, members: [item] })
    }
  }

  return clusters
    .filter(c => c.members.length >= 1)
    .sort((a, b) => b.members.length - a.members.length)
    .map((c, i) => {
      const { r, g, b } = c.center
      const hex = rgbToHex(r, g, b)
      const [h, s, l] = rgbToHsl(r, g, b)

      // Determine role
      let role: ColorToken['role'] = 'other'
      if (l > 90) role = 'background'
      else if (l < 10) role = 'text'
      else if (s < 10) role = 'neutral'
      else if (i === 0) role = 'primary'
      else if (i === 1) role = 'secondary'
      else role = 'accent'

      return {
        name: `color-${i + 1}`,
        value: hex,
        rgb: `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`,
        hsl: `hsl(${h}, ${s}%, ${l}%)`,
        usageCount: c.members.length,
        role,
      }
    })
}

// ─── Main extractor ──────────────────────────────────────────────────

interface RawColorEntry {
  color: { r: number; g: number; b: number; a: number }
  selector: string
}

export function extractDesignTokens(): DesignTokens {
  const colorEntries: RawColorEntry[] = []

  const getSelector = (el: Element): string => {
    if (el.id) return `#${el.id}`
    const classes = Array.from(el.classList).slice(0, 2).join('.')
    return classes ? `.${classes}` : el.tagName.toLowerCase()
  }

  // Traverse all visible elements
  const allElements = document.querySelectorAll('*')

  for (const el of Array.from(allElements)) {
    // Skip hidden, script, style elements
    const tag = el.tagName.toLowerCase()
    if (['script', 'style', 'noscript', 'meta', 'link', 'head'].includes(tag)) continue

    const computed = window.getComputedStyle(el)
    const selector = getSelector(el)

    // Only extract colors
    const colorProps = ['color', 'background-color', 'border-color', 'fill', 'stroke']
    for (const prop of colorProps) {
      const val = computed.getPropertyValue(prop)
      if (val) {
        const parsed = parseColor(val)
        if (parsed) colorEntries.push({ color: parsed, selector })
      }
    }
  }

  // Compile colors
  const colors = clusterColors(colorEntries)
    .slice(0, 20) // Top 20 colors

  return { colors }
}
