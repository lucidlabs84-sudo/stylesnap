import { useState, useEffect, useCallback } from 'react'
import { Scan, Settings, Crown, Languages, MessageSquare } from 'lucide-react'
import { clsx } from 'clsx'
import InspectTab    from './tabs/InspectTab'
import SettingsModal from './components/SettingsModal'
import UpgradeModal  from './components/UpgradeModal'
import FeedbackModal from './components/FeedbackModal'
import Button       from './components/Button'
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

function AppContent() {
  const { t, lang, setLang } = useI18n()
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

  // ── Refresh license helper ───────────────────────────────────────────────
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
        await chrome.tabs.sendMessage(tab.id!, { type: 'DISABLE_INSPECTOR' })
        setIsInspecting(false)
      } else {
        await chrome.tabs.sendMessage(tab.id!, { type: 'INIT_INSPECTOR' })
        setIsInspecting(true)
      }
    } catch (err) {
      console.error('Inspector toggle failed:', err)
      alert(t('failedConnect'))
      setIsInspecting(false)
    }
  }, [isInspecting, t])

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
          <Button
            variant="icon"
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
          >
            <Languages size={14} />
          </Button>
          {!isPro && (
            <Button
              variant="secondary"
              onClick={() => setShowUpgrade(true)}
              className="bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20"
            >
              <Crown size={10} />
              {t('pro')}
            </Button>
          )}
          <Button
            variant="icon"
            onClick={() => setShowFeedback(true)}
            title={t('feedback')}
          >
            <MessageSquare size={14} />
          </Button>
          <Button
            variant="icon"
            onClick={() => setShowSettings(true)}
            title={t('settings')}
          >
            <Settings size={14} />
          </Button>
        </div>
      </header>

      {/* ── Inspector toggle ─────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/50 shrink-0">
        <Button
          variant="primary"
          onClick={toggleInspector}
          active={isInspecting}
          className={clsx('w-full', !isInspecting && 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700')}
        >
          <Scan size={14} className={isInspecting ? 'animate-pulse' : ''} />
          {isInspecting ? t('inspecting') : t('startInspecting')}
        </Button>

        {license && !isPro && (
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
            <span>{t('freeQuota', { used: license.dailyUsed ?? 0, limit: license.dailyLimit })}</span>
            <Button
              variant="text"
              onClick={() => setShowUpgrade(true)}
            >
              {t('upgradeUnlimited')}
            </Button>
          </div>
        )}
      </div>

      {/* ── Inspect content (directly rendered, no tabs) ─────────────────── */}
      <div className="flex-1 overflow-hidden">
        <InspectTab
          currentElement={hoveredEl as any}
          clickedElement={clickedEl as any}
          currentCSS={currentCSS}
          isInspecting={isInspecting}
          isPro={isPro}
          onUpgrade={() => setShowUpgrade(true)}
        />
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
