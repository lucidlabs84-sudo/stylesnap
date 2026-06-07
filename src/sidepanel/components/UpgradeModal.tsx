import React, { useState } from 'react'
import { X, Zap, Check, Star, ArrowRight, ExternalLink, Loader2, AlertCircle, Key } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface UpgradeModalProps {
  onClose: () => void
  onActivated?: () => void
}

export const UpgradeModal: React.FC<UpgradeModalProps> = ({ onClose, onActivated }) => {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [licenseKey, setLicenseKey] = useState('')
  const [checkingOut, setCheckingOut] = useState(false)
  const [activating, setActivating] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [activateError, setActivateError] = useState('')
  const [step, setStep] = useState<'price' | 'checkout' | 'activate'>('price')

  const PRO_FEATURES = [
    { icon: '⚡', title: t('featUnlimited'),   desc: t('featUnlimitedDesc') },
    { icon: '🎨', title: t('featTailwind'),    desc: t('featTailwindDesc') },
    { icon: '⚛️',  title: t('featReactVue'),    desc: t('featReactVueDesc') },
    { icon: '🪙',  title: t('featTokens'),      desc: t('featTokensDesc') },
    { icon: '📸', title: t('featScreenshot'),  desc: t('featScreenshotDesc') },
    { icon: '✏️',  title: t('featLiveCSS'),     desc: t('featLiveCSSDesc') },
    { icon: '🤖', title: t('featAIFallback'),  desc: t('featAIFallbackDesc') },
    { icon: '🔄', title: t('featUpdates'),     desc: t('featUpdatesDesc') },
  ]

  const handleUpgrade = () => {
    setStep('checkout')
  }

  const handleCheckout = async () => {
    setCheckingOut(true)
    setCheckoutError('')
    try {
      const { createCheckout } = await import('@/lib/license')
      const url = await createCheckout(email.trim() || undefined)
      chrome.tabs.create({ url })
      // Switch to activation step so user can enter key after payment
      setStep('activate')
    } catch {
      setCheckoutError(t('checkoutError') || 'Failed to create checkout. Please try again.')
    } finally {
      setCheckingOut(false)
    }
  }

  const handleActivate = async () => {
    setActivating(true)
    setActivateError('')
    try {
      const { activateLicenseKey } = await import('@/lib/license')
      const result = await activateLicenseKey(licenseKey.trim())
      if (result.success) {
        onActivated?.()
        onClose()
      } else {
        if (result.limitReached) {
          setActivateError(t('activationLimitReached') || 'Activation limit reached (2 devices max). Deactivate another device first.')
        } else {
          setActivateError(result.error || t('activateFail') || 'Activation failed. Check your license key.')
        }
      }
    } catch {
      setActivateError(t('activateFail') || 'Activation failed. Please try again.')
    } finally {
      setActivating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-gray-900 rounded-t-2xl shadow-2xl border border-gray-700 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Gradient header */}
        <div className="relative px-5 pt-6 pb-5 bg-gradient-to-br from-indigo-900/80 via-purple-900/60 to-gray-900">
          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
          >
            <X size={16} />
          </button>

          {/* Badge */}
          <div className="flex items-center gap-1.5 mb-3">
            <div className="flex items-center gap-1 bg-amber-400/20 border border-amber-400/40 text-amber-300 text-[11px] font-semibold px-2 py-0.5 rounded-full">
              <Star size={10} fill="currentColor" />
              PRO
            </div>
          </div>

          {/* Price */}
          <h2 className="text-xl font-bold text-white mb-1">
            {t('upgradeModalTitle')}
          </h2>
          <div className="flex items-end gap-2 mb-1">
            <span className="text-3xl font-extrabold text-white">$29</span>
            <span className="text-gray-400 text-sm mb-1 line-through">$69</span>
            <span className="text-green-400 text-sm mb-1 font-medium">{t('save')} $40</span>
          </div>
          <p className="text-xs text-gray-400">
            {t('oneTime')}
          </p>
        </div>

        {step === 'price' ? (
          <>
            {/* Feature list */}
            <div className="px-4 py-3 max-h-[45vh] overflow-y-auto space-y-1.5">
              {PRO_FEATURES.map((feat, i) => (
                <div key={i} className="flex items-start gap-3 py-1.5">
                  <span className="text-base leading-none mt-0.5 flex-none">{feat.icon}</span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-200">{feat.title}</div>
                    <div className="text-[11px] text-gray-500 leading-relaxed">{feat.desc}</div>
                  </div>
                  <Check size={13} className="text-green-400 flex-none mt-0.5 ml-auto" />
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="h-px bg-gray-700 mx-4" />

            {/* Trust badges */}
            <div className="flex items-center justify-center gap-4 px-4 py-2">
              {[t('secure'), t('instant'), t('lifetime')].map(badge => (
                <span key={badge} className="text-[10px] text-gray-500">{badge}</span>
              ))}
            </div>

            {/* CTA */}
            <div className="px-4 pb-5 pt-1 space-y-2">
              <button
                onClick={handleUpgrade}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-900/40 active:scale-[0.98]"
              >
                <Zap size={15} />
                {t('upgradeToPro')}
                <ArrowRight size={15} />
              </button>

              <button
                onClick={() => setStep('activate')}
                className="w-full py-2 text-gray-400 hover:text-gray-200 text-xs flex items-center justify-center gap-1 transition-colors"
              >
                <Key size={11} />
                {t('alreadyHaveKey') || 'Already have a license key?'}
              </button>

              <button
                onClick={() => {
                  chrome.tabs.create({ url: 'https://style.lucidlibs.dev' })
                  onClose()
                }}
                className="w-full py-2 text-gray-500 hover:text-gray-300 text-xs flex items-center justify-center gap-1 transition-colors"
              >
                <ExternalLink size={11} />
                {t('learnMore')}
              </button>
            </div>
          </>
        ) : step === 'checkout' ? (
          <div className="px-4 py-6">
            <h3 className="text-sm font-semibold text-white mb-2">{t('enterEmailTitle')}</h3>
            <p className="text-xs text-gray-400 mb-4">{t('enterEmailDesc')}</p>
            
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder') || 'you@example.com'}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 mb-4"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && email.trim() && !checkingOut) {
                  handleCheckout()
                }
              }}
            />
            
            {checkoutError && (
              <div className="flex items-start gap-2 text-xs bg-red-900/20 text-red-300 border border-red-700/30 rounded-lg px-3 py-2 mb-4">
                <AlertCircle size={14} className="mt-0.5 flex-none" />
                {checkoutError}
              </div>
            )}
            
            <div className="flex gap-2">
              <button
                onClick={() => setStep('price')}
                className="flex-1 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
                disabled={checkingOut}
              >
                {t('back')}
              </button>
              <button
                onClick={handleCheckout}
                disabled={checkingOut || !email.trim() || !email.includes('@')}
                className="flex-[2] py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-900/40"
              >
                {checkingOut ? <Loader2 size={16} className="animate-spin" /> : t('continueToDodo')}
              </button>
            </div>
            <div className="mt-4 flex justify-center">
              <span className="text-[10px] text-gray-500 flex items-center gap-1">
                {t('secureDodo')}
              </span>
            </div>
          </div>
        ) : (
          /* Activate step — enter license key */
          <div className="px-4 py-6">
            <h3 className="text-sm font-semibold text-white mb-2">{t('enterLicenseKeyTitle') || 'Enter License Key'}</h3>
            <p className="text-xs text-gray-400 mb-4">
              {t('enterLicenseKeyDesc') || 'Paste the license key you received after purchase.'}
            </p>
            
            <input
              type="text"
              value={licenseKey}
              onChange={e => setLicenseKey(e.target.value.trim())}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 mb-4 font-mono tracking-wider"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && licenseKey.trim() && !activating) {
                  handleActivate()
                }
              }}
            />
            
            {activateError && (
              <div className="flex items-start gap-2 text-xs bg-red-900/20 text-red-300 border border-red-700/30 rounded-lg px-3 py-2 mb-4">
                <AlertCircle size={14} className="mt-0.5 flex-none" />
                {activateError}
              </div>
            )}
            
            <div className="flex gap-2">
              <button
                onClick={() => setStep('price')}
                className="flex-1 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
                disabled={activating}
              >
                {t('back')}
              </button>
              <button
                onClick={handleActivate}
                disabled={activating || !licenseKey.trim()}
                className="flex-[2] py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-green-900/40"
              >
                {activating ? <Loader2 size={16} className="animate-spin" /> : <><Key size={14} /> {t('activateLicense') || 'Activate'}</>}
              </button>
            </div>
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => setStep('checkout')}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                {t('needToPurchase') || "Don't have a key? Purchase now →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default UpgradeModal
