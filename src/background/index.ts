/**
 * Background Service Worker
 * Handles: toolbar icon toggle, context menu, tab communication
 */

import { showInfo } from '../lib/notifications'
import { checkAndValidateLicense } from '../lib/license'

// Toolbar icon click → toggle inspect in current tab
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_INSPECT' }).catch(() => {
      // Ignore — tab may be a restricted page where content script can't run
    })
  }
})

// Set up context menu and welcome notification on install
chrome.runtime.onInstalled.addListener(() => {
  // (native side-panel was removed — the tool is hover-only now; the toolbar
  // click is handled by chrome.action.onClicked above.)

  // Right-click toolbar icon → Settings
  chrome.contextMenus.create({
    id: 'stylesnap-settings',
    title: 'Settings',
    contexts: ['action'],
  })

  showInfo('StyleSnap installed! Click the toolbar icon to inspect elements.')
  checkAndValidateLicense()
})

chrome.runtime.onStartup.addListener(() => {
  checkAndValidateLicense()
})

// Context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'stylesnap-settings' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'SHOW_SETTINGS' }).catch(() => {})
  }
})

// Message relay between content script and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Relay element info from content script to side panel
  if (message.type === 'ELEMENT_HOVERED' || message.type === 'ELEMENT_CLICKED') {
    // Broadcast to all extension pages
    chrome.runtime.sendMessage(message).catch(() => {
      // Side panel might not be open, ignore
    })
    sendResponse({ ok: true })
    return false // Synchronous response, no need to keep channel open
  }

  // Take screenshot for annotation
  if (message.type === 'CAPTURE_SCREENSHOT') {
    const tabId = sender.tab?.id
    if (!tabId) {
      sendResponse({ error: 'No tab ID' })
      return false
    }

    chrome.tabs.captureVisibleTab(
      sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT,
      { format: 'png', quality: 100 },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message })
        } else {
          sendResponse({ dataUrl })
        }
      }
    )
    return true // Keep channel open for async response
  }

  // Inject/enable inspector, or edit CSS on current tab
  if (['INIT_INSPECTOR', 'DISABLE_INSPECTOR', 'EDIT_CSS'].includes(message.type)) {
    // Find active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) return
      chrome.tabs.sendMessage(tab.id, message).catch(console.error)
    })
    sendResponse({ ok: true })
    return false // Synchronous response
  }

  // Extract design tokens from active tab
  if (message.type === 'EXTRACT_TOKENS') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) {
        sendResponse({ error: 'No active tab' })
        return
      }
      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message })
        } else {
          sendResponse(response)
        }
      })
    })
    return true // Keep channel open for async response
  }

  return false
})