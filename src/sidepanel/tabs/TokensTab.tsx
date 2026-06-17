import React, { useState, useCallback } from 'react'
import {
  Palette, Type, Ruler, Box, Sparkles, Download, Copy,
  Check, RefreshCw, AlertCircle, Zap, ChevronDown, ChevronRight
} from 'lucide-react'
import { CodeBlock } from '../components/CodeBlock'
import {
  tokensToJSON,
  tokensToTailwindConfig,
  tokensToCSSVariables,
} from '../../lib/token-extractor'
import type { DesignTokens, LicenseStatus } from '../../shared/types'
import { useI18n } from '@/lib/i18n'

interface TokensTabProps {
  license: LicenseStatus
  onUpgrade: () => void
}

type ExportFormat = 'json' | 'tailwind' | 'css'

const FORMAT_OPTIONS: { value: ExportFormat; label: string; ext: string }[] = [
  { value: 'json',     label: 'W3C JSON',   ext: '.tokens.json' },
  { value: 'tailwind', label: 'Tailwind',   ext: '.tailwind.config.js' },
  { value: 'css',      label: 'CSS Vars',   ext: '.variables.css' },
]

// ─── Color swatch grid ───────────────────────────────────────────────────────
const ColorGrid: React.FC<{ colors: DesignTokens['colors'] }> = ({ colors }) => {
  if (!colors?.length) return null
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {colors.map((c, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <div
            className="w-full aspect-square rounded-lg border border-gray-700 shadow-sm cursor-pointer hover:scale-105 transition-transform"
            style={{ backgroundColor: c.value }}
            title={`${c.name}: ${c.value}`}
            onClick={() => navigator.clipboard.writeText(c.value).catch(() => {})}
          />
          <span className="text-[9px] text-gray-500 font-mono truncate w-full text-center" title={c.name}>
            {c.name}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Token section collapsible ───────────────────────────────────────────────
const TokenSection: React.FC<{
  icon: React.ReactNode
  title: string
  badge?: number
  children: React.ReactNode
  defaultOpen?: boolean
}> = ({ icon, title, badge, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-700/60 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-800/60 hover:bg-gray-800 transition-colors text-left"
      >
        <span className="text-gray-400">{icon}</span>
        <span className="text-xs font-semibold text-gray-200 flex-1">{title}</span>
        {badge !== undefined && (
          <span className="text-[10px] bg-gray-700 text-gray-400 rounded px-1.5 py-0.5">{badge}</span>
        )}
        {open ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
      </button>
      {open && <div className="px-3 py-2.5">{children}</div>}
    </div>
  )
}

// ─── Typography token list ────────────────────────────────────────────────────
const TypographyList: React.FC<{ fonts: DesignTokens['fonts'] }> = ({ fonts }) => {
  if (!fonts?.length) return <p className="text-xs text-gray-500">No fonts detected</p>
  return (
    <div className="space-y-1.5">
      {fonts.map((f, i) => (
        <div key={i} className="flex items-center gap-2 bg-gray-800/40 rounded px-2 py-1.5">
          <span
            className="text-sm text-gray-200 flex-1 truncate"
            style={{ fontFamily: f.family }}
          >
            {f.family}
          </span>
          <span className="text-[10px] text-gray-500 font-mono">{f.sizes.join(', ')}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Spacing scale ────────────────────────────────────────────────────────────
const SpacingScale: React.FC<{ spacing: DesignTokens['spacing'] }> = ({ spacing }) => {
  if (!spacing?.length) return <p className="text-xs text-gray-500">No spacing values detected</p>
  const sorted = [...spacing].sort((a, b) => parseFloat(a.value) - parseFloat(b.value))
  return (
    <div className="space-y-1">
      {sorted.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 font-mono w-12 text-right">{s.value}</span>
          <div
            className="h-2 bg-indigo-500/60 rounded-full flex-none"
            style={{ width: `${Math.min(100, (parseFloat(s.value) / 80) * 100)}%`, minWidth: 4 }}
          />
          {s.name && (
            <span className="text-[10px] text-gray-600 font-mono">{s.name}</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export const TokensTab: React.FC<TokensTabProps> = ({ license, onUpgrade }) => {
  const { t } = useI18n()
  const [tokens, setTokens]       = useState<DesignTokens | null>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [format, setFormat]       = useState<ExportFormat>('json')
  const [copied, setCopied]       = useState(false)
  const [showCode, setShowCode]   = useState(false)

  const isPro = license.isPro

  const handleExtract = useCallback(async () => {
    if (!isPro) { onUpgrade(); return }
    setLoading(true)
    setError(null)
    try {
      // Ask content script to extract tokens from the active page
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error('No active tab')

      const response: { tokens?: DesignTokens; error?: string } = await chrome.tabs.sendMessage(
        tab.id,
        { type: 'EXTRACT_TOKENS' }
      )
      if (response.error) throw new Error(response.error)
      if (!response.tokens) throw new Error('No tokens returned')
      setTokens(response.tokens)
    } catch (e: any) {
      setError(e?.message ?? 'Extraction failed')
    } finally {
      setLoading(false)
    }
  }, [isPro, onUpgrade])

  const getCode = useCallback((): string => {
    if (!tokens) return ''
    switch (format) {
      case 'json':     return tokensToJSON(tokens)
      case 'tailwind': return tokensToTailwindConfig(tokens)
      case 'css':      return tokensToCSSVariables(tokens)
    }
  }, [tokens, format])

  const code = getCode()

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(code) }
    catch {
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
    const ext = FORMAT_OPTIONS.find(o => o.value === format)?.ext ?? '.txt'
    const blob = new Blob([code], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `design-tokens${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Empty state ─────────────────────────────────────────────────────────
  if (!tokens) {
    return (
      <div className="flex flex-col h-full">
        {/* Pro gate */}
        {!isPro && (
          <div className="mx-3 mt-3 flex items-start gap-2 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2.5">
            <Zap size={13} className="text-amber-400 flex-none mt-0.5" />
            <div className="flex-1">
              <p className="text-xs text-amber-300 font-medium">{t('proTokenTitle')}</p>
              <p className="text-[11px] text-amber-400/70 mt-0.5">
                {t('proTokenDesc')}
              </p>
            </div>
            <button
              onClick={onUpgrade}
              className="flex-none text-[11px] bg-amber-500 hover:bg-amber-400 text-black font-semibold px-2 py-1 rounded transition-colors"
            >
              {t('upgrade')}
            </button>
          </div>
        )}

        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <Sparkles size={32} className="text-indigo-500/50 mb-4" />
          <h3 className="text-sm font-semibold text-gray-200 mb-1">{t('extractTokensTitle')}</h3>
          <p className="text-xs text-gray-400 mb-6 max-w-[240px] leading-relaxed">
            {t('extractTokensDesc')}
          </p>
          
          <button
            onClick={handleExtract}
            disabled={loading || !isPro}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <Palette size={16} />}
            {loading ? t('scanning') : t('extractTokensBtn')}
          </button>

          {error && (
            <div className="mt-4 flex items-center gap-1.5 text-xs text-red-400 bg-red-400/10 px-3 py-1.5 rounded">
              <AlertCircle size={12} /> {error}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── Token view ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Format + export bar */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-2 border-b border-gray-800">
        <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5 flex-1">
          {FORMAT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setFormat(opt.value)}
              className={`flex-1 text-[11px] py-1 rounded transition-colors ${
                format === opt.value
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowCode(v => !v)}
          className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${
            showCode
              ? 'bg-indigo-900/40 border-indigo-700/50 text-indigo-300'
              : 'border-gray-700 text-gray-400 hover:text-gray-200 bg-gray-800'
          }`}
          title="Toggle code view"
        >
          {'</>'}
        </button>
        <button
          onClick={handleDownload}
          className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
          title="Download"
        >
          <Download size={13} />
        </button>
      </div>

      {/* Code view */}
      {showCode ? (
        <div className="flex-1 overflow-auto px-3 pt-2 pb-3">
          <CodeBlock
            code={code}
            language={format === 'json' ? 'json' : 'js'}
            title={`design-tokens${FORMAT_OPTIONS.find(o => o.value === format)?.ext}`}
            collapsible={false}
            maxHeight={500}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-3 py-2 space-y-2">
          {/* Colors */}
          <TokenSection
            icon={<Palette size={13} />}
            title="Colors"
            badge={tokens.colors?.length}
          >
            <ColorGrid colors={tokens.colors} />
          </TokenSection>

          {/* Typography */}
          <TokenSection
            icon={<Type size={13} />}
            title="Typography"
            badge={tokens.fonts?.length}
            defaultOpen={false}
          >
            <TypographyList fonts={tokens.fonts} />
          </TokenSection>

          {/* Spacing */}
          <TokenSection
            icon={<Ruler size={13} />}
            title="Spacing Scale"
            badge={tokens.spacing?.length}
            defaultOpen={false}
          >
            <SpacingScale spacing={tokens.spacing} />
          </TokenSection>

          {/* Border radius */}
          {tokens.radii?.length ? (
            <TokenSection
              icon={<Box size={13} />}
              title="Border Radius"
              badge={tokens.radii.length}
              defaultOpen={false}
            >
              <div className="flex flex-wrap gap-2">
                {tokens.radii.map((r, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div
                      className="w-8 h-8 bg-indigo-500/30 border border-indigo-500/50"
                      style={{ borderRadius: r.value }}
                    />
                    <span className="text-[9px] text-gray-500 font-mono">{r.value}</span>
                  </div>
                ))}
              </div>
            </TokenSection>
          ) : null}

          {/* Re-extract button */}
          <button
            onClick={handleExtract}
            disabled={loading}
            className="w-full py-2 text-xs text-gray-500 hover:text-gray-300 flex items-center justify-center gap-1.5 transition-colors"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Re-scanning…' : 'Re-extract tokens'}
          </button>
        </div>
      )}

      {/* Copy bar */}
      <div className="px-3 pb-3 pt-1 border-t border-gray-800">
        <button
          onClick={handleCopy}
          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg flex items-center justify-center gap-2 font-medium transition-colors"
        >
          {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy {FORMAT_OPTIONS.find(o => o.value === format)?.label}</>}
        </button>
      </div>
    </div>
  )
}

export default TokensTab
