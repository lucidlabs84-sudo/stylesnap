import { useState, useEffect, useCallback } from 'react'
import { Scan, Package, Palette, Settings, Crown, Languages, MessageSquare } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { clsx } from 'clsx'
import InspectTab    from './tabs/InspectTab'
import ExportTab     from './tabs/ExportTab'
import TokensTab     from './tabs/TokensTab'
import SettingsModal from './components/SettingsModal'
import UpgradeModal  from './components/UpgradeModal'
import FeedbackModal from './components/FeedbackModal'
import type { ParsedCSS, LicenseStatus } from '@/shared/types'
import { getLicenseStatus, checkAndValidateLicense, checkUrlForLicenseKey } from '@/lib/license'
import { I18nProvider, useI18n } from '@/lib/i18n'

// ─── Message types from content script ──────────────────────────────────────
interface HoveredPayload {
  parsedCSS: ParsedCSS
  tagName: string
  id: string
  classList: string[]
  rect: { width: number; height: number; top: number; left: number }
}

interface ClickedPayload extends HoveredPayload {
  componentHTML?: string
  componentCSS?: string
}

type Tab = 'inspect' | 'export' | 'tokens'

const TABS: { id: Tab; iconKey: 'inspect' | 'export' | 'tokens'; Icon: LucideIcon }[] = [
  { id: 'inspect', iconKey: 'inspect', Icon: Scan    },
  { id: 'export',  iconKey: 'export',  Icon: Package },
  { id: 'tokens',  iconKey: 'tokens',  Icon: Palette },
]

function AppContent() {
  const { t, lang, setLang } = useI18n()
  const [activeTab,      setActiveTab]      = useState<Tab>('inspect')
  const [isInspecting,   setIsInspecting]   = useState(false)
  const [hoveredEl,      setHoveredEl]      = useState<HoveredPayload | null>(null)
  const [clickedEl,      setClickedEl]      = useState<ClickedPayload | null>(null)
  const [license,        setLicense]        = useState<LicenseStatus | null>(null)
  const [showSettings,   setShowSettings]   = useState(false)
  const [showUpgrade,    setShowUpgrade]    = useState(false)
  const [showFeedback,   setShowFeedback]   = useState(false)

  // ── Load license + startup validation + URL detection ───────────────────
  useEffect(() => {
    (async () => {
      // 1. Check URL for license_key param (from DodoPayments redirect after payment)
      const autoActivated = await checkUrlForLicenseKey()

      // 2. Periodic license validation (every 24h)
      if (!autoActivated) {
        await checkAndValidateLicense()
      }

      // 3. Load current license status
      const status = await getLicenseStatus()
      setLicense(status)
    })()
  }, [])

  // ── Refresh license helper ─────────────────────────────────────────────
  const refreshLicense = useCallback(async () => {
    const status = await getLicenseStatus()
    setLicense(status)
  }, [])

  // ── Listen for messages from content script ──────────────────────────────
  useEffect(() => {
    const handler = (msg: { type: string; payload?: unknown }) => {
      switch (msg.type) {
        case 'ELEMENT_HOVERED':
          setHoveredEl(msg.payload as HoveredPayload)
          break
        case 'ELEMENT_CLICKED':
          setClickedEl(msg.payload as ClickedPayload)
          setActiveTab('inspect')
          break
        case 'ELEMENT_UNLOCKED':
          setClickedEl(null)
          break
        case 'DISABLE_INSPECTOR':
          setIsInspecting(false)
          setClickedEl(null)
          break
        case 'INIT_INSPECTOR':
          setIsInspecting(true)
          break
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])

  // ── Toggle inspector ────────────────────────────────────────────────────
  const toggleInspector = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return
      
      // Cannot inspect chrome:// or restricted URLs
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://') || tab.url?.startsWith('about:')) {
        alert(t('cannotInspect'))
        return
      }

      if (isInspecting) {
        await chrome.tabs.sendMessage(tab.id, { type: 'DISABLE_INSPECTOR' })
        setIsInspecting(false)
      } else {
        await chrome.tabs.sendMessage(tab.id, { type: 'INIT_INSPECTOR' })
        setIsInspecting(true)
      }
    } catch (err) {
      console.error('Inspector toggle failed:', err)
      alert(t('failedConnect'))
      setIsInspecting(false)
    }
  }, [isInspecting, t])

  // Active CSS: prefer clicked element, fall back to hovered
  const currentCSS: ParsedCSS | null =
    clickedEl?.parsedCSS ?? hoveredEl?.parsedCSS ?? null

  const isPro = license?.isPro ?? false

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-gray-100">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-indigo-500 flex items-center justify-center text-[10px] font-black text-white select-none">
            S
          </div>
          <span className="font-semibold text-sm text-white">StyleSnap</span>
          {isPro && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              PRO
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
          >
            <Languages size={14} />
          </button>
          {!isPro && (
            <button
              onClick={() => setShowUpgrade(true)}
              className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
            >
              <Crown size={10} />
              {t('pro')}
            </button>
          )}
          <button
            onClick={() => setShowFeedback(true)}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title={t('feedback')}
          >
            <MessageSquare size={14} />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title={t('settings')}
          >
            <Settings size={14} />
          </button>
        </div>
      </header>

      {/* ── Inspector toggle ─────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/50 shrink-0">
        <button
          onClick={toggleInspector}
          className={clsx(
            'w-full flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all',
            isInspecting
              ? 'bg-indigo-500 text-white hover:bg-indigo-600 shadow-[0_0_14px_rgba(99,102,241,0.35)]'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700',
          )}
        >
          <Scan size={14} className={isInspecting ? 'animate-pulse' : ''} />
          {isInspecting ? t('inspecting') : t('startInspecting')}
        </button>

        {license && !isPro && (
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
            <span>{t('freeQuota', { used: license.dailyUsed ?? 0, limit: license.dailyLimit })}</span>
            <button
              onClick={() => setShowUpgrade(true)}
              className="text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              {t('upgradeUnlimited')}
            </button>
          </div>
        )}
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-slate-800 shrink-0">
        {TABS.map(({ id, iconKey, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={clsx(
              'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors border-b-2',
              activeTab === id
                ? 'text-indigo-400 border-indigo-500 bg-indigo-500/5'
                : 'text-slate-500 border-transparent hover:text-slate-300 hover:bg-slate-800/50',
            )}
          >
            <Icon size={12} />
            {t(iconKey)}
          </button>
        ))}
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'inspect' && (
          <InspectTab
            currentElement={hoveredEl as any}
            clickedElement={clickedEl as any}
            currentCSS={currentCSS}
            isInspecting={isInspecting}
            isPro={isPro}
            onUpgrade={() => setShowUpgrade(true)}
          />
        )}
        {activeTab === 'export' && (
          <ExportTab
            element={currentCSS}
            license={license ?? { isPro: false, dailyUsed: 0, dailyLimit: 20 }}
            onUpgrade={() => setShowUpgrade(true)}
          />
        )}
        {activeTab === 'tokens' && (
          <TokensTab
            license={license ?? { isPro: false, dailyUsed: 0, dailyLimit: 20 }}
            onUpgrade={() => setShowUpgrade(true)}
          />
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
      {showUpgrade && (
        <UpgradeModal
          onClose={() => setShowUpgrade(false)}
          onActivated={refreshLicense}
        />
      )}
      {showFeedback && (
        <FeedbackModal onClose={() => setShowFeedback(false)} />
      )}
    </div>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  )
}
