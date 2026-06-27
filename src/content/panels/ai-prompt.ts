/** AI prompt generator — paste-ready prompt from locked element.
 *  Infers interactive behaviors from ARIA annotations,
 *  structures the prompt so AI outputs a production-grade
 *  React + TypeScript + Tailwind component. */

import { $$, stAppend, showToast, classNameOf, closeHintPopups } from '../ui'
import { S, LOCKED_CLASS } from '../state'
import { mapCSSToTailwind } from '../tailwind'
import type { ParsedCSS } from '@/shared/types'

// ═══════════════════════════════════════════════════════════
// 1. ARIA → Behavior Inference Engine
// ═══════════════════════════════════════════════════════════

interface InferredBehavior {
  /** Human-readable pattern name (e.g. "Tab Navigation") */
  pattern: string
  /** What the component IS (purpose) */
  description: string
  /** Interaction rules the AI must implement */
  interactions: string[]
  /** Related ARIA states to manage */
  stateManagement: string[]
}

/** Walk element + descendants, collect all ARIA attributes into a flat set. */
function collectARIA(el: Element, depth = 0): { role: string | null; attrs: Record<string, string>; nestedRoles: string[] } {
  if (depth > 8) return { role: null, attrs: {}, nestedRoles: [] }
  const role = el.getAttribute('role')
  const attrs: Record<string, string> = {}
  for (const a of el.getAttributeNames()) {
    if (a.startsWith('aria-')) attrs[a] = el.getAttribute(a) || ''
  }
  const nestedRoles: string[] = role ? [role] : []
  for (const child of Array.from(el.children)) {
    const c = collectARIA(child, depth + 1)
    nestedRoles.push(...c.nestedRoles)
  }
  return { role, attrs, nestedRoles }
}

