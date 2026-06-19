# StyleSnap 自动化测试方案

## 调研结果（2026-06-19）

### ✅ 可行方案：Playwright + launch_persistent_context

Playwright 官方支持加载 Chrome 扩展并自动化测试，**支持 MV3**。

---

## 核心代码（Python 版，Playwright 官方文档）

### 1. 加载 MV3 扩展

```python
from playwright.sync_api import sync_playwright

path_to_extension = "/Users/fanyi/Documents/lucidlibs/stylesnap/dist"
user_data_dir = "/tmp/stylesnap-test-user-data"

def run(playwright):
    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        channel="chromium",   # 必须用 chromium 通道
        args=[
            f"--disable-extensions-except={path_to_extension}",
            f"--load-extension={path_to_extension}",
        ],
    )
    
    # 等待 Service Worker 启动（MV3 扩展的 background）
    if len(context.service_workers) == 0:
        service_worker = context.wait_for_event('serviceworker')
    else:
        service_worker = context.service_workers[0]
    
    # 获取扩展 ID
    extension_id = service_worker.url.split("/")[2]
    print(f"Extension ID: {extension_id}")
    
    # 打开测试页面
    page = context.new_page()
    page.goto("http://localhost:8080/test-page.html")
    
    # 测试 content script：检查悬浮球是否出现
    page.wait_for_timeout(2000)
    floating_ball = page.query_selector("#stylesnap-floating-ball")
    assert floating_ball is not None, "悬浮球未出现！"
    
    context.close()

with sync_playwright() as p:
    run(p)
```

---

### 2. 测试 Side Panel（MV3 难点）

Chrome Side Panel **无法通过 Playwright 直接自动化**（需要点击扩展图标）。

**替代方案**：
- 直接用 `page.goto(f"chrome-extension://{extension_id}/sidepanel.html")` 打开 side panel
- 但 Side Panel 是单独的页面，需要新 context 或新 page

```python
# 打开 side panel 页面
side_panel_page = context.new_page()
side_panel_page.goto(f"chrome-extension://{extension_id}/src/sidepanel/index.html")

# 等待页面加载
side_panel_page.wait_for_load_state("networkidle")

# 检查 Inspector 按钮是否存在
inspect_btn = side_panel_page.query_selector("button:has-text('Enable Inspector')")
assert inspect_btn is not None, "Side Panel 加载失败！"
```

---

### 3. 测试 Content Script（Inspector 功能）

```python
# 在测试页面上模拟点击，触发 content script
page = context.new_page()
page.goto("http://localhost:8080/test-page.html")

# 等待 content script 加载
page.wait_for_timeout(1000)

# 点击扩展图标，发送消息启动 Inspector
# （需要通过 background service worker 转发）
service_worker.evaluate("""
    chrome.tabs.query({active: true}, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'INIT_INSPECTOR' })
    })
""")

# 检查页面是否出现遮罩层
page.wait_for_timeout(1000)
overlay = page.query_selector("#stylesnap-overlay")
assert overlay is not None, "Inspector 遮罩层未出现！"
```

---

### 4. 处理 MV3 Service Worker 挂起问题

Chrome MV3 Service Worker 约 **30 秒不活动后会自动挂起**。

Playwright 会自动处理重启，但正在执行的 `evaluate()` 会抛出 `"Service worker restarted"` 错误。

```python
sw = context.wait_for_event('serviceworker')

# ... SW 挂起后自动重启，句柄仍然有效 ...
sw.evaluate("chrome.runtime.sendMessage({ type: 'ping' })")  # 自动恢复
```

---

## 完整测试脚本（目标）

```python
# test_stylesnap.py
import pytest
from playwright.sync_api import sync_playwright, BrowserContext, Page

EXTENSION_PATH = "/Users/fanyi/Documents/lucidlibs/stylesnap/dist"
TEST_PAGE = "http://localhost:8080/test-page.html"


@pytest.fixture
def context() -> BrowserContext:
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            "/tmp/stylesnap-test",
            channel="chromium",
            args=[
                f"--load-extension={EXTENSION_PATH}",
                f"--disable-extensions-except={EXTENSION_PATH}",
            ],
        )
        yield ctx
        ctx.close()


@pytest.fixture
def extension_id(context) -> str:
    sw = context.service_workers[0] or context.wait_for_event("serviceworker")
    return sw.url.split("/")[2]


@pytest.fixture
def page(context, extension_id) -> Page:
    p = context.new_page()
    p.goto(TEST_PAGE)
    yield p
    p.close()


def test_floating_ball_appears(page: Page):
    """测试：悬浮球是否出现"""
    page.wait_for_timeout(2000)
    ball = page.query_selector("#stylesnap-floating-ball")
    assert ball is not None, "❌ 悬浮球未出现"


def test_sidepanel_loads(context, extension_id):
    """测试：Side Panel 能否正常加载"""
    page = context.new_page()
    page.goto(f"chrome-extension://{extension_id}/src/sidepanel/index.html")
    page.wait_for_load_state("networkidle")
    assert page.query_selector("button") is not None


def test_inspector_toggle(context, extension_id, page: Page):
    """测试：Inspector 能否启动"""
    # 通过 background SW 发送消息
    sw = context.service_workers[0]
    sw.evaluate("""() => {
        chrome.tabs.query({active:true}, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, {type: 'INIT_INSPECTOR'})
        })
    }""")
    page.wait_for_timeout(1000)
    overlay = page.query_selector("#stylesnap-overlay")
    assert overlay is not None, "❌ Inspector 未启动"
```

---

## 下一步

1. **安装 Playwright**（`npm install -D @playwright/test` 或 Python 版）
2. **写测试脚本**（`test_stylesnap.py`）
3. **每次改完代码先跑测试**，通过再告诉你

---

## 参考链接

- Playwright 官方文档（中文）：https://playwright.net.cn/python/docs/chrome-extensions
- Playwright GitHub：https://github.com/microsoft/playwright
- @crxjs/vite-plugin：https://github.com/crxjs/chrome-extension-tools
