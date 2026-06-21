import React, { useState, useCallback } from 'react'
import { Palette, RefreshCw, AlertCircle } from 'lucide-react'
import type { DesignTokens, LicenseStatus } from '../../shared/types'
import { useI18n } from '@/lib/i18n'

interface TokensTabProps {
  license: LicenseStatus
  onUpgrade: () => void
}

// ─── Color swatch grid ─────────────────────────────────────────────
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

// ─── Main component ─────────────────────────────────────────────
export const TokensTab: React.FC<TokensTabProps> = ({ license, onUpgrade }) => {
  const { t } = useI18n()
  const [tokens, setTokens]       = useState<DesignTokens | null>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const isPro = license.isPro

  const handleExtract = useCallback(async () => {
    if (!isPro) { onUpgrade(); return }
    setLoading(true)
    setError(null)
    try {
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

  // ─── Empty state ─────────────────────────────────────
  if (!tokens) {
    return (
      <div className="flex flex-col h-full">
        {!isPro && (
          <div className="mx-3 mt-3 flex items-start gap-2 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2.5">
            <AlertCircle size={13} className="text-amber-400 flex-none mt-0.5" />
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
          <Palette size={32} className="text-indigo-500/50 mb-4" />
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

  // ─── Color board view ──────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-800">
        <h3 className="text-xs font-semibold text-gray-200">🎨 {t('colorBoard') || 'Color Board'}</h3>
      </div>

      <div className="flex-1 overflow-auto px-3 py-2">
        <ColorGrid colors={tokens.colors} />
      </div>

      {/* Re-extract button */}
      <div className="px-3 pb-3 pt-1 border-t border-gray-800">
        <button
          onClick={handleExtract}
          disabled={loading}
          className="w-full py-2 text-xs text-gray-500 hover:text-gray-300 flex items-center justify-center gap-1.5 transition-colors"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Re-scanning…' : 'Re-extract tokens'}
        </button>
      </div>
    </div>
  )
}

export default TokensTab
