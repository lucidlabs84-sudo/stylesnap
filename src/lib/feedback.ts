/**
 * Feedback submission — StyleSnap Extension
 * Stores to Supabase feedback table (anon insert, RLS enabled)
 */

const SUPABASE_URL = 'https://wwsjfjrbqlarzyjwpyys.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3c2pmanJicWxhcnp5andweXlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MDEyNzUsImV4cCI6MjA5NjI3NzI3NX0.It6-uL7XQdVNrm7TU-VSBQGRWZhg3UQuWyljpY1hykA'

export interface FeedbackPayload {
  type: 'bug' | 'feature' | 'general' | 'praise'
  message: string
  email?: string
  rating?: number
}

export async function submitFeedback(payload: FeedbackPayload): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        source: 'extension',
        type: payload.type,
        message: payload.message.trim(),
        email: payload.email?.trim() || null,
        rating: payload.rating ?? null,
        metadata: {
          version: chrome.runtime?.getManifest?.()?.version || 'unknown',
          lang: navigator.language,
        },
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: text || `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}
