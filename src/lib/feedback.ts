/**
 * Feedback submission — StyleSnap Extension
 * Proxies to the StyleSnap serverless API; no Supabase keys in the bundle.
 */

import { PROXY_BASE_URL } from '@/shared/constants'

export interface FeedbackPayload {
  type: 'bug' | 'feature' | 'general' | 'praise'
  message: string
  email?: string
  rating?: number
  metadata?: Record<string, unknown>
}

export async function submitFeedback(payload: FeedbackPayload): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${PROXY_BASE_URL}/api/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'x-extension-id': chrome.runtime.id,
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.error || `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}
