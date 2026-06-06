import React, { useState } from 'react'
import { X, MessageSquare, Send, Loader2, Check, Mail } from 'lucide-react'
import { submitFeedback } from '../../lib/feedback'
import type { FeedbackPayload } from '../../lib/feedback'
import { useI18n } from '@/lib/i18n'

interface FeedbackModalProps {
  onClose: () => void
}

type FeedbackType = FeedbackPayload['type']

const FEEDBACK_TYPES: { value: FeedbackType; labelKey: string; emoji: string }[] = [
  { value: 'praise',  labelKey: 'feedbackPraise',  emoji: '👍' },
  { value: 'bug',     labelKey: 'feedbackBug',     emoji: '🐛' },
  { value: 'feature', labelKey: 'feedbackFeature', emoji: '💡' },
  { value: 'general', labelKey: 'feedbackGeneral', emoji: '💬' },
]

const RATING_LABELS = ['', '😞', '😕', '😐', '😊', '🤩']

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ onClose }) => {
  const { t } = useI18n()
  const [type,    setType]    = useState<FeedbackType>('general')
  const [message, setMessage] = useState('')
  const [email,   setEmail]   = useState('')
  const [rating,  setRating]  = useState(0)
  const [loading, setLoading] = useState(false)
  const [done,    setDone]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!message.trim()) return
    setLoading(true)
    setError(null)
    const res = await submitFeedback({ type, message, email: email || undefined, rating: rating || undefined })
    setLoading(false)
    if (res.ok) {
      setDone(true)
    } else {
      setError(t('feedbackError') || 'Failed to submit. Please try again.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}>
      <div
        className="w-full max-w-sm bg-gray-900 rounded-t-2xl shadow-2xl border border-gray-700 pb-safe"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <MessageSquare size={15} className="text-indigo-400" />
            <h2 className="text-sm font-semibold text-gray-100">{t('feedback')}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                <Check size={22} className="text-green-400" />
              </div>
              <p className="text-sm text-gray-200 font-medium">{t('feedbackThanks') || 'Thank you for your feedback!'}</p>
              <p className="text-xs text-gray-500">{t('feedbackThanksDesc') || 'We read every message and use it to improve StyleSnap.'}</p>
              <button onClick={onClose} className="mt-2 px-4 py-2 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-500 transition-colors">
                {t('close') || 'Close'}
              </button>
            </div>
          ) : (
            <>
              {/* Type selector */}
              <div className="grid grid-cols-4 gap-1.5">
                {FEEDBACK_TYPES.map(ft => (
                  <button
                    key={ft.value}
                    onClick={() => setType(ft.value)}
                    className={`flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] border transition-colors ${
                      type === ft.value
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                    }`}
                  >
                    <span className="text-base">{ft.emoji}</span>
                    <span>{t(ft.labelKey as any) || ft.value}</span>
                  </button>
                ))}
              </div>

              {/* Message */}
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder={t('feedbackPlaceholder') || 'Tell us what you think…'}
                rows={4}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 resize-none"
              />

              {/* Rating */}
              <div>
                <p className="text-[10px] text-gray-500 mb-1.5">{t('feedbackRating') || 'Overall experience (optional)'}</p>
                <div className="flex gap-2">
                  {[1,2,3,4,5].map(n => (
                    <button
                      key={n}
                      onClick={() => setRating(n === rating ? 0 : n)}
                      className={`flex-1 text-xl py-1 rounded-lg border transition-colors ${
                        rating === n ? 'bg-amber-500/10 border-amber-500' : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                      }`}
                      title={String(n)}
                    >
                      {RATING_LABELS[n]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Email */}
              <div className="flex items-center gap-2 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2">
                <Mail size={13} className="text-gray-500 flex-none" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t('feedbackEmailPlaceholder') || 'Email (optional, for replies)'}
                  className="flex-1 bg-transparent text-xs text-gray-200 placeholder-gray-600 outline-none"
                />
              </div>

              {error && (
                <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                onClick={handleSubmit}
                disabled={loading || !message.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loading
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Send size={14} />
                }
                {t('feedbackSubmit') || 'Send Feedback'}
              </button>

              {/* Contact footer */}
              <p className="text-center text-[10px] text-gray-600">
                {t('feedbackContactHint') || 'Need direct help?'}{' '}
                <a
                  href="mailto:lucidlibs@outlook.com"
                  className="text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  lucidlibs@outlook.com
                </a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default FeedbackModal
