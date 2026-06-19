# StyleSnap 优化点清单

> 记录所有已做但被 `git restore` 清除的优化，防止遗漏。
> 每完成一项，打 ✅ 并 commit。

---

## 🔧 一、安全加固

- [ ] **license.ts 封装 proxyFetch()**
  - 所有对 proxy 的请求自动带 `x-extension-id` header
  - `createCheckout()` / `activateLicense()` / `validateLicense()` / `deactivateLicense()` 全部改用 `proxyFetch()`
  - 文件：`src/lib/license.ts`

- [ ] **proxy checkout.js / verify.js 安全加固**
  - CORS 严格校验 `x-extension-id`
  - Rate Limit 改用 Upstash Redis（`ratelimit:checkout:{ip}`）
  - 文件：`stylesnap-proxy/api/checkout.js`、`verify.js`

- [ ] **proxy webhook.js license 持久化**
  - `payment.succeeded` 时将 license 写入 Upstash Redis
  - 使用 Resend API 发送 license 邮件
  - 文件：`stylesnap-proxy/api/webhook.js`

---

## 🚀 二、性能优化

- [ ] **ExportTab Web Worker 重构**
  - 创建 `src/lib/exportWorker.ts`（Web Worker）
  - `exportWorker.ts` 从 `shared/css-utils.js` 导入共享函数
  - `ExportTab.tsx` 改用 Worker 异步生成代码，避免主线程卡死
  - Worker 中用 `require()` 导入共享模块（绕过 TypeScript 类型问题）
  - 文件：`src/lib/exportWorker.ts`、`src/sidepanel/tabs/ExportTab.tsx`

- [ ] **shared/css-utils.js 共享模块**
  - 包含 `cssToTailwind()`、`htmlToJSX()`、`generateReactComponent()`、`generateVueComponent()`
  - `exportWorker.ts` 和 `tailwind-mapper.ts` 都使用这套共享逻辑
  - 文件：`src/lib/shared/css-utils.js`

---

## 🏗️ 三、代码架构重构

- [ ] **content/index.ts 模块化拆分**
  - 拆分成 5 个模块：
    - `src/content/modules/state.ts` — 全局状态管理
    - `src/content/modules/guides.ts` — 辅助引导线
    - `src/content/modules/overlay.ts` — 遮罩层
    - `src/content/modules/highlight.ts` — 元素高亮
    - `src/content/modules/floating-button.ts` — 悬浮球 UI
  - 主文件 `content/index.ts` 只保留初始化和事件监听
  - 文件：`src/content/index.ts` + 5 个模块文件

- [ ] **toast 通知系统**
  - 创建 `src/lib/toast.ts`，使用 `chrome.notifications` API
  - 提供 `showSuccess()` / `showError()` / `showWarning()` / `showInfo()`
  - 集成到：
    - `background/index.ts` — 全局错误通知
    - `sidepanel/App.tsx` — UI 操作反馈
    - `sidepanel/tabs/ExportTab.tsx` — 导出结果通知
    - `content/index.ts` — content script 错误通知
  - 文件：`src/lib/toast.ts`、`manifest.json`（添加 `notifications` 权限）

---

## 🎨 四、用户体验改进

- [ ] **UpgradeModal 支付后体验**
  - 支付成功后设置 `stylesnap_pending_activation: true` 标志
  - 激活成功后清除标志
  - Header 显示 `🎉 Activate Pro` 按钮（待激活状态时）
  - 文件：`src/sidepanel/components/UpgradeModal.tsx`、`src/sidepanel/App.tsx`

- [ ] **SettingsModal API Key 显示/隐藏**
  - AI API Key 输入框添加眼睛图标切换显示/隐藏
  - 添加 `showApiKey` state
  - 文件：`src/sidepanel/components/SettingsModal.tsx`

- [ ] **i18n 补全**
  - `src/lib/i18n-core.ts` 补全缺失的 key：
    - `checkoutError`、`back`、`emailLabel`、`emailHint`、`loading`、`payWith`、`secureCheckout`
  - 文件：`src/lib/i18n-core.ts`

---

## 🔄 五、CI/CD

- [ ] **StyleSnap CI 配置**
  - 创建 `.github/workflows/ci.yml`
  - TypeScript 类型检查 + Vite 构建
  - 文件：`.github/workflows/ci.yml`

- [ ] **Proxy CI 配置**
  - 创建 `stylesnap-proxy/.github/workflows/ci.yml`
  - ESLint + Vercel 部署
  - 文件：`stylesnap-proxy/.github/workflows/ci.yml`

---

## 🐛 六、Bug 修复（已发现）

- [ ] **`overlay.css` 重复 emit 警告**
  - 把 `src/content/overlay.css` 移到 `public/` 目录
  - 或从 `vite.config.ts` 排除该文件
  - 文件：`vite.config.ts`

- [ ] **`license.ts` `proxyFetch()` 函数定义**
  - 确保 `proxyFetch()` 在 `license.ts` 中正确定义
  - 或用 `BACKGROUND_PROXY_BASE_URL` 直接 fetch（不经过 content script）

---

## 📋 完成标准

每项完成后：
1. `git add . && git commit -m "feat: xxx"`
2. `npm run build` 通过（0 TypeScript 错误）
3. 同步到 Claw 目录：`rm -rf src && cp -r /Users/fanyi/Documents/lucidlibs/stylesnap/src .`
4. Claw 目录 `npm run build` 通过
5. 在 Chrome 中重新加载扩展，手动验证功能

---

## 🤖 自动化测试（待实现）

- [ ] **Puppeteer 自动化测试脚本**
  - 自动加载扩展
  - 检查悬浮球是否出现
  - 测试 Inspector 功能
  - 文件：`test-extension.js`（或 `test-web-capture.mjs`）

- [ ] **Playwright Chrome Extension Testing**
  - 研究 `@crxjs/vite-plugin` 官方测试方案
  - 或改用 Playwright 官方 `chrome.extend()` API
  - 编写端到端测试

---

*最后更新：2026-06-19*
