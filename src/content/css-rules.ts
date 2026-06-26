/** Pure CSS-rule parsing helpers shared by getComponentCSS (core) and export. */

export function matchesAnyNode(treeNodes: Element[], selector: string): boolean {
  for (const node of treeNodes) {
    try { if (node.matches(selector)) return true } catch (_) {}
  }
  return false
}

/**
 * Parse CSS properties from raw rule body or full rule.cssText.
 * Handles both "prop: val; prop2: val2" and "selector { prop: val; }"
 */
export function parseRulePropsRaw(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!text) return result
  const body = text.match(/\{([^}]*)\}/)?.[1] || text
  for (const part of body.split(';')) {
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const prop = part.substring(0, idx).trim()
    const value = part.substring(idx + 1).trim()
    if (prop && value) result[prop] = value
  }
  return result
}

/** Extract pseudo-class from selector text. e.g. ".btn:hover" → "hover", else null */
export function extractPseudoFromSelector(selector: string): string | null {
  const m = selector.match(/:(hover|focus|active|visited|link|target)/)
  return m ? m[1] : null
}
