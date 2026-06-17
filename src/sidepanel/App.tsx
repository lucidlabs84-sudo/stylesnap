import { useState, useEffect, useCallback } from 'react'
import { Scan, Package, Palette, Settings, Crown, Languages, MessageSquare, ChevronDown, ChevronRight } from 'lucide-react'
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

type Section = 'inspect' | 'export' | 'tokens'

// ─── Section container component ───────────────────────────────────────────
interface SectionContainerProps {
  id: Section
  Icon: LucideIcon
  title: string
  isExpanded: boolean
  onToggle: () => void
  children: React.ReactNode
  badge?: string
  pro?: boolean
}

const SectionContainer: React.FC<SectionContainerProps> = ({
  Icon, title, isExpanded, onToggle, children, badge, pro
}) => {
  return (
    <div className="border-b border-slate-800">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-800/50 transition-colors text-left bg-slate-900/30"
      >
        <Icon size={13} className={pro ? 'text-amber-400' : 'text-indigo-400'} />
        <span className="text-xs font-semibold text-gray-200 flex-1">{title}</span>
        {badge && (
          <span className="text-[10px] bg-slate-700 text-slate-400 rounded px-1.5 py-0.5 font-mono">
            {badge}
          </span>
        )}
        {pro && (
          <span className="text-[9px] font-semibold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">PRO</span>
        )}
        {isExpanded ? (
          <ChevronDown size={12} className="text-slate-500" />
        ) : (
          <ChevronRight size={12} className="text-slate-500" />
        )}
      </button>
      {isExpanded && (
        <div className="border-t border-slate-800/50">
          {children}
        </div>
      )}
    </div>
  )
}

function AppContent() {
  const { t, lang, setLang } = useI18n()
  const [expandedSections, setExpandedSections] = useState<Set<Section>>(new Set(['inspect', 'export', 'tokens']))
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
      const autoActivated = await checkUrlForLicenseKey()
      if (!autoActivated) {
        await checkAndValidateLicense()
      }
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
    const handler = (msg: { type: string; payload?: unknown }, _sender: any, sendResponse: any) => {
      if (msg.type === 'PING_SIDE_PANEL') {
        sendResponse({ ok: true })
        return false
      }
      switch (msg.type) {
        case 'ELEMENT_HOVERED':
          setHoveredEl(msg.payload as HoveredPayload)
          break
        case 'ELEMENT_CLICKED':
          setClickedEl(msg.payload as ClickedPayload)
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

  // ── Toggle section expanded/collapsed ────────────────────────────────────
  const toggleSection = (section: Section) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

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
              className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-all shadow-[0_0_12px_rgba(245,158,11,0.15)]"
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
              className="text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
            >
              {t('upgradeUnlimited')} →
            </button>
          </div>
        )}
      </div>

      {/* ── Single scrollable view with collapsible sections ───────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* Section 1: Inspect */}
        <SectionContainer
          id="inspect"
          Icon={Scan}
          title={t('inspect')}
          isExpanded={expandedSections.has('inspect')}
          onToggle={() => toggleSection('inspect')}
          badge={currentCSS ? Math.round((currentCSS.tailwindMatchRate ?? 0) * 100) + '% TW' : undefined}
        >
          <InspectTab
            currentElement={hoveredEl as any}
            clickedElement={clickedEl as any}
            currentCSS={currentCSS}
            isInspecting={isInspecting}
            isPro={isPro}
            onUpgrade={() => setShowUpgrade(true)}
          />
        </SectionContainer>

        {/* Section 2: Export */}
        <SectionContainer
          id="export"
          Icon={Package}
          title={t('export')}
          isExpanded={expandedSections.has('export')}
          onToggle={() => toggleSection('export')}
          pro={!isPro}
        >
          <ExportTab
            element={currentCSS}
            componentHTML={clickedEl?.componentHTML ?? undefined}
            license={license ?? { isPro: false, dailyUsed: 0, dailyLimit: 20 }}
            onUpgrade={() => setShowUpgrade(true)}
          />
        </SectionContainer>

        {/* Section 3: Tokens */}
        <SectionContainer
          id="tokens"
          Icon={Palette}
          title={t('tokens')}
          isExpanded={expandedSections.has('tokens')}
          onToggle={() => toggleSection('tokens')}
          pro={!isPro}
        >
          <TokensTab
            license={license ?? { isPro: false, dailyUsed: 0, dailyLimit: 20 }}
            onUpgrade={() => setShowUpgrade(true)}
          />
        </SectionContainer>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {showSettings && (
        <SettingsModal 
          onClose={() => setShowSettings(false)} 
          onLicenseChange={refreshLicense}
        />
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
