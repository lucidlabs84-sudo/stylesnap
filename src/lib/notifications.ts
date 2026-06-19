/**
 * Chrome Notifications Helper — StyleSnap
 * Uses chrome.notifications API (requires "notifications" permission in manifest.json).
 */

export interface NotificationOptions {
  title: string
  message: string
  iconUrl?: string
  priority?: 0 | 1 | 2   // 0=default, 1=low, 2=high
  duration?: number      // auto-dismiss after ms (default: 4000)
}

/**
 * Show a Chrome notification (toast).
 * Falls back to console.log if notifications API is not available.
 */
export function showNotification(opts: NotificationOptions): void {
  if (!chrome?.notifications) {
    console.log(`[StyleSnap Notification] ${opts.title}: ${opts.message}`)
    return
  }

  const id = `stylesnap-${Date.now()}`
  const iconUrl = opts.iconUrl || chrome.runtime.getURL('icons/icon128.png')

  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl,
    title: opts.title,
    message: opts.message,
    priority: opts.priority ?? 0,
  }, () => {
    // Auto-dismiss after duration (default 4s)
    const duration = opts.duration ?? 4000
    setTimeout(() => {
      chrome.notifications.clear(id)
    }, duration)
  })
}

/**
 * Shortcut: Show a "success" notification (green-ish, high priority)
 */
export function showSuccess(message: string): void {
  showNotification({
    title: '✅ StyleSnap',
    message,
    priority: 1,
    duration: 3000,
  })
}

/**
 * Shortcut: Show an "error" notification (red-ish, high priority)
 */
export function showError(message: string): void {
  showNotification({
    title: '❌ StyleSnap',
    message,
    priority: 2,
    duration: 5000,
  })
}

/**
 * Shortcut: Show an "info" notification (neutral)
 */
export function showInfo(message: string): void {
  showNotification({
    title: 'ℹ️ StyleSnap',
    message,
    priority: 0,
    duration: 4000,
  })
}
