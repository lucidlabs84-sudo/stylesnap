import React, { useState, useRef, useEffect } from 'react'
import {
  Code2, FileType2, FileCode2, Download, Copy, Check,
  AlertCircle, Lock, ChevronDown
} from 'lucide-react'
import CodeBlock       from '../components/CodeBlock'
import Button          from '../components/Button'
import type { ParsedCSS, LicenseStatus } from '../../shared/types'
import { useI18n } from '@/lib/i18n'
import { showInfo } from '../../lib/notifications'

interface ExportTabProps {
  element: ParsedCSS | null
  license: LicenseStatus
  onUpgrade: () => void
}

type ExportFormat = 'tailwind' | 'react' | 'vue' | 'css-module'
type StyleMode    = 'tailwind' | 'cssmodule' | 'inline'

const FREE_FORMATS:  { value: ExportFormat; label: string; icon: React.ReactNode }[] = [
  { value: 'css-module',  label: 'CSS Module',  icon: <FileCode2 size={13} /> },
]
const PRO_FORMATS:   { value: ExportFormat; label: string; icon: React.ReactNode }[] = [
  { value: 'tailwind',    label: 'Tailwind CSS', icon: <FileType2 size={13} /> },
  { value: 'react',       label: 'React',       icon: <Code2 size={13} /> },
  { value: 'vue',         label: 'Vue SFC',     icon: <FileCode2 size={13} /> },
]

export const ExportTab: React.FC<ExportTabProps> = ({ element, license, onUpgrade }) => {
  const { t } = useI18n()
  const [format, setFormat]       = useState<ExportFormat>('tailwind')
  const [styleMode, setStyleMode] = useState<StyleMode>('tailwind')
  const [copied, setCopied]       = useState(false)
  const [proTeaserOpen, setProTeaserOpen] = useState(false)

  const isPro = license.isPro

  // Web Worker ref for export calculations
  const workerRef = useRef<Worker | null>(null);
  const [code, setCode] = useState('// Select an element to export');
  const [language, setLanguage] = useState('js');

  // Initialize Worker and set up message handler
  useEffect(() => {
    const worker = new Worker(new URL('../../lib/exportWorker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (event: MessageEvent<{ code: string; language: string }>) => {
      setCode(event.data.code);
      setLanguage(event.data.language);
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Send export request when inputs change
  useEffect(() => {
    if (!element) {
      setCode('// Select an element to export');
      setLanguage('js');
      return;
    }

    workerRef.current?.postMessage({
      type: 'export',
      format,
      styleMode,
      element,
    });
  }, [element, format, styleMode]);

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
    showInfo('Code copied to clipboard!')
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

  // ─── Free user: only show free formats + Pro teaser ───
  const visibleFormats = isPro
    ? [...FREE_FORMATS, ...PRO_FORMATS]
    : FREE_FORMATS

  if (!element) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <Code2 size={32} className="text-slate-600 mb-3" />
        <p className="text-sm text-slate-400">
          {t('selectElement')}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          {t('useExport')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Format selector */}
      <div className="px-3 pt-2 pb-1">
        <div className="flex gap-1 bg-slate-800/60 rounded-lg p-1">
          {visibleFormats.map(opt => {
            const isActive = format === opt.value
            return (
              <Button
                key={opt.value}
                variant="toggle"
                active={isActive}
                onClick={() => setFormat(opt.value)}
                className="flex-1"
              >
                {opt.icon}
                <span className="hidden sm:inline">{opt.label}</span>
              </Button>
            )
          })}

          {/* Pro teaser for free users */}
          {!isPro && (
            <button
              onClick={() => setProTeaserOpen(!proTeaserOpen)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-amber-400 hover:bg-amber-500/10 transition-colors"
              aria-label="Show Pro export formats"
            >
              <Lock size={10} />
              <span className="hidden sm:inline">Pro</span>
              <ChevronDown size={9} className={`transition-transform ${proTeaserOpen ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>

        {/* Pro formats teaser dropdown */}
        {!isPro && proTeaserOpen && (
          <div className="mt-1 bg-slate-800/80 rounded-lg p-2 text-[11px] text-slate-400">
            <p className="mb-1.5 text-amber-400 font-medium">Pro export formats:</p>
            {PRO_FORMATS.map(f => (
              <div key={f.value} className="flex items-center gap-1.5 py-0.5 text-slate-500">
                <Lock size={9} className="text-amber-500/60" />
                {f.label}
              </div>
            ))}
            <button
              onClick={onUpgrade}
              className="mt-2 w-full py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-[11px] font-semibold rounded-md transition-colors"
            >
              {t('upgrade')} to unlock
            </button>
          </div>
        )}
      </div>

      {/* Style mode — only for React/Vue */}
      {(format === 'react' || format === 'vue') && (
        <div className="px-3 pb-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 flex-none">{t('style')}</span>
            {(['tailwind', 'cssmodule', 'inline'] as StyleMode[]).map(m => (
              <Button
                key={m}
                variant="toggle"
                size="sm"
                active={styleMode === m}
                onClick={() => setStyleMode(m)}
                className="px-2 py-0.5"
              >
                {m === 'cssmodule' ? 'CSS Module' : m === 'tailwind' ? 'Tailwind' : t('inline')}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Pro gate for Pro formats (only reachable if isPro somehow false but format is pro) */}
      {PRO_FORMATS.some(o => o.value === format) && !isPro && (
        <div className="mx-3 mb-2 flex items-start gap-2 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
          <AlertCircle size={13} className="text-amber-400 flex-none mt-0.5" />
          <div>
            <p className="text-xs text-amber-300 font-medium">{t('proFeature')}</p>
            <p className="text-[11px] text-amber-400/70">
              {t('upgradeToUnlock', { format: PRO_FORMATS.find(o => o.value === format)?.label || '' })}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onUpgrade}
            className="ml-auto flex-none bg-amber-500 hover:bg-amber-400 text-black font-semibold"
          >
            {t('upgrade')}
          </Button>
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
      <div className="flex gap-2 px-3 pb-3 border-t border-slate-800 pt-2">
        <button
          onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-2 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition-colors font-medium"
        >
          {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy Code</>}
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center justify-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors"
          title="Download file"
        >
          <Download size={13} />
        </button>
      </div>
    </div>
  )
}

export default ExportTab