/** Infer component interaction pattern from ARIA annotations. */
function inferBehavior(el: Element): InferredBehavior | null {
  const { role, attrs, nestedRoles } = collectARIA(el)
  const hasRole = (r: string) => role === r || nestedRoles.includes(r)
  const interactions: string[] = []
  const stateMgmt: string[] = []

  // ── Keyboard interaction inferring ──
  const getKeyboardInteractions = (pattern: string): string[] => {
    switch (pattern) {
      case 'Tab Navigation':
        return [
          'ArrowLeft/ArrowRight moves focus between tabs',
          'Home/End jumps to first/last tab',
          'Enter or Space activates the focused tab',
          'Tab key only moves focus into the tab list, not between tabs (roving tabindex)',
        ]
      case 'Dropdown Menu':
        return [
          'ArrowUp/ArrowDown navigates items',
          'Enter or Space selects the focused item',
          'Escape closes the menu and returns focus to trigger',
          'Click outside or Tab out closes the menu',
        ]
      case 'Disclosure (Expand/Collapse)':
        return [
          'Enter or Space toggles expanded state',
          'Click on the trigger toggles expanded state',
        ]
      case 'Toggle / Switch':
        return ['Space or Enter toggles state', 'Click toggles state']
      case 'Modal Dialog':
        return [
          'Escape closes the dialog',
          'Click on backdrop closes the dialog',
          'Focus is trapped inside while open',
          'Focus returns to trigger element on close',
        ]
      case 'Combobox / Autocomplete':
        return [
          'ArrowUp/ArrowDown navigates suggestions',
          'Enter selects the highlighted suggestion',
          'Escape closes the suggestion list',
          'Typing filters suggestions',
        ]
      case 'Accordion':
        return [
          'Enter or Space expands/collapses the panel',
          'Tab moves between accordion headers',
        ]
      default: return []
    }
  }

  // ── Pattern detection ──

  // Tab Navigation: role="tablist" with role="tab" children
  if (hasRole('tablist') && nestedRoles.includes('tab')) {
    interactions.push(...getKeyboardInteractions('Tab Navigation'))
    interactions.push('Clicking a tab shows its associated tabpanel and hides others')
    if (attrs['aria-orientation']) {
      interactions.push(`Tab list is ${attrs['aria-orientation']} oriented`)
    }
    stateMgmt.push('activeTab (string | number) — currently selected tab')
    stateMgmt.push('aria-selected on the active tab')
    stateMgmt.push('aria-labelledby on tabpanels referencing their tab')
    return {
      pattern: 'Tab Navigation',
      description: 'A tabbed interface where clicking tabs reveals associated content panels. Only one tab is active at a time.',
      interactions,
      stateManagement: stateMgmt,
    }
  }

  // Dropdown Menu: role="menu" or role="listbox"
  if (hasRole('menu') || hasRole('listbox')) {
    interactions.push(...getKeyboardInteractions('Dropdown Menu'))
    if (hasRole('menu')) stateMgmt.push('isOpen (boolean) — menu visibility state')
    if (attrs['aria-activedescendant']) {
      stateMgmt.push('activeDescendant (string) — ID of currently focused item')
    }
    return {
      pattern: hasRole('listbox') ? 'Listbox / Select' : 'Dropdown Menu',
      description: 'A popup menu/list that shows/hides on trigger interaction with keyboard navigation support.',
      interactions,
      stateManagement: stateMgmt,
    }
  }

  // Disclosure / Expandable
  if (role === 'button' && attrs['aria-expanded'] !== undefined) {
    interactions.push(...getKeyboardInteractions('Disclosure (Expand/Collapse)'))
    stateMgmt.push('isExpanded (boolean) — controlled by aria-expanded')
    if (attrs['aria-controls']) {
      stateMgmt.push(`Controls element #${attrs['aria-controls']} — show/hide based on isExpanded`)
    }
    return {
      pattern: 'Disclosure (Expand/Collapse)',
      description: 'A trigger button that toggles visibility of associated content. Common in accordions, "Show more", FAQ sections.',
      interactions,
      stateManagement: stateMgmt,
    }
  }

  // Toggle / Switch
  if (role === 'switch' || role === 'checkbox' || attrs['aria-pressed'] !== undefined) {
    interactions.push(...getKeyboardInteractions('Toggle / Switch'))
    if (role === 'switch') {
      stateMgmt.push('isChecked (boolean) — controlled by aria-checked')
      return {
        pattern: 'Toggle / Switch',
        description: 'A binary on/off toggle. Visually indicates state and announces changes to screen readers.',
        interactions,
        stateManagement: stateMgmt,
      }
    }
    if (attrs['aria-pressed'] !== undefined) {
      stateMgmt.push('isPressed (boolean) — controlled by aria-pressed')
      return {
        pattern: 'Toggle Button',
        description: 'A button that stays pressed/unpressed like a toggle. Used for formatting controls, view modes.',
        interactions,
        stateManagement: stateMgmt,
      }
    }
    stateMgmt.push('isChecked (boolean) — controlled by aria-checked')
    return {
      pattern: 'Checkbox',
      description: 'A selectable checkbox with clear checked/unchecked state.',
      interactions,
      stateManagement: stateMgmt,
    }
  }

  // Dialog/Modal
  if (hasRole('dialog') || role === 'alertdialog') {
    interactions.push(...getKeyboardInteractions('Modal Dialog'))
    stateMgmt.push('isOpen (boolean) — dialog visibility')
    stateMgmt.push('useEffect to manage body scroll lock when open')
    stateMgmt.push('useRef for trigger element to restore focus on close')
    return {
      pattern: 'Modal Dialog',
      description: 'A modal overlay dialog that blocks page interaction until dismissed. Uses portal or absolute positioning.',
      interactions,
      stateManagement: stateMgmt,
    }
  }

  // Combobox / Autocomplete
  if (hasRole('combobox')) {
    interactions.push(...getKeyboardInteractions('Combobox / Autocomplete'))
    stateMgmt.push('isOpen (boolean) — dropdown visibility')
    stateMgmt.push('inputValue (string) — current input text')
    stateMgmt.push('activeIndex (number) — highlighted suggestion index')
    if (attrs['aria-autocomplete']) {
      stateMgmt.push(`Autocomplete mode: ${attrs['aria-autocomplete']}`)
    }
    return {
      pattern: 'Combobox / Autocomplete',
      description: 'An input with dropdown suggestions that filters as the user types. Supports keyboard selection.',
      interactions,
      stateManagement: stateMgmt,
    }
  }

  // Accordion
  if (role === 'button' && nestedRoles.filter(r => r === 'region').length >= 1) {
    interactions.push(...getKeyboardInteractions('Accordion'))
    stateMgmt.push('expandedIndex (number | null) — which panel is open')
    stateMgmt.push('aria-expanded on the trigger button')
    stateMgmt.push('aria-labelledby on the panel referencing the trigger')
    return {
      pattern: 'Accordion',
      description: 'A vertically stacked set of expandable sections where clicking a header reveals its content.',
      interactions,
      stateManagement: stateMgmt,
    }
  }

  // ── Partial / Heuristic inference ──

  // aria-expanded on non-button element
  if (attrs['aria-expanded'] !== undefined && role !== 'button') {
    return {
      pattern: 'Expandable Section',
      description: 'An element whose visibility/expansion state is tracked via aria-expanded.',
      interactions: ['Click on associated trigger toggles expanded state'],
      stateManagement: ['isExpanded (boolean)'],
    }
  }

  // aria-selected
  if (attrs['aria-selected'] !== undefined) {
    return {
      pattern: 'Selectable Item',
      description: 'An item that can be selected within a list/grid. Part of a larger selection group.',
      interactions: ['Click selects this item and deselects others in the group', 'May support multi-select (check for aria-multiselectable on parent)'],
      stateManagement: ['selected (boolean) — controlled by aria-selected'],
    }
  }

  // aria-sort on a column header
  if (attrs['aria-sort']) {
    return {
      pattern: 'Sortable Column',
      description: 'A table column header that can be clicked to sort data.',
      interactions: [`Current sort: ${attrs['aria-sort']}`, 'Click toggles sort direction (asc → desc → none)'],
      stateManagement: ['sortKey (string)', 'sortDirection ("asc" | "desc" | null)'],
    }
  }

  // aria-live for dynamic content
  if (attrs['aria-live']) {
    return {
      pattern: 'Live Region',
      description: `A region that announces content changes to screen readers (politeness: ${attrs['aria-live']}).`,
      interactions: ['Content updates automatically — use aria-live for accessible announcements'],
      stateManagement: ['Dynamic content managed by parent component'],
    }
  }

  // Generic button
  if (role === 'button') {
    if (attrs['aria-haspopup']) {
      return {
        pattern: 'Popup Trigger Button',
        description: 'A button that opens a popup (menu, dialog, listbox, etc.).',
        interactions: ['Click opens the associated popup', 'Enter or Space opens the popup'],
        stateManagement: ['isOpen (boolean)', `Popup type: ${attrs['aria-haspopup']}`],
      }
    }
    return {
      pattern: 'Button',
      description: 'An interactive button element.',
      interactions: ['Enter or Space activates the button action', 'Click triggers onClick handler'],
      stateManagement: [],
    }
  }

  // aria-disabled anywhere
  if (attrs['aria-disabled'] === 'true') {
    return {
      pattern: 'Disabled Element',
      description: 'An element that is currently disabled/inactive.',
      interactions: ['Element is NOT interactive — all events should be prevented or no-oped'],
      stateManagement: ['isDisabled (boolean)'],
    }
  }

  // aria-current (breadcrumbs, navigation)
  if (attrs['aria-current']) {
    return {
      pattern: 'Current Indicator',
      description: `Marks the current item within a set (${attrs['aria-current']}). Used in breadcrumbs, pagination, navigation.`,
      interactions: ['This item is visually highlighted as "current"', 'Other sibling items are clickable links'],
      stateManagement: [],
    }
  }

  return null
}

