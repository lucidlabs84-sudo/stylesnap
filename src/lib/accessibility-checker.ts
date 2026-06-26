/**
 * Accessibility Checker — StyleSnap
 * WCAG contrast check + focus state check
 */
import type { AccessibilityIssue } from '@/shared/types'

// ─── Contrast ratio utils (WCAG 2.1) ──────────────────────

/** Convert sRGB channel (0-255) to linear RGB (0-1) */
function sRGBtoLinear(value: number): number {
  const v = value / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** Parse color string to { r, g, b } (0-255) or null */
function parseColorToRGB(color: string): { r: number; g: number; b: number } | null {
  if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return null

  // rgb(r, g, b)
  let m = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)
  if (m) return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) }

  // rgba(r, g, b, a)
  m = color.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/)
  if (m && parseFloat(m[4]) > 0) return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) }

  // hex #rgb or #rrggbb
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      }
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      }
    }
  }

  return null
}

/** Calculate relative luminance (WCAG 2.1 definition) */
function relativeLuminance(r: number, g: number, b: number): number {
  const R = sRGBtoLinear(r)
  const G = sRGBtoLinear(g)
  const B = sRGBtoLinear(b)
  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

/** Calculate contrast ratio between two colors (WCAG 2.1) */
export function calculateContrastRatio(
  foreground: string,
  background: string
): number | null {
  const fg = parseColorToRGB(foreground)
  const bg = parseColorToRGB(background)
  if (!fg || !bg) return null

  const L1 = relativeLuminance(fg.r, fg.g, fg.b)
  const L2 = relativeLuminance(bg.r, bg.g, bg.b)
  const lighter = Math.max(L1, L2)
  const darker = Math.min(L1, L2)

  return (lighter + 0.05) / (darker + 0.05)
}

/** Check WCAG compliance */
export function checkWCAGCompliance(contrastRatio: number, isLargeText: boolean): {
  AA: boolean
  AAA: boolean
  level: 'fail' | 'AA' | 'AAA'
} {
  const AA_THRESHOLD = isLargeText ? 3 : 4.5
  const AAA_THRESHOLD = isLargeText ? 4.5 : 7

  const AA = contrastRatio >= AA_THRESHOLD
  const AAA = contrastRatio >= AAA_THRESHOLD

  let level: 'fail' | 'AA' | 'AAA' = 'fail'
  if (AAA) level = 'AAA'
  else if (AA) level = 'AA'

  return { AA, AAA, level }
}

// ─── Main checker ────────────────────────────────────────────────

/** Check element's accessibility */
export function checkElementAccessibility(el: Element): AccessibilityIssue[] {
  const issues: AccessibilityIssue[] = []
  const computed = window.getComputedStyle(el)

  // 1. Color contrast check
  const color = computed.color
  const backgroundColor = computed.backgroundColor

  if (color && backgroundColor && color !== backgroundColor) {
    const contrastRatio = calculateContrastRatio(color, backgroundColor)
    if (contrastRatio !== null) {
      const fontSize = parseFloat(computed.fontSize)
      const fontWeight = parseInt(computed.fontWeight)
      const isLargeText = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700)
      const wcag = checkWCAGCompliance(contrastRatio, isLargeText)

      if (!wcag.AA) {
        issues.push({
          type: 'contrast',
          severity: contrastRatio < 3 ? 'error' : 'warning',
          message: `Contrast ratio ${contrastRatio.toFixed(2)}:1 — fails WCAG AA (needs ≥ ${isLargeText ? '3' : '4.5'}:1)`,
          contrastRatio,
          wcagLevel: wcag.level,
        })
      }
    }
  }

  // 2. Focus state check
  const tagName = el.tagName.toLowerCase()
  if (['a', 'button', 'input', 'select', 'textarea'].includes(tagName)) {
    // Check if :focus style is defined (simplified check)
    const hasOutline = computed.outlineStyle !== 'none' && parseInt(computed.outlineWidth) > 0
    const hasFocusStyle = hasOutline
    if (!hasFocusStyle) {
      issues.push({
        type: 'focus',
        severity: 'warning',
        message: `<${tagName}> 缺少 :focus 样式 — 键盘导航用户无法看到焦点状态`,
      })
    }
  }

  // 3. Font size check (too small?)
  const fontSize = parseFloat(computed.fontSize)
  if (fontSize > 0 && fontSize < 12) {
    issues.push({
      type: 'font-size',
      severity: 'warning',
      message: `Font size ${fontSize}px is too small — recommended ≥ 12px for readability`,
    })
  }

  return issues
}

/** Check entire page (sample up to 50 visible elements) */
export function checkPageAccessibility(): AccessibilityIssue[] {
  const allIssues: AccessibilityIssue[] = []
  const allElements = document.querySelectorAll('*')
  const maxChecks = 50

  for (let i = 0; i < Math.min(allElements.length, maxChecks); i++) {
    const el = allElements[i]
    const tag = el.tagName.toLowerCase()
    if (['script', 'style', 'noscript', 'meta', 'link', 'head'].includes(tag)) continue

    const issues = checkElementAccessibility(el)
    allIssues.push(...issues)
  }

  return allIssues
}
