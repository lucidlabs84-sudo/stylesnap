/**
 * Export Worker — StyleSnap
 * Handles Tailwind mapping for export
 */

import { cssToTailwind } from './tailwind-mapper'
import type { ParsedCSS } from '@/shared/types'

type ExportFormat = 'tailwind' | 'css-module'
type StyleMode    = 'tailwind' | 'cssmodule' | 'inline'

interface WorkerMessage {
  type: 'export'
  format: ExportFormat
  styleMode: StyleMode
  element: ParsedCSS | null
}

interface WorkerResponse {
  code: string
  language: string
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, format, element } = event.data

  if (type !== 'export' || !element) {
    self.postMessage({ code: '// Select an element to export', language: 'js' })
    return
  }

  try {
    const { styles, selector } = element

    // Build base CSS text
    const cssText = Object.entries(styles)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n')

    let code = ''
    let language = 'js'

    switch (format) {
      case 'tailwind': {
        const { classes, unmatched, matchRate } = cssToTailwind(styles)
        const unmatchedEntries = Object.entries(unmatched)
        const unmatchedCSS = unmatchedEntries.length
          ? `\n/* Unmatched (${(100 - matchRate).toFixed(0)}%): */\n` +
            unmatchedEntries.map(([k, v]) => `/* ${k}: ${v}; */`).join('\n')
          : ''
        code = `/* ${matchRate.toFixed(0)}% matched via Tailwind */\n<div className="${classes.join(' ')}">\n  {/* ... */}\n</div>${unmatchedCSS}`
        language = 'jsx'
        break
      }
      case 'css-module': {
        const className = (selector ?? '.component').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+/, '')
        const mod = `.${className} {\n${cssText}\n}`
        const usage = `import styles from './Component.module.css'\n\n<div className={styles.${className}}>\n  {/* ... */}\n</div>`
        code = `${mod}\n\n/* Usage */\n${usage}`
        language = 'css'
        break
      }
    }

    self.postMessage({ code, language } as WorkerResponse)
  } catch (err) {
    self.postMessage({
      code: `// Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      language: 'js',
    })
  }
}