/** Collect notable descendant ARIA roles (for context in prompt). */
function collectChildBehaviors(el: Element, depth = 0): InferredBehavior[] {
  if (depth > 6) return []
  const results: InferredBehavior[] = []
  for (const child of Array.from(el.children)) {
    const b = inferBehavior(child)
    if (b) results.push(b)
    results.push(...collectChildBehaviors(child, depth + 1))
  }
  return results
}

// ═══════════════════════════════════════════════════════════
// 2. Element Context Extraction
// ═══════════════════════════════════════════════════════════

function extractDOMSummary(el: Element, depth = 0): string {
  if (depth > 5) return ''
  const tag = el.tagName.toLowerCase()
  const id = el.id ? ` id="${el.id}"` : ''
  const cls = classNameOf(el).replace(/stylesnap-\S+/g, '').trim()
  const classStr = cls ? ` class="${cls}"` : ''
  const attrs: string[] = []
  for (const a of el.getAttributeNames()) {
    if (a === 'id' || a === 'class' || a.startsWith('data-stylesnap')) continue
    if (a.startsWith('aria-') || a === 'role') {
      attrs.push(` ${a}="${el.getAttribute(a)}"`)
    }
  }
  const children = Array.from(el.children).slice(0, 6)
    .map(c => extractDOMSummary(c, depth + 1))
    .filter(Boolean)
    .join('')
  const indent = '  '.repeat(depth)
  if (children) {
    return `${indent}<${tag}${id}${classStr}${attrs.join('')}>\n${children}${indent}</${tag}>\n`
  }
  const text = (el.textContent || '').trim().substring(0, 50)
  return `${indent}<${tag}${id}${classStr}${attrs.join('')}>${text ? ` ${text} ` : ''}</${tag}>\n`
}

