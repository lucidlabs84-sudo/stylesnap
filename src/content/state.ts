/**
 * Shared mutable state + cross-module constants.
 * State lives on a single object `S` so any module can mutate it
 * (`S.lockedElement = el`) — ES module `export let` bindings can't be
 * reassigned across modules, a plain object can.
 */
import type { ParsedCSS } from '@/shared/types'
import { $$ } from './ui'

export interface HistoryItem {
  el: Element
  tag: string
  selector: string
  snippet: string
  parsedCSS: ParsedCSS | null
  timestamp: number
}

export const S = {
  /** 0=Off 1=Inspect 2=Guidelines 3=Grid */
  inspectMode: 0,
  /** last non-zero mode, for UI hint only */
  lastMode: 0,
  lastHighlighted: null as Element | null,
  lockedElement: null as Element | null,
  compareMode: false,
  licenseIsPro: false,
  lastParsedCSS: null as ParsedCSS | null,
  /** Floating UI autoUpdate cleanup */
  overlayCleanup: null as (() => void) | null,
  /** generation counter to discard stale position updates */
  overlayGen: 0,
  history: [] as HistoryItem[],
  /** show the Box Model + Preview side panel (mirrors settings.showSidePanel) */
  showSidePanel: true,
}

// ─── Cross-module DOM id / class constants ────────────────────────────
// derived helpers
export const isActive = () => S.inspectMode > 0 && !$$('stylesnap-settings-popup') && !$$('stylesnap-design-popup')
export const assistMode = () => (S.inspectMode >= 2 ? S.inspectMode - 1 : 0) // 0=off, 1=lines, 2=grid

export const OVERLAY_ID = 'stylesnap-overlay'
export const HIGHLIGHT_CLASS = 'stylesnap-highlight'
export const LOCKED_CLASS = 'stylesnap-locked'
export const PREVIEW_CLASS = 'stylesnap-preview'
export const FLOATING_BTN_ID = 'stylesnap-floating-btn'
