# StyleSnap — Edge Add-ons Store Submission

> 提交入口：https://partner.microsoft.com/dashboard/microsoftedge/overview
> 需要 Microsoft Partner Center 账号（用个人 Microsoft 账号注册即可）

---

## 📦 提交包

| 文件 | 说明 |
|------|------|
| `dist-edge.zip` | 扩展程序包（69KB），直接上传 |
| `screenshots/01-css-inspection.png` | CSS 实时检查截图 |
| `screenshots/02-tailwind-export.png` | Tailwind 类名导出截图 |
| `screenshots/03-design-tokens.png` | 设计变量提取截图 |
| `screenshots/04-ai-prompt.png` | AI 提示词生成截图 |
| `promo-small.png` | 搜索列表小图（440×280） |
| `promo-medium.png` | 产品页横幅（1400×560） |

所有文件在 `~/Documents/lucidlibs/stylesnap/edge-submission/` 目录下。

---

## 📝 Store 上架信息

### 基本信息

| 字段 | 内容 |
|------|------|
| **名称** | StyleSnap - CSS Inspector & Design Token Exporter |
| **简短描述** | Instantly inspect any element's CSS, convert to Tailwind classes, and extract design tokens — all without leaving your browser. |
| **类别** | Developer Tools |
| **价格** | 免费（Free）— 扩展本体免费安装，Pro 功能在扩展内付费 |
| **网站** | https://lucidlibs.dev/stylesnap |
| **隐私政策** | https://lucidlibs.dev/stylesnap（需要单独添加隐私声明页面） |
| **支持邮箱** | 你的邮箱地址 |

### 详细描述（英文）

```
StyleSnap is the fastest way to extract and convert CSS from any website.

✨ CORE FEATURES:

🔍 Instant CSS Inspection
Hover over any element and see all computed CSS properties organized by category: Layout, Typography, Visual, Flex/Grid. No more digging through DevTools.

🌀 Tailwind Class Export
Deterministic CSS-to-Tailwind conversion with 300+ mapping rules. No AI hallucinations — every class maps to a real Tailwind utility.

🎨 Design Token Extraction
Extract complete color palettes, spacing scales, and typography systems from any element or entire page. Export as JSON.

🤖 AI Prompt Generation
Select any element and get a ready-to-use prompt for AI tools like v0, Bolt, or Cursor AI. Describe any component in natural language.

📋 Multiple Export Formats
Copy CSS as plain text, JSON, or Tailwind classes. Export directly to CodePen with one click.

⚡ Why StyleSnap?
- Works on ANY website — Tailwind, Bootstrap, custom CSS, doesn't matter
- No sidebars, no popups — the CSS overlay appears right next to the element
- Edit CSS values directly on the page and see changes instantly
- One-time purchase, lifetime access

💎 StyleSnap Pro ($29 lifetime):
Unlock CSS export, Tailwind conversion, CodePen export, Design Token extraction, and AI Prompt generation. Install free, upgrade when you need pro features.
```

### 搜索关键词

```
CSS inspector, CSS extractor, Tailwind converter, CSS to Tailwind, design tokens, 
CSS export, developer tools, web design, frontend tools, CSS scan, code export, 
AI prompt, CSS copy, style extractor, designer tool
```

### 截图说明文字

| 文件 | Caption |
|------|---------|
| 01-css-inspection.png | Hover any element to see all computed CSS properties in an organized overlay |
| 02-tailwind-export.png | One-click CSS to Tailwind conversion with deterministic class mapping |
| 03-design-tokens.png | Extract complete color palettes, spacing, and typography systems |
| 04-ai-prompt.png | Generate ready-to-use AI prompts for v0, Bolt, or Cursor AI |

---

## 🚀 提交流程

1. 打开 https://partner.microsoft.com/dashboard/microsoftedge/overview
2. 登录 Microsoft 账号（免费注册 Partner Center）
3. 点击 "Create new extension"
4. 上传 `dist-edge.zip`
5. 填写上面的上架信息
6. 上传 4 张截图（1280×800）→ 在 `screenshots/` 目录
7. 上传促销图片：
   - Small promo tile → `promo-small.png`（440×280）
   - Medium promo tile → `promo-medium.png`（1400×560）
8. 填写隐私政策 URL
9. 提交审核

审核通常 1-3 个工作日。

---

## ⚠️ 待处理

- [ ] **隐私政策页面**：Edge 要求有隐私政策 URL。建议在 lucidlibs.dev 添加 `/privacy` 页面
- [ ] **版本号**：当前 manifest 版本 `1.0.0`，首次提交用这个即可
- [ ] **支持邮箱**：填写你的真实邮箱