function extractAnimations(el: Element): string {
  const anims = (el as HTMLElement).getAnimations?.() || []
  if (anims.length === 0) return ''
  return anims.map(a => {
    const effect = a.effect as KeyframeEffect | null
    const timing = effect?.getTiming() || {}
    const kfs = effect?.getKeyframes() || []
    const kfLines = kfs.map((k, i) => {
      const pct = k.offset !== undefined ? `${Math.round((k.offset as number) * 100)}%` : i === 0 ? '0%' : '100%'
      const props = Object.entries(k).filter(([key]) => key !== 'offset' && key !== 'computedOffset' && key !== 'easing').map(([k, v]) => `    ${k}: ${v}`).join(';\n')
      return `  ${pct} {\n${props};\n  }`
    }).join('\n')
    return `@keyframes ${a.id || 'anim'} {\n${kfLines}\n}\nanimation: ${a.id || 'anim'} ${timing.duration || 300}ms ${timing.easing || 'ease'} ${timing.iterations === Infinity ? 'infinite' : ''}`
  }).join('\n\n')
}

/** Summarise interaction states from ParsedCSS. */
function extractInteractionSummary(pc: ParsedCSS): string {
  const parts: string[] = []

  if (pc.interactionStyles) {
    for (const [state, props] of Object.entries(pc.interactionStyles)) {
      if (!props || Object.keys(props).length === 0) continue
      const keyChanges = Object.entries(props)
        .filter(([, v]) => v !== 'initial' && v !== 'inherit' && v !== 'unset')
        .slice(0, 8)
      if (keyChanges.length === 0) continue
      const lines = keyChanges.map(([k, v]) => `    ${k}: ${v}`).join('\n')
      parts.push(`  :${state}:\n${lines}`)
    }
  }

  if (pc.interactionClasses) {
    for (const [state, classes] of Object.entries(pc.interactionClasses)) {
      if (!classes || classes.length === 0) continue
      parts.push(`  Tailwind ${state}: ${classes.join(' ')}`)
    }
  }

  if (pc.responsiveStyles) {
    for (const [query, props] of Object.entries(pc.responsiveStyles)) {
      if (!props || Object.keys(props).length === 0) continue
      const keyChanges = Object.entries(props)
        .filter(([, v]) => v !== 'initial' && v !== 'inherit' && v !== 'unset')
        .slice(0, 6)
      if (keyChanges.length === 0) continue
      parts.push(`  @media ${query}:`)
      keyChanges.forEach(([k, v]) => parts.push(`    ${k}: ${v}`))
    }
  }

  return parts.join('\n')
}

// ═══════════════════════════════════════════════════════════
// 3. Prompt Builder
// ═══════════════════════════════════════════════════════════

type Framework = 'react' | 'vue' | 'html'

