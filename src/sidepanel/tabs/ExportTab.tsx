import React, { useState, useCallback } from 'react'
import {
  Code2, FileCode2, FileType2, Download, Copy, Check,
  Zap, AlertCircle
} from 'lucide-react'
import { CodeBlock }    from '../components/CodeBlock'
import { generateReactComponent, generateVueComponent } from '../../lib/code-generator'
import { cssToTailwind }   from '../../lib/tailwind-mapper'
import type { ParsedCSS, LicenseStatus } from '../../shared/types'
import { useI18n } from '@/lib/i18n'

interface ExportTabProps {
  element: ParsedCSS | null
  license: LicenseStatus
  onUpgrade: () => void
}

type ExportFormat = 'tailwind' | 'react' | 'vue' | 'css-module'
type StyleMode    = 'tailwind' | 'cssmodule' | 'inline'

const FORMAT_OPTIONS: { value: ExportFormat; label: string; icon: React.ReactNode; pro: boolean }[] = [
  { value: 'tailwind',    label: 'Tailwind CSS',   icon: <FileType2 size={13} />,  pro: true  },
  { value: 'react',       label: 'React',          icon: <Code2 size={13} />,      pro: true  },
  { value: 'vue',         label: 'Vue SFC',        icon: <FileCode2 size={13} />,  pro: true  },
  { value: 'css-module',  label: 'CSS Module',     icon: <FileCode2 size={13} />,  pro: false },
]

export const ExportTab: React.FC<ExportTabProps> = ({ element, license, onUpgrade }) => {
  const { t } = useI18n()
  const [format, setFormat]        = useState<ExportFormat>('tailwind')
  const [styleMode, setStyleMode]  = useState<StyleMode>('tailwind')
  const [copied, setCopied]        = useState(false)

  const isPro = license.isPro

  /** Build export output synchronously from current element */
  const buildOutput = useCallback((): { code: string; language: string } => {
    if (!element) return { code: '// Select an element to export', language: 'js' }

    const { styles, html, selector } = element
    const cssText = Object.entries(styles)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n')
    const fullCSS = `${selector ?? '.component'} {\n${cssText}\n}`

    switch (format) {
      case 'tailwind': {
        const { classes, unmatched, matchRate } = cssToTailwind(styles)
        const unmatchedEntries = Object.entries(unmatched)
        const unmatchedCSS = unmatchedEntries.length
          ? `\n/* Unmatched (${(100 - matchRate).toFixed(0)}%): */\n` +
            unmatchedEntries.map(([k, v]) => `/* ${k}: ${v}; */`).join('\n')
          : ''
        return {
          code: `/* ${matchRate.toFixed(0)}% matched via Tailwind */\n<div className="${classes.join(' ')}">\n  {/* ... */}\n</div>${unmatchedCSS}`,
          language: 'jsx',
        }
      }
      case 'react':
        return {
          code: generateReactComponent(html ?? '<div></div>', fullCSS, { styleMode }),
          language: 'tsx',
        }
      case 'vue':
        return {
          code: generateVueComponent(html ?? '<div></div>', fullCSS, { styleMode }),
          language: 'vue',
        }
      case 'css-module': {
        const className = (selector ?? '.component').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+/, '')
        const mod = `.${className} {\n${cssText}\n}`
        const usage = `import styles from './Component.module.css'\n\n<div className={styles.${className}}>\n  {/* ... */}\n</div>`
        return {
          code: `${mod}\n\n/* Usage */\n${usage}`,
          language: 'css',
        }
      }
    }
  }, [element, format, styleMode])

  const { code, language } = buildOutput()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      const el = document.createElement('textarea')
      el.value = code
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const ext: Record<string, string> = {
      css: '.css', jsx: '.jsx', tsx: '.tsx', vue: '.vue', js: '.js',
    }
    const blob = new Blob([code], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `stylesnap-export${ext[language] ?? '.txt'}`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!element) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <Code2 size={32} className="text-gray-600 mb-3" />
        <p className="text-sm text-gray-400">
          {t('selectElement')}
        </p>
        <p className="text-xs text-gray-600 mt-1">
          {t('useExport')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Format selector */}
      <div className="px-3 pt-2 pb-1">
        <div className="flex gap-1 bg-gray-800/60 rounded-lg p-1">
          {FORMAT_OPTIONS.map(opt => {
            const locked = opt.pro && !isPro
            return (
              <button
                key={opt.value}
                onClick={() => {
                  if (locked) { onUpgrade(); return }
                  setFormat(opt.value)
                }}
                title={locked ? 'Requires Pro' : opt.label}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[11px] transition-colors relative ${
                  format === opt.value
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                } ${locked ? 'opacity-60' : ''}`}
              >
                {opt.icon}
                <span className="hidden sm:inline">{opt.label}</span>
                {locked && (
                  <Zap size={9} className="text-amber-400 absolute top-0.5 right-0.5" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Style mode — only for React/Vue */}
      {(format === 'react' || format === 'vue') && (
        <div className="px-3 pb-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500 flex-none">{t('style')}</span>
            {(['tailwind', 'cssmodule', 'inline'] as StyleMode[]).map(m => (
              <button
                key={m}
                onClick={() => setStyleMode(m)}
                className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                  styleMode === m
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-gray-200 bg-gray-800'
                }`}
              >
                {m === 'cssmodule' ? 'CSS Module' : m === 'tailwind' ? 'Tailwind' : t('inline')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pro gate for Tailwind/React/Vue */}
      {FORMAT_OPTIONS.find(o => o.value === format)?.pro && !isPro && (
        <div className="mx-3 mb-2 flex items-start gap-2 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
          <AlertCircle size={13} className="text-amber-400 flex-none mt-0.5" />
          <div>
            <p className="text-xs text-amber-300 font-medium">{t('proFeature')}</p>
            <p className="text-[11px] text-amber-400/70">
              {t('upgradeToUnlock', { format: FORMAT_OPTIONS.find(o => o.value === format)?.label || '' })}
            </p>
          </div>
          <button
            onClick={onUpgrade}
            className="ml-auto flex-none text-[11px] bg-amber-500 hover:bg-amber-400 text-black font-semibold px-2 py-1 rounded transition-colors"
          >
            {t('upgrade')}
          </button>
        </div>
      )}

      {/* Code output */}
      <div className="flex-1 overflow-auto px-3 pb-3">
        <CodeBlock
          code={code}
          language={language as any}
          title={element.selector ?? 'element'}
          collapsible={false}
          maxHeight={400}
          className="h-full"
        />
      </div>

      {/* Action bar */}
      <div className="flex gap-2 px-3 pb-3 border-t border-gray-800 pt-2">
        <button
          onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-2 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition-colors font-medium"
        >
          {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy Code</>}
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors"
          title="Download file"
        >
          <Download size={13} />
        </button>
      </div>
    </div>
  )
}

export default ExportTab
