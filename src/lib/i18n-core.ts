export type Language = 'en' | 'zh'

/** Country code → language mapping for IP-based detection */
export const COUNTRY_LANG_MAP: Record<string, Language> = {
  CN: 'zh',
  TW: 'zh',
  HK: 'zh',
  MO: 'zh',
  SG: 'zh',
}

/** Detect language from browser's navigator */
export function detectFromBrowser(): Language | null {
  const langs = navigator.languages || [navigator.language]
  for (const l of langs) {
    if (l.startsWith('zh')) return 'zh'
  }
  return null
}

/** Detect language from IP geolocation (async, may fail) */
export async function detectFromIP(): Promise<Language | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return null
    const data = await res.json()
    const country: string = data.country_code
    return COUNTRY_LANG_MAP[country] ?? null
  } catch {
    return null
  }
}

/** Detect language with full priority chain */
export async function detectLang(): Promise<Language> {
  // 1. Check saved preference
  const stored = await chrome.storage.local.get(['language'])
  if (stored.language === 'zh' || stored.language === 'en') return stored.language

  // 2. Browser language
  const browser = detectFromBrowser()
  if (browser) return browser

  // 3. IP geolocation
  const ip = await detectFromIP()
  if (ip) return ip

  // 4. Fallback
  return 'en'
}

