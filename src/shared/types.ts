// ─────────────────────────────────────────────────────────────────────────────
// StyleSnap — Shared Types
// ─────────────────────────────────────────────────────────────────────────────

// ── CSS / Element ─────────────────────────────────────────────────────────────

export type CSSPropertyMap = Record<string, string>

export interface ParsedCSS {
  selector?: string
  styles: CSSPropertyMap
  /** Clean HTML of the element (events stripped) */
  html?: string
  /** Recursive component CSS (child elements included) */
  componentCSS?: string
  tailwindClasses?: string[]
  tailwindMatchRate?: number

  // 🆕 Responsive styles (grouped by media query)
  responsiveStyles?: Record<string, CSSPropertyMap>

  // 🆕 Responsive Tailwind classes (grouped by breakpoint)
  responsiveClasses?: Record<string, string[]>

  // 🆕 Interaction state styles
  interactionStyles?: {
    hover?: CSSPropertyMap
    focus?: CSSPropertyMap
    active?: CSSPropertyMap
  }

  // 🆕 Interaction state Tailwind classes
  interactionClasses?: {
    hover?: string[]
    focus?: string[]
    active?: string[]
  }

  // 🆕 Warning messages
  warnings?: string[]
}

export interface ElementInfo {
  tagName: string
  id: string
  classList: string[]
  selector: string
  rect: { width: number; height: number; top: number; left: number }
  computedStyles: CSSPropertyMap
}

// ── Design Tokens ─────────────────────────────────────────────────────────────

export interface ColorToken {
  name: string
  value: string       // hex
  rgb?: string
  hsl?: string
  usageCount: number
  role: 'primary' | 'secondary' | 'accent' | 'neutral' | 'background' | 'text' | 'border' | 'other'
}

/** Simplified – only extracts color palette */
export interface DesignTokens {
  colors: ColorToken[]
}

// ── Accessibility ───────────────────────────────────
export interface AccessibilityIssue {
  type: 'contrast' | 'focus' | 'font-size'
  severity: 'error' | 'warning'
  message: string
  contrastRatio?: number
  wcagLevel?: 'fail' | 'AA' | 'AAA'
}

// ── Messaging ─────────────────────────────────────────────────────────────────

export type MessageType =
  | 'INIT_INSPECTOR'
  | 'DISABLE_INSPECTOR'
  | 'ELEMENT_HOVERED'
  | 'ELEMENT_CLICKED'
  | 'EDIT_CSS'
  | 'EXTRACT_TOKENS'
  | 'TOKENS_RESULT'
  | 'CAPTURE_SCREENSHOT'
  | 'SCREENSHOT_RESULT'
  | 'CHECK_LICENSE'
  | 'LICENSE_STATUS'
  | 'GET_TAB_INFO'
  | 'COLLECT_ELEMENTS'

export interface Message<T = unknown> {
  type: MessageType
  payload?: T
  tabId?: number
}

// ── License ───────────────────────────────────────────────────────────────────

export interface LicenseStatus {
  isPro:              boolean
  email?:             string
  licenseKey?:        string
  instanceId?:        string        // DodoPayments activation instance ID (e.g. "lki_123")
  licenseKeyId?:      string        // DodoPayments license key ID (e.g. "lic_123") — for admin API calls
  customerName?:      string        // From activation response
  productName?:       string        // From activation response
  activationsUsed?:   number        // Current instance count
  activationsLimit?:  number        // Max allowed activations (null = unlimited)
  licenseStatus?:     'active' | 'expired' | 'disabled'  // DodoPayments key status
  expiresAt?:         string | null // Expiry date (null = never expires)
  activatedAt?:       string        // When this instance was activated
}

// ── User Settings ─────────────────────────────────────────────────────────────

export interface UserSettings {
  theme:            'light' | 'dark' | 'system'
  defaultTab:       'inspect' | 'export' | 'tokens'
  showOverlay:      boolean
  showFloatingBtn?: boolean
  autoInspect:      boolean
  copySound:        boolean
  assistMode:       0 | 1 | 2  // 0: Off, 1: Guidelines, 2: Grid
  aiApiKey?:        string
  /** Copy button format: 'css' copies raw CSS, 'tailwind' copies Tailwind classes */
  copyFormat?:      'css' | 'tailwind'
  /** Auto-copy CSS to clipboard when locking an element */
  autoCopyOnLock?:  boolean
  /** Overlay preferred side: 'right' (default) or 'left' */
  overlaySide?:     'right' | 'left'
  /** Show Tailwind classes in the overlay */
  showTailwindOverlay?: boolean
  /** Color display format in overlay */
  colorFormat?:     'rgb' | 'hex' | 'hsl'
  /** Shorten CSS output: remove unnecessary units, shorten colors, merge shorthand */
  shortenCSS?:      boolean
  /** Show the side panel (Box Model) next to the overlay when locked */
  showSidePanel?:   boolean
  /** Copy/export: include descendant (children) CSS rules. Default true. */
  copyChildren?:    boolean
  /** Copy/export: convert font-size rem units to px. Default false. */
  copyFontSizePx?:  boolean
  /** Copy/export: include the element's HTML too. Default false. */
  copyHtml?:        boolean
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme:            'system',
  defaultTab:        'inspect',
  showOverlay:       true,
  showFloatingBtn:  true,
  autoInspect:       false,
  copySound:         true,
  assistMode:        1,
  copyFormat:        'css',
  autoCopyOnLock:    false,
  overlaySide:       'right',
  showTailwindOverlay: true,
  colorFormat:       'rgb',
  shortenCSS:        true,
  showSidePanel:     true,
  copyChildren:      true,
  copyFontSizePx:    false,
  copyHtml:          false,
}

export interface StoredData {
  license:  LicenseStatus
  settings: UserSettings
}