function buildPrompt(fw: Framework): string {
  const el = S.lockedElement as HTMLElement
  if (!el) return '// No element locked'

  const styles = window.getComputedStyle(el)
  const tw = mapCSSToTailwind(styles)
  const dom = extractDOMSummary(el)
  const anim = extractAnimations(el)
  const tagName = el.tagName.toLowerCase()
  const twClassStr = tw.join(' ')
  const pc = S.lastParsedCSS

  // CSS key properties (non-default, meaningful)
  const cssLines: string[] = []
  if (pc?.styles) {
    for (const [k, v] of Object.entries(pc.styles).slice(0, 25)) {
      if (v === 'initial' || v === 'inherit') continue
      cssLines.push(`  ${k}: ${v};`)
    }
  }

  // Interaction states
  const interactionSummary = pc ? extractInteractionSummary(pc) : ''

  // ARIA behavior inference
  const behavior = inferBehavior(el)
  const childBehaviors = collectChildBehaviors(el)

  // ── Build sections ──

  const sections: string[] = []

  // Section 0: Role
  sections.push('You are a senior frontend engineer. Convert this element into a production-grade component.')

  // Section 1: Visual Style
  const visualParts: string[] = []
  if (twClassStr) visualParts.push(`Tailwind: ${twClassStr}`)
  if (cssLines.length > 0) visualParts.push(`CSS:\n${cssLines.join('\n')}`)
  if (anim) visualParts.push(`Animations:\n${anim}`)
  sections.push(`## Visual Style\n${visualParts.join('\n\n')}`)

  // Section 2: DOM Structure
  sections.push(`## DOM Structure\n\`\`\`html\n${dom || `<${tagName} />`}\`\`\``)

  // Section 3: Interactive Behavior (ARIA-inferred)
  if (behavior) {
    const bParts: string[] = []
    bParts.push(`Pattern: **${behavior.pattern}**`)
    if (behavior.description) bParts.push(behavior.description)
    if (behavior.interactions.length > 0) {
      bParts.push('\nInteractions:')
      behavior.interactions.forEach(i => bParts.push(`- ${i}`))
    }
    if (behavior.stateManagement.length > 0) {
      bParts.push('\nState to manage:')
      behavior.stateManagement.forEach(s => bParts.push(`- ${s}`))
    }
    sections.push(`## Interactive Behavior (ARIA-inferred)\n${bParts.join('\n')}`)
  }

  // Child behaviors
  if (childBehaviors.length > 0) {
    const cbParts = childBehaviors.map(b => {
      const lines = [`- **${b.pattern}**: ${b.description}`]
      if (b.interactions.length > 0) lines.push(...b.interactions.map(i => `  - ${i}`))
      return lines.join('\n')
    })
    sections.push(`## Child Component Behaviors\n${cbParts.join('\n\n')}`)
  }

  // Section 4: States (hover, focus, active, responsive)
  if (interactionSummary) {
    sections.push(`## Interaction States & Responsive\n${interactionSummary}`)
  }

  // Section 5: Requirements (framework-specific)
  const reqParts: string[] = []

  if (fw === 'react') {
    reqParts.push('## Requirements')
    reqParts.push('- React functional component with TypeScript (FC or function with explicit return type)')
    reqParts.push('- Use all Tailwind classes exactly as provided')
    reqParts.push('- Preserve DOM structure and ALL ARIA attributes for accessibility')
    if (behavior) {
      reqParts.push('- Implement the full interaction pattern described above (keyboard, focus management, state)')
    }
    reqParts.push('- Use React hooks (useState, useEffect, useRef, useCallback) as needed')
    reqParts.push('- Include a Props interface with className and any configurable options')
    reqParts.push('- Export as default')
    reqParts.push('- No explanation — output ONLY TypeScript TSX code in a single markdown code block')
  } else if (fw === 'vue') {
    reqParts.push('## Requirements')
    reqParts.push('- Vue 3 <script setup lang="ts"> syntax')
    reqParts.push('- Use all Tailwind classes exactly as provided')
    reqParts.push('- Preserve DOM structure and ALL ARIA attributes for accessibility')
    if (behavior) {
      reqParts.push('- Implement the full interaction pattern described above (keyboard, focus management, state)')
    }
    reqParts.push('- Use ref, computed, watch as needed')
    reqParts.push('- Define Props with defineProps<{...}>()')
    reqParts.push('- Export component as default in <script setup>')
    reqParts.push('- No explanation — output ONLY Vue SFC code in a single markdown code block')
  } else {
    reqParts.push('## Requirements')
    reqParts.push('- Clean, semantic HTML5')
    reqParts.push('- Use all Tailwind classes exactly as provided')
    reqParts.push('- Preserve ALL ARIA attributes for accessibility')
    if (behavior) {
      reqParts.push('- Add minimal inline JavaScript for the described interactions')
    }
    reqParts.push('- No explanation — output ONLY HTML code in a single markdown code block')
  }

  sections.push(reqParts.join('\n'))

  return sections.join('\n\n')
}

// ═══════════════════════════════════════════════════════════
// 4. UI Panel (keeps existing centered-modal style)
// ═══════════════════════════════════════════════════════════