export const translations = {
  en: {
    // App
    inspect: 'Inspect',
    export: 'Export',
    tokens: 'Tokens',
    startInspecting: 'Start Inspecting',
    inspecting: 'Inspecting… (ESC to stop)',
    freeQuota: 'Free: {used} / {limit} today',
    upgradeUnlimited: 'Upgrade for unlimited →',
    pro: 'Pro $29',
    settings: 'Settings',
    cannotInspect: 'Cannot inspect this page. Please try on a normal website.',
    failedConnect: 'Failed to connect to the page. Please refresh the page and try again.',
    // Inspect Tab
    emptyInspect1: 'Click <strong>Start Inspecting</strong> above<br/>or the floating button on the page<br/>then hover over any element',
    emptyInspect2: 'Hover over an element to inspect it',
    properties: 'Properties',
    rawCSS: 'Raw CSS',
    copyCSS: 'Copy CSS',
    copyTW: 'Copy Tailwind',
    upgradeToCopyTW: 'Upgrade to copy Tailwind classes',
    // Export Tab
    selectElement: 'Hover over an element and click to select it',
    useExport: 'Then use Export to generate component code',
    style: 'Style:',
    inline: 'Inline',
    proFeature: 'Pro feature',
    upgradeToUnlock: 'Upgrade to unlock {format} export.',
    upgrade: 'Upgrade',
    // Tokens Tab
    proTokenTitle: 'Pro feature — Design Token Extraction',
    proTokenDesc: 'Extract your entire design system: color palette, typography scale, spacing, and more.',
    extractTokensTitle: 'Extract Design Tokens',
    extractTokensDesc: 'Scan the current page to extract global colors, fonts, and spacing into standard formats.',
    scanning: 'Scanning page...',
    extractTokensBtn: 'Extract Tokens',
    // Upgrade Modal
    upgradeModalTitle: 'StyleSnap Pro',
    save: 'Save',
    oneTime: 'One-time payment · Lifetime access · No subscription',
    secure: '🔒 Secure checkout',
    instant: '📧 Instant delivery',
    lifetime: '♾️ Lifetime deal',
    upgradeToPro: 'Upgrade to Pro — $29',
    learnMore: 'Learn more at lucidlibs.dev/stylesnap',
    // Checkout
    enterEmailTitle: 'Enter your email for checkout',
    enterEmailDesc: "We'll use this to send your license and receipt via Dodo Payments.",
    emailPlaceholder: 'you@example.com',
    back: 'Back',
    continueToDodo: 'Continue to Dodo Payments',
    secureDodo: '🔒 Secure payment powered by Dodo',
    checkoutError: 'Failed to create checkout. Please try again.',
    // Features
    featUnlimited: 'Unlimited extractions',
    featUnlimitedDesc: 'No daily limits, extract as many elements as you want',
    featTailwind: 'Tailwind class export',
    featTailwindDesc: 'One-click CSS → Tailwind conversion with 300+ mapping rules',
    featReactVue: 'React / Vue code gen',
    featReactVueDesc: 'Generate ready-to-paste React components or Vue SFCs',
    featTokens: 'Design token export',
    featTokensDesc: 'Extract your entire color palette, typography & spacing system',
    featScreenshot: 'Annotated screenshots',
    featScreenshotDesc: 'Screenshot any page with auto-measured dimension & style labels',
    featLiveCSS: 'Live CSS editing',
    featLiveCSSDesc: 'Edit any element style in real-time directly from the side panel',
    featAIFallback: 'AI code fallback',
    featAIFallbackDesc: 'AI-powered conversion for complex patterns that rules can\'t handle',
    featUpdates: 'Lifetime updates',
    featUpdatesDesc: 'All future features included — pay once, own forever',
    // Settings Modal
    license: 'License',
    proActivated: 'StyleSnap Pro — Activated',
    remove: 'Remove',
    activate: 'Activate',
    activating: '…',
    activateSuccess: 'License activated! Enjoy StyleSnap Pro.',
    activateFail: 'Invalid or already-used license key. Please check and try again.',
    activationLimitReached: 'Activation limit reached (2 devices max). Deactivate another device first.',
    enterLicenseKeyTitle: 'Enter License Key',
    enterLicenseKeyDesc: 'Paste the license key you received after purchase (format: PRO-XXXX-XXXX-XXXX).',
    activateLicense: 'Activate',
    alreadyHaveKey: 'Already have a license key?',
    needToPurchase: "Don't have a key? Purchase now →",
    forgotLicenseKey: 'Forgot your license key?',
    licenseKeyLabel: 'License Key',
    devicesLabel: 'Devices',
    emailLabel: 'Email',
    instanceIdLabel: 'Instance',
    activatedAtLabel: 'Activated',
    expiresAtLabel: 'Expires',
    licenseExpired: 'License Expired',
    licenseDisabled: 'License Disabled',
    deactivationConfirm: 'Remove license from this device? You can re-activate later.',
    theme: 'Theme',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
    aiCode: 'AI Code Generation',
    aiCodeDesc: 'Provide your own OpenAI-compatible API key to enable AI fallback for complex CSS → code conversions.',
    behavior: 'Behavior',
    showOverlay: 'Show overlay highlight on hover',
    showFloatingBtn: 'Show Floating Button',
    autoInspect: 'Auto-inspect on extension open',
    copySound: 'Copy feedback sound',
    autoOpenSidePanel: 'Open side panel on inspect',
    // Floating Button Tooltips
    btnTooltip: 'StyleSnap\nClick: Toggle Side Panel\nDrag: Move Button',
    btnInspect: 'Inspect Element',
    btnPanel: 'Toggle Side Panel',
    btnAssist: 'Toggle Assist Mode',
    btnMode: 'Cycle mode: Off → Inspect → Guidelines → Grid  [G]',
    btnCopyCSS: 'Copy CSS of selected element',
    btnCollapse: 'Collapse to edge',
    // Assist Mode
    assistModeLabel: 'Assist Mode',
    assistOff: 'Off',
    assistGuidelines: 'Guidelines (Crosshairs)',
    assistGrid: 'Grid (Outlines)',
    usage: "Today's Usage",
    unlimited: 'Unlimited (Pro)',
    freeTier: 'Free tier',
    extractions: 'extractions',
    cancel: 'Cancel',
    saveSettings: 'Save Settings',
    saved: 'Saved',
    // Feedback Modal
    feedback: 'Feedback',
    feedbackPraise: 'Love It',
    feedbackBug: 'Bug',
    feedbackFeature: 'Request',
    feedbackGeneral: 'Other',
    feedbackPlaceholder: 'Tell us what you think…',
    feedbackRating: 'Overall experience (optional)',
    feedbackEmailPlaceholder: 'Email (optional, for replies)',
    feedbackSubmit: 'Send Feedback',
    feedbackThanks: 'Thank you! 🙌',
    feedbackThanksDesc: 'We read every message and use it to improve StyleSnap.',
    feedbackError: 'Failed to submit. Please try again.',
    feedbackContactHint: 'Need direct help?',
    close: 'Close',
  },
  zh: {
    // App
    inspect: '审查',
    export: '导出',
    tokens: '变量',
    startInspecting: '开始审查',
    inspecting: '审查中… (按 ESC 停止)',
    freeQuota: '免费额度: {used} / {limit} (今日)',
    upgradeUnlimited: '升级无限制版本 →',
    pro: '专业版 $29',
    settings: '设置',
    cannotInspect: '无法审查此页面，请在普通网页上重试。',
    failedConnect: '连接页面失败。请刷新页面后重试。',
    // Inspect Tab
    emptyInspect1: '点击上方的 <strong>开始审查</strong><br/>或者网页右下角的悬浮按钮<br/>然后将鼠标悬停在任意元素上',
    emptyInspect2: '将鼠标悬停在元素上以查看样式',
    properties: '可视属性',
    rawCSS: '原始 CSS',
    copyCSS: '复制 CSS',
    copyTW: '复制 Tailwind',
    upgradeToCopyTW: '升级以复制 Tailwind 类名',
    // Export Tab
    selectElement: '将鼠标悬停在元素上并点击选择',
    useExport: '然后使用导出功能生成组件代码',
    style: '样式:',
    inline: '内联样式 (Inline)',
    proFeature: '专业版功能',
    upgradeToUnlock: '升级以解锁 {format} 代码导出。',
    upgrade: '升级',
    // Tokens Tab
    proTokenTitle: '专业版功能 — 设计变量提取',
    proTokenDesc: '一键提取整个网站的设计系统：调色板、排版字体、间距等。',
    extractTokensTitle: '提取设计变量 (Design Tokens)',
    extractTokensDesc: '扫描当前页面，提取颜色、字体、间距等全局设计规范，并导出为标准格式。',
    scanning: '正在扫描页面...',
    extractTokensBtn: '提取设计变量',
    // Upgrade Modal
    upgradeModalTitle: 'StyleSnap 专业版',
    save: '立省',
    oneTime: '一次性付费 · 终身可用 · 无需订阅',
    secure: '🔒 安全支付',
    instant: '📧 即时开通',
    lifetime: '♾️ 终身授权',
    upgradeToPro: '升级到专业版 — $29',
    learnMore: '访问 lucidlibs.dev/stylesnap 了解更多',
    // Checkout
    enterEmailTitle: '请输入您的邮箱',
    enterEmailDesc: '我们将使用此邮箱通过 Dodo Payments 发送您的许可证和收据。',
    emailPlaceholder: 'your@email.com',
    back: '返回',
    continueToDodo: '前往 Dodo Payments 结账',
    secureDodo: '🔒 Dodo 提供安全支付保障',
    checkoutError: '创建结账失败，请重试。',
    // Features
    featUnlimited: '无限制提取',
    featUnlimitedDesc: '告别每日额度限制，随心所欲提取任何元素',
    featTailwind: '导出 Tailwind 类名',
    featTailwindDesc: '一键 CSS → Tailwind 转换，内置 300+ 映射规则',
    featReactVue: '生成 React / Vue 代码',
    featReactVueDesc: '一键生成开箱即用的 React 组件或 Vue 单文件组件',
    featTokens: '导出设计变量',
    featTokensDesc: '提取网站完整的调色板、排版比例和间距系统',
    featScreenshot: '带标注的截图',
    featScreenshotDesc: '对任意页面进行截图，自动标注尺寸和样式信息',
    featLiveCSS: '实时编辑 CSS',
    featLiveCSSDesc: '直接在侧边栏中实时编辑并预览任何元素的样式',
    featAIFallback: 'AI 智能后备',
    featAIFallbackDesc: '对于复杂样式，调用 AI 能力进行精准的代码转换',
    featUpdates: '终身免费更新',
    featUpdatesDesc: '包含未来所有新功能 — 一次买断，终身拥有',
    // Settings Modal
    license: '许可证',
    proActivated: 'StyleSnap 专业版 — 已激活',
    remove: '移除',
    activate: '激活',
    activating: '…',
    activateSuccess: '许可证已激活！尽情使用 StyleSnap 专业版吧。',
    activateFail: '无效或已被使用的许可证密钥。请检查后重试。',
    activationLimitReached: '激活次数已达上限（最多 2 台设备）。请先停用其他设备。',
    enterLicenseKeyTitle: '输入许可证密钥',
    enterLicenseKeyDesc: '粘贴购买后收到的许可证密钥（格式：PRO-XXXX-XXXX-XXXX）。',
    activateLicense: '激活',
    alreadyHaveKey: '已有许可证密钥？',
    needToPurchase: '还没有密钥？立即购买 →',
    forgotLicenseKey: '忘记许可证密钥？',
    licenseKeyLabel: '许可证密钥',
    devicesLabel: '设备',
    emailLabel: '邮箱',
    instanceIdLabel: '实例',
    activatedAtLabel: '激活时间',
    expiresAtLabel: '到期时间',
    licenseExpired: '许可证已过期',
    licenseDisabled: '许可证已禁用',
    deactivationConfirm: '确定从此设备移除许可证？您可以稍后重新激活。',
    theme: '主题',
    light: '浅色',
    dark: '深色',
    system: '系统',
    aiCode: 'AI 代码生成',
    aiCodeDesc: '提供您自己的兼容 OpenAI 格式的 API 密钥，以便在复杂的 CSS → 代码转换中启用 AI 后备处理。',
    behavior: '行为',
    showOverlay: '悬停时显示高亮遮罩',
    showFloatingBtn: '显示网页悬浮按钮',
    autoInspect: '打开扩展时自动开启审查',
    copySound: '复制成功提示音',
    autoOpenSidePanel: '进入审查时打开侧边栏',
    // Floating Button Tooltips
    btnTooltip: 'StyleSnap\n点击：开关侧边栏\n拖拽：移动位置',
    btnInspect: '审查元素',
    btnPanel: '开关侧边栏',
    btnAssist: '切换辅助线模式',
    btnMode: '循环模式：关闭 → 审查 → 参考线 → 网格  [G]',
    btnCopyCSS: '复制选中元素的 CSS',
    btnCollapse: '收起到屏幕边缘',
    // Assist Mode
    assistModeLabel: '辅助线模式',
    assistOff: '关闭',
    assistGuidelines: '十字对齐线',
    assistGrid: '全局网格框',
    usage: "今日使用量",
    unlimited: '无限制 (专业版)',
    freeTier: '免费额度',
    extractions: '次提取',
    cancel: '取消',
    saveSettings: '保存设置',
    saved: '已保存',
    // Feedback Modal
    feedback: '反馈',
    feedbackPraise: '很棒',
    feedbackBug: '报告Bug',
    feedbackFeature: '功能建议',
    feedbackGeneral: '其他',
    feedbackPlaceholder: '告诉我们您的想法…',
    feedbackRating: '总体体验（可选）',
    feedbackEmailPlaceholder: '邮箱（可选，方便回复）',
    feedbackSubmit: '提交反馈',
    feedbackThanks: '感谢您的反馈！🙌',
    feedbackThanksDesc: '我们会认真阅读每一条反馈，用于持续改进 StyleSnap。',
    feedbackError: '提交失败，请重试。',
    feedbackContactHint: '需要直接帮助？',
    close: '关闭',
  }
}

export type TranslationKey = keyof typeof translations.en
