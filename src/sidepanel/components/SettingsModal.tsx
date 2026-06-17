import React, { useState, useEffect } from 'react'
import { X, Key, Moon, Sun, Monitor, Trash2, Check, AlertCircle, Loader2, Shield, Smartphone, Clock, Calendar } from 'lucide-react'
import { getSettings, saveSettings, getLicenseStatus, activateLicenseKey, deactivateLicenseInstance } from '../../lib/license'
import type { UserSettings, LicenseStatus } from '../../shared/types'
import { useI18n } from '@/lib/i18n'

interface SettingsModalProps {
  onClose: () => void
  onLicenseChange?: () => void
}

type ThemeOption = 'light' | 'dark' | 'system'

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, onLicenseChange }) => {
  const { t } = useI18n()

  const THEME_OPTIONS: { value: ThemeOption; label: string; icon: React.ReactNode }[] = [
    { value: 'light',  label: t('light'),  icon: <Sun size={14} /> },
    { value: 'dark',   label: t('dark'),   icon: <Moon size={14} /> },
    { value: 'system', label: t('system'), icon: <Monitor size={14} /> },
  ]
  const [settings, setSettings]     = useState<UserSettings | null>(null)
  const [license, setLicense]       = useState<LicenseStatus | null>(null)
  const [licenseKeyInput, setLicenseKeyInput] = useState('')
  const [activating, setActivating] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [activateResult, setActivateResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    Promise.all([getSettings(), getLicenseStatus()]).then(([s, l]) => {
      setSettings(s)
      setLicense(l)
    })
  }, [])

  const handleTheme = async (theme: ThemeOption) => {
    if (!settings) return
    const newSettings = { ...settings, theme }
    setSettings(newSettings)
    await saveSettings(newSettings)
  }

  const handleToggle = async (key: keyof UserSettings) => {
    if (!settings) return
    const newSettings = { ...settings, [key]: !settings[key as keyof UserSettings] }
    setSettings(newSettings)
    await saveSettings(newSettings)
  }

  const handleApiKey = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!settings) return
    const newSettings = { ...settings, aiApiKey: e.target.value }
    setSettings(newSettings)
    await saveSettings(newSettings)
  }

  const handleAssistMode = async (mode: 0 | 1 | 2) => {
    if (!settings) return
    const newSettings = { ...settings, assistMode: mode }
    setSettings(newSettings)
    await saveSettings(newSettings)
  }

  const handleActivateKey = async () => {
    const key = licenseKeyInput.trim()
    if (!key) return
    setActivating(true)
    setActivateResult(null)
    const result = await activateLicenseKey(key)
    if (result.success) {
      setActivateResult({ ok: true, msg: t('activateSuccess') || 'License activated!' })
      const l = await getLicenseStatus()
      setLicense(l)
      setLicenseKeyInput('')
      onLicenseChange?.()
    } else {
      const msg = result.limitReached
        ? (t('activationLimitReached') || 'Activation limit reached (2 devices max). Deactivate another device first.')
        : (result.error || t('activateFail') || 'Activation failed.')
      setActivateResult({ ok: false, msg })
    }
    setActivating(false)
  }

  const handleDeactivate = async () => {
    setDeactivating(true)
    await deactivateLicenseInstance()
    const l = await getLicenseStatus()
    setLicense(l)
    setLicenseKeyInput('')
    setActivateResult(null)
    setDeactivating(false)
    onLicenseChange?.()
  }

  if (!settings || !license) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="bg-gray-900 rounded-xl p-6 text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }

  // License status badge color
  const statusColor = license.licenseStatus === 'active' ? 'green'
    : license.licenseStatus === 'expired' ? 'amber'
    : license.licenseStatus === 'disabled' ? 'red'
    : 'green' // default for Pro without explicit status

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}>
      <div
        className="w-full max-w-sm bg-gray-900 rounded-t-2xl shadow-2xl border border-gray-700 pb-safe"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-100">{t('settings')}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[70vh] px-4 py-3 space-y-5">

          {/* ── License ── */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t('license')}
            </h3>
            {license.isPro ? (
              <div className="space-y-2">
                {/* Status badge */}
                <div className={`flex items-center justify-between bg-${statusColor}-900/20 border border-${statusColor}-700/40 rounded-lg px-3 py-2`}>
                  <div className="flex items-center gap-2">
                    <Check size={14} className={`text-${statusColor}-400`} />
                    <span className={`text-xs text-${statusColor}-300 font-medium`}>
                      {license.licenseStatus === 'expired' ? (t('licenseExpired') || 'License Expired')
                        : license.licenseStatus === 'disabled' ? (t('licenseDisabled') || 'License Disabled')
                        : (t('proActivated') || 'StyleSnap Pro — Activated')}
                    </span>
                  </div>
                  <button
                    onClick={handleDeactivate}
                    disabled={deactivating}
                    className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors disabled:opacity-50"
                  >
                    {deactivating ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    {t('remove')}
                  </button>
                </div>

                {/* License details */}
                <div className="bg-gray-800 rounded-lg px-3 py-2 space-y-1.5">
                  {/* License key (masked) */}
                  {license.licenseKey && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">{t('licenseKeyLabel') || 'License Key'}</span>
                      <span className="text-gray-300 font-mono">
                        {license.licenseKey.length > 12
                          ? license.licenseKey.substring(0, 8) + '•••' + license.licenseKey.slice(-4)
                          : license.licenseKey.substring(0, 4) + '••••'}
                      </span>
                    </div>
                  )}

                  {/* Email */}
                  {license.email && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">{t('emailLabel') || 'Email'}</span>
                      <span className="text-gray-300 truncate ml-2 max-w-[180px]">{license.email}</span>
                    </div>
                  )}

                  {/* Activations */}
                  {(license.activationsUsed !== undefined || license.activationsLimit !== undefined) && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500 flex items-center gap-1">
                        <Smartphone size={10} />
                        {t('devicesLabel') || 'Devices'}
                      </span>
                      <span className="text-gray-300">
                        {license.activationsUsed ?? '?'}/{license.activationsLimit ?? '∞'}
                      </span>
                    </div>
                  )}

                  {/* Instance ID */}
                  {license.instanceId && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500 flex items-center gap-1">
                        <Shield size={10} />
                        {t('instanceIdLabel') || 'Instance'}
                      </span>
                      <span className="text-gray-400 font-mono text-[10px]">
                        {license.instanceId.length > 12
                          ? license.instanceId.substring(0, 8) + '•••'
                          : license.instanceId}
                      </span>
                    </div>
                  )}

                  {/* Activated at */}
                  {license.activatedAt && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500 flex items-center gap-1">
                        <Clock size={10} />
                        {t('activatedAtLabel') || 'Activated'}
                      </span>
                      <span className="text-gray-400 text-[10px]">
                        {new Date(license.activatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}

                  {/* Expires */}
                  {license.expiresAt && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500 flex items-center gap-1">
                        <Calendar size={10} />
                        {t('expiresAtLabel') || 'Expires'}
                      </span>
                      <span className="text-gray-400 text-[10px]">
                        {new Date(license.expiresAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Recover license key */}
                <button
                  onClick={() => chrome.tabs.create({ url: 'https://lucidlibs.dev/stylesnap/recover' })}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  {t('forgotLicenseKey') || 'Forgot your license key?'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={licenseKeyInput}
                    onChange={e => setLicenseKeyInput(e.target.value.trim())}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 font-mono tracking-wider"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && licenseKeyInput.trim() && !activating) {
                        handleActivateKey()
                      }
                    }}
                  />
                  <button
                    onClick={handleActivateKey}
                    disabled={activating || !licenseKeyInput.trim()}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors font-medium flex items-center gap-1"
                  >
                    {activating ? <Loader2 size={12} className="animate-spin" /> : <Key size={12} />}
                    {t('activate')}
                  </button>
                </div>
                {activateResult && (
                  <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${
                    activateResult.ok
                      ? 'bg-green-900/20 text-green-300 border border-green-700/30'
                      : 'bg-red-900/20 text-red-300 border border-red-700/30'
                  }`}>
                    {activateResult.ok ? <Check size={12} className="mt-0.5 flex-none" /> : <AlertCircle size={12} className="mt-0.5 flex-none" />}
                    {activateResult.msg}
                  </div>
                )}
                {/* Forgot license key? */}
                <button
                  onClick={() => chrome.tabs.create({ url: 'https://lucidlibs.dev/stylesnap/recover' })}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  {t('forgotLicenseKey') || 'Forgot your license key?'}
                </button>
              </div>
            )}
          </section>

          {/* ── Theme ── */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t('theme')}
            </h3>
            <div className="flex gap-2">
              {THEME_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleTheme(opt.value)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs border transition-colors ${
                    settings.theme === opt.value
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* ── AI Code Generation ── */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t('aiCode')}
              <span className="ml-2 text-[10px] font-normal text-indigo-400 normal-case bg-indigo-900/30 px-1.5 py-0.5 rounded">Pro</span>
            </h3>
            <p className="text-xs text-gray-500 mb-2">
              {t('aiCodeDesc')}
            </p>
            <div className="flex items-center gap-2 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2">
              <Key size={13} className="text-gray-500 flex-none" />
              <input
                type="password"
                value={settings.aiApiKey || ''}
                onChange={handleApiKey}
                placeholder="sk-…"
                className="flex-1 bg-transparent text-xs font-mono text-gray-200 placeholder-gray-600 outline-none"
              />
            </div>
          </section>

          {/* ── Behavior toggles ── */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t('behavior')}
            </h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <Toggle
                  label={t('showOverlay')}
                  value={settings.showOverlay}
                  onChange={() => handleToggle('showOverlay')}
                />
                <Toggle
                  label={t('showFloatingBtn')}
                  value={settings.showFloatingBtn ?? true}
                  onChange={() => handleToggle('showFloatingBtn')}
                />
                <Toggle
                  label={t('autoInspect')}
                  value={settings.autoInspect}
                  onChange={() => handleToggle('autoInspect')}
                />
                <Toggle
                  label={t('copySound')}
                  value={settings.copySound}
                  onChange={() => handleToggle('copySound')}
                />
                <Toggle
                  label={t('autoOpenSidePanel') || 'Open side panel on inspect'}
                  value={settings.autoOpenSidePanel ?? true}
                  onChange={() => handleToggle('autoOpenSidePanel')}
                />
              </div>
              
              {/* Assist Mode Dropdown */}
              <div className="pt-2 border-t border-gray-700/50">
                <label className="text-xs text-gray-400 block mb-1.5">{t('assistModeLabel') || 'Assist Mode'}</label>
                <div className="flex gap-1.5">
                  {([0, 1, 2] as const).map(mode => {
                    const labels = [t('assistOff') || 'Off', t('assistGuidelines') || 'Guidelines', t('assistGrid') || 'Grid']
                    return (
                      <button
                        key={mode}
                        onClick={() => handleAssistMode(mode)}
                        className={`flex-1 py-1.5 text-[10px] rounded border transition-colors ${
                          settings.assistMode === mode
                            ? 'bg-indigo-600 border-indigo-500 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                        }`}
                      >
                        {labels[mode]}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* ── Usage ── */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t('usage')}
            </h3>
            <div className="bg-gray-800 rounded-lg px-3 py-2">
              {license.isPro ? (
                <span className="text-xs text-green-400">{t('unlimited')}</span>
              ) : (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>{t('freeTier')}</span>
                    <span>{license.dailyUsed} / {license.dailyLimit} {t('extractions')}</span>
                  </div>
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (license.dailyUsed / license.dailyLimit) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

// ─── Toggle helper ────────────────────────────────────────────────────────────
const Toggle: React.FC<{ label: string; value: boolean; onChange: () => void }> = ({
  label, value, onChange,
}) => (
  <div className="flex items-center justify-between py-1.5 px-1">
    <span className="text-xs text-gray-300">{label}</span>
    <button
      onClick={onChange}
      className={`relative w-8 h-4 rounded-full transition-colors ${
        value ? 'bg-indigo-500' : 'bg-gray-600'
      }`}
      role="switch"
      aria-checked={value}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
          value ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  </div>
)

export default SettingsModal