export function showAIPrompt() {
  if (!S.lockedElement) { showToast('Lock an element first'); return }

  const el = S.lockedElement as HTMLElement
  el.classList.remove(LOCKED_CLASS)
  el.classList.add(LOCKED_CLASS) // keep lock visual

  $$('stylesnap-ai-prompt-panel')?.remove()
  closeHintPopups('stylesnap-ai-prompt-panel')

  const panel = document.createElement('div')
  panel.id = 'stylesnap-ai-prompt-panel'
  panel.setAttribute('data-stylesnap', 'true')

  let currentFw: Framework = 'react'

  const SVG_COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`

  const behavior = inferBehavior(el)
  const childBehaviors = collectChildBehaviors(el)

  const render = () => {
    const tabs: Array<{id: Framework; label: string}> = [
      {id: 'react', label: 'React / TSX'},
      {id: 'vue',   label: 'Vue 3'},
      {id: 'html',  label: 'HTML'},
    ]

    // Behavior badge — shows inferred pattern
    const behaviorBadge = behavior
      ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
          <span style="background:rgba(167,139,250,0.16);color:#c4b5fd;font-size:10px;padding:2px 8px;border-radius:4px;font-weight:600;">${behavior.pattern}</span>
          ${childBehaviors.length > 0 ? `<span style="color:#64748b;font-size:10px;">+${childBehaviors.length} child interactions</span>` : ''}
        </div>`
      : ''

    panel.innerHTML = `
      <div id="ss-ai-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999996;"></div>
      <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(680px,92vw);max-height:86vh;background:var(--ss-bg-card);border:1px solid rgba(99,102,241,0.28);border-radius:10px;display:flex;flex-direction:column;z-index:9999997;box-shadow:0 8px 48px rgba(0,0,0,0.55);font-family:system-ui,sans-serif;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="display:flex;align-items:center;gap:8px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 3 9.2 8.5 3.3 9.6l4.2 4.3-1 6.1 5.5-2.9 5.5 2.9-1-6.1 4.2-4.3-5.9-1.1Z"/></svg>
            <span style="font-size:13px;font-weight:600;color:#e2e8f0;">AI Prompt</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:10px;color:#475569;">Paste into Claude, ChatGPT, or Cursor</span>
            <button id="ss-ai-close" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;padding:0 2px;line-height:1;">&times;</button>
          </div>
        </div>
        ${behaviorBadge ? `<div style="padding:0 16px;">${behaviorBadge}</div>` : ''}
        <div style="display:flex;gap:4px;padding:0 16px;">
          ${tabs.map(t => `<button data-fw="${t.id}" style="background:${t.id===currentFw ? 'var(--ss-primary-border)' : 'rgba(255,255,255,0.04)'};border:1px solid ${t.id===currentFw ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.07)'};color:${t.id===currentFw ? 'var(--ss-primary-lighter)' : '#64748b'};border-radius:5px;padding:4px 12px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.12s;">${t.label}</button>`).join('')}
        </div>
        <div class="ss-hint-scroll" style="flex:1;overflow:auto;padding:10px 16px;">
          <textarea id="ss-ai-textarea" readonly class="ss-hint-scroll" style="width:100%;height:320px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.07);border-radius:6px;color:#94a3b8;font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.65;padding:10px 12px;resize:none;outline:none;box-sizing:border-box;"></textarea>
        </div>
        <div style="padding:10px 16px 14px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid rgba(255,255,255,0.06);">
          <span style="font-size:10px;color:#475569;">${behavior ? `Behavior: ${behavior.pattern} detected` : 'No ARIA pattern detected — visual-only prompt'}</span>
          <button id="ss-ai-copy" style="display:flex;align-items:center;gap:6px;background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.38);color:var(--ss-primary-lighter);border-radius:6px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;transition:all 0.15s;">${SVG_COPY} Copy Prompt</button>
        </div>
      </div>
    `

    // Set textarea value directly to avoid HTML entity issues
    const ta = panel.querySelector('#ss-ai-textarea') as HTMLTextAreaElement
    if (ta) ta.value = buildPrompt(currentFw)

    panel.querySelector('#ss-ai-close')?.addEventListener('click', () => panel.remove())
    panel.querySelector('#ss-ai-backdrop')?.addEventListener('click', () => panel.remove())

    panel.querySelectorAll('[data-fw]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentFw = (btn as HTMLElement).dataset.fw as Framework
        render()
      })
    })

    panel.querySelector('#ss-ai-copy')?.addEventListener('click', () => {
      navigator.clipboard.writeText(buildPrompt(currentFw)).then(() => {
        const btn = panel.querySelector('#ss-ai-copy') as HTMLElement | null
        if (!btn) return
        const origHTML = btn.innerHTML, origBg = btn.style.background, origBorder = btn.style.borderColor, origColor = btn.style.color
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg> Copied!`
        btn.style.background = 'rgba(52,211,153,0.18)'
        btn.style.borderColor = 'rgba(52,211,153,0.4)'
        btn.style.color = '#34d399'
        setTimeout(() => {
          if (!btn.isConnected) return
          btn.innerHTML = origHTML
          btn.style.background = origBg
          btn.style.borderColor = origBorder
          btn.style.color = origColor
        }, 1800)
      }).catch(() => showToast('Copy failed'))
    })
  }

  render()
  stAppend(panel)
}
