/**
 * Background Service Worker
 * Handles: side panel behavior, tab communication
 */

// Enable side panel for all tabs
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(console.error)
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

  // Toggle side panel from content script
  // NOTE: chrome.sidePanel.open() requires a user gesture context.
  // The message is sent synchronously from a click handler in the content script,
  // so the call here is still within the gesture window — DO NOT wrap it in
  // any async callback (e.g. PING round-trip), as that will break the gesture context.
  if (message.type === 'TOGGLE_SIDE_PANEL') {
    const tabId = sender.tab?.id
    const windowId = sender.tab?.windowId
    if (tabId && windowId) {
      // Directly open the side panel — keeping it synchronous preserves the user gesture context.
      // Chrome MV3 does not provide a reliable way to programmatically close the side panel,
      // so we always call open(). If it is already open, the call is a no-op on most Chrome versions.
      chrome.sidePanel.open({ tabId, windowId }).catch(console.error)
    }
    sendResponse({ ok: true })
    return false
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