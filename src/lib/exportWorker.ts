/**
 * Export Worker — StyleSnap
 * Handles heavy export calculations (Tailwind mapping, React/Vue generation)
 * Offloads main thread for smooth UI.
 */

import { cssToTailwind } from './tailwind-mapper'
import { generateReactComponent, generateVueComponent } from './code-generator'
import type { ParsedCSS } from '@/shared/types'

type ExportFormat = 'tailwind' | 'react' | 'vue' | 'css-module'
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
  const { type, format, styleMode, element } = event.data

  if (type !== 'export' || !element) {
    self.postMessage({ code: '// Select an element to export', language: 'js' })
    return
  }

  try {
    const { styles, html, selector, responsiveStyles, interactionStyles } = element

    // Build base CSS text
    const cssText = Object.entries(styles)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n')

    // Build responsive CSS text: Record<string, CSSPropertyMap>
    let responsiveCSS = ''
    if (responsiveStyles) {
      const blocks: string[] = []
      for (const [query, props] of Object.entries(responsiveStyles)) {
        const lines = Object.entries(props)
          .map(([k, v]) => `  ${k}: ${v};`)
          .join('\n')
        blocks.push(`@media ${query} {\n${lines}\n}`)
      }
      responsiveCSS = blocks.join('\n')
    }

    // Build interaction (pseudo-class) CSS text: { hover?: CSSPropertyMap; focus?: CSSPropertyMap; active?: CSSPropertyMap }
    let interactionCSS = ''
    if (interactionStyles) {
      const blocks: string[] = []
      for (const [pseudo, props] of Object.entries(interactionStyles)) {
        if (!props) continue
        const lines = Object.entries(props)
          .map(([k, v]) => `  ${k}: ${v};`)
          .join('\n')
        blocks.push(`${pseudo} {\n${lines}\n}`)
      }
      interactionCSS = blocks.join('\n')
    }

    const fullCSS = `${selector ?? '.component'} {\n${cssText}\n}${responsiveCSS ? '\n' + responsiveCSS : ''}${interactionCSS ? '\n' + interactionCSS : ''}`

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
      case 'react':
        code = generateReactComponent(html ?? '<div></div>', fullCSS, {
          styleMode,
          tailwindClasses: element.tailwindClasses,
        })
        language = 'tsx'
        break
      case 'vue':
        code = generateVueComponent(html ?? '<div></div>', fullCSS, { styleMode })
        language = 'vue'
        break
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
