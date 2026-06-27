/**
 * CSS Rule Parser
 * Parses document.styleSheets to extract CSS rules for elements
 * Handles media queries and pseudo-class selectors
 */
import { CSSPropertyMap } from '@/shared/types'

export interface ParsedRule {
  selector: string
  styles: CSSPropertyMap
  mediaQuery?: string
  pseudoClass?: string
}

export interface ExtractedCSSRules {
  baseRules: ParsedRule[]
  mediaRules: ParsedRule[]
  pseudoClassRules: ParsedRule[]
  crossOriginWarning: boolean
}

/**
 * Parse all CSS rules that match the given element
 */
export function parseCSSRules(el: Element): ExtractedCSSRules {
  const result: ExtractedCSSRules = {
    baseRules: [],
    mediaRules: [],
    pseudoClassRules: [],
    crossOriginWarning: false,
  }

  for (const sheet of document.styleSheets) {
    // Skip StyleSnap's own injected stylesheet — otherwise its .stylesnap-locked /
    // .stylesnap-highlight rules (outline, cursor:crosshair, background) get matched
    // to the inspected element and pollute the captured/copied CSS.
    const ownerId = (sheet.ownerNode as Element | null)?.id || ''
    if (ownerId.startsWith('stylesnap')) continue

    // Check if the stylesheet is accessible (handle CORS)
    if (!canAccessSheet(sheet)) {
      result.crossOriginWarning = true
      continue
    }

    try {
      for (const rule of sheet.cssRules) {
        // 1. Regular style rules
        if (rule.type === CSSRule.STYLE_RULE) {
          const styleRule = rule as CSSStyleRule
          if (styleRule.selectorText && isElementMatchingSelector(el, styleRule.selectorText)) {
            const pseudoClass = extractPseudoClass(styleRule.selectorText)
            const parsedRule: ParsedRule = {
              selector: styleRule.selectorText,
              styles: ruleToPropertyMap(styleRule),
            }

            if (pseudoClass) {
              parsedRule.pseudoClass = pseudoClass
              result.pseudoClassRules.push(parsedRule)
            } else {
              result.baseRules.push(parsedRule)
            }
          }
        }

        // 2. Media query rules
        if (rule.type === CSSRule.MEDIA_RULE) {
          const mediaRule = rule as CSSMediaRule
          const mediaQuery = mediaRule.conditionText

          for (const childRule of mediaRule.cssRules) {
            if (childRule.type === CSSRule.STYLE_RULE) {
              const styleRule = childRule as CSSStyleRule
              if (styleRule.selectorText && isElementMatchingSelector(el, styleRule.selectorText)) {
                const pseudoClass = extractPseudoClass(styleRule.selectorText)
                const parsedRule: ParsedRule = {
                  selector: styleRule.selectorText,
                  styles: ruleToPropertyMap(styleRule),
                  mediaQuery,
                }

                if (pseudoClass) {
                  parsedRule.pseudoClass = pseudoClass
                }
                result.mediaRules.push(parsedRule)
              }
            }
          }
        }

        // 3. Supports rule (optional, for future extension)
        if (rule.type === CSSRule.SUPPORTS_RULE) {
          const supportsRule = rule as CSSSupportsRule
          for (const childRule of supportsRule.cssRules) {
            if (childRule.type === CSSRule.STYLE_RULE) {
              const styleRule = childRule as CSSStyleRule
              if (styleRule.selectorText && isElementMatchingSelector(el, styleRule.selectorText)) {
                result.baseRules.push({
                  selector: styleRule.selectorText,
                  styles: ruleToPropertyMap(styleRule),
                })
              }
            }
          }
        }
      }
    } catch (err) {
      // Silently handle errors (e.g., CORS issues)
      result.crossOriginWarning = true
    }
  }

  return result
}

/**
 * Check if a stylesheet is accessible (handle CORS)
 */
function canAccessSheet(sheet: CSSStyleSheet): boolean {
  try {
    // Accessing cssRules will throw SecurityError for cross-origin stylesheets
    return !!sheet.cssRules
  } catch {
    return false
  }
}

/**
 * Convert a CSSStyleRule to CSSPropertyMap
 * Uses cssText parsing to preserve CSS shorthand as-written
 * (iterating rule.style expands shorthands into longhands)
 */
function ruleToPropertyMap(rule: CSSStyleRule): CSSPropertyMap {
  const result: CSSPropertyMap = {}
  // Parse cssText to extract rules as-written (preserves shorthand)
  const cssText = rule.style.cssText
  if (cssText) {
    // Split by semicolon, each entry is "prop: value"
    const declarations = cssText.split(';')
    for (const decl of declarations) {
      const colonIdx = decl.indexOf(':')
      if (colonIdx === -1) continue
      const prop = decl.substring(0, colonIdx).trim()
      const value = decl.substring(colonIdx + 1).trim()
      if (prop && value) {
        result[prop] = value
      }
    }
  }
  return result
}

/**
 * Check if element matches a CSS selector
 * Handles errors for complex selectors
 */
function isElementMatchingSelector(el: Element, selector: string): boolean {
  try {
    // ✅ Remove ALL pseudo-classes before matching
    const baseSelector = selector.replace(/:(hover|focus|active|visited|link|target)/g, '')
    return el.matches(baseSelector)
  } catch {
    // Invalid selector, skip
    return false
  }
}

/**
 * Extract pseudo-class from selector (e.g., ".button:hover" → "hover")
 * Handles multiple pseudo-classes (returns the first one found)
 */
function extractPseudoClass(selector: string): string | null {
  // ✅ Find all pseudo-classes
  const pseudoMatches = selector.match(/:(hover|focus|active|visited|link|target)/g)
  if (!pseudoMatches || pseudoMatches.length === 0) {
    return null
  }

  // Return the first pseudo-class (for simplicity)
  // In the future, we could handle multiple pseudo-classes separately
  const firstPseudo = pseudoMatches[0].replace(':', '')
  return firstPseudo
}

/**
 * Merge multiple parsed rules into a single CSSPropertyMap
 * Later rules override earlier ones (cascading)
 */
export function mergeRules(rules: ParsedRule[]): CSSPropertyMap {
  const merged: CSSPropertyMap = {}
  for (const rule of rules) {
    Object.assign(merged, rule.styles)
  }
  return merged
}

/**
 * Group media rules by their media query
 */
export function groupMediaRules(rules: ParsedRule[]): Record<string, CSSPropertyMap> {
  const grouped: Record<string, CSSPropertyMap> = {}
  for (const rule of rules) {
    if (rule.mediaQuery) {
      if (!grouped[rule.mediaQuery]) {
        grouped[rule.mediaQuery] = {}
      }
      Object.assign(grouped[rule.mediaQuery], rule.styles)
    }
  }
  return grouped
}

/**
 * Group pseudo-class rules by their type
 */
export function groupPseudoClassRules(rules: ParsedRule[]): {
  hover?: CSSPropertyMap
  focus?: CSSPropertyMap
  active?: CSSPropertyMap
} {
  const result: {
    hover?: CSSPropertyMap
    focus?: CSSPropertyMap
    active?: CSSPropertyMap
  } = {}

  for (const rule of rules) {
    if (rule.pseudoClass === 'hover') {
      result.hover = { ...result.hover, ...rule.styles }
    } else if (rule.pseudoClass === 'focus') {
      result.focus = { ...result.focus, ...rule.styles }
    } else if (rule.pseudoClass === 'active') {
      result.active = { ...result.active, ...rule.styles }
    }
  }

  return result
}
