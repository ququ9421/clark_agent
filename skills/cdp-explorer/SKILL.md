---
name: cdp-explorer
description: 通过 Chrome DevTools Protocol 探查真实浏览器页面，发现所有交互元素和状态，输出 cdp-baseline-{slug}.json。输出的 locatorHint 供 test-case-generator 和 playwright-script-generator 使用。
version: 1.0.0
allowed_tools: [mcp__chrome-devtools__list_pages, mcp__chrome-devtools__select_page, mcp__chrome-devtools__take_snapshot, mcp__chrome-devtools__take_screenshot, mcp__chrome-devtools__evaluate_script, mcp__chrome-devtools__click, mcp__chrome-devtools__fill, mcp__chrome-devtools__hover, mcp__chrome-devtools__navigate_page, mcp__chrome-devtools__wait_for, mcp__chrome-devtools__press_key, Read, Write]
---

# CDP Explorer Skill

> **核心思想**：Web 页面是有限状态机。探查 = 建立状态流转图（State-Flow Graph）。
> CDP 发现的是**页面实际存在的内容**，而非需求文档描述的内容，输出的 locatorHint 是真实可用的。

## 前置要求

- Chrome DevTools MCP 服务器已在 `.claude/settings.json` 中配置
- Chrome 浏览器已打开（可以是任意标签页，探查时会导航到目标 URL）

---

## Phase 1：连接页面

### Step 1.1 — 列出并选择页面

```
mcp__chrome-devtools__list_pages()
```

匹配策略（按优先级）：
1. `pageUrl` 由调用方传入 → URL 包含匹配
2. 已打开页面中匹配 `baseURL`
3. 无匹配 → `navigate_page(pageUrl)` 导航过去

```
mcp__chrome-devtools__select_page(pageId)
```

### Step 1.2 — 确认页面就绪

```
mcp__chrome-devtools__evaluate_script
  function: () => document.readyState
```

若非 `complete`，等待：
```
mcp__chrome-devtools__wait_for  selector="body"  timeout=5000
```

### Step 1.3 — 登录墙检测与处理

检测是否是登录页：

```javascript
// 通过 evaluate_script 执行
const indicators = [
  document.querySelector('input[type="password"]'),
  document.querySelector('[name="email"], [name="username"], input[type="email"]'),
  document.querySelector('form[action*="login"], form[action*="signin"]'),
]
const urlHint = /sign-?in|log-?in|auth/i.test(location.pathname)
const isLoginPage = indicators.filter(Boolean).length >= 2
  || (urlHint && indicators.filter(Boolean).length >= 1)
return { isLoginPage, url: location.href }
```

**若检测到登录页**：
1. 从 `.env` 读取 `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`
2. 填写并提交：
   ```
   mcp__chrome-devtools__fill
     selector: "input[type='email'], input[name='email'], input[name='username']"
     value: E2E_TEST_EMAIL

   mcp__chrome-devtools__fill
     selector: "input[type='password']"
     value: E2E_TEST_PASSWORD

   mcp__chrome-devtools__click
     selector: "button[type='submit'], button:has-text('Sign in'), button:has-text('登录'), button:has-text('Login')"
   ```
3. 等待导航完成，验证已离开登录页
4. 仍在登录页 → 报错：**"自动登录失败，请手动登录后重试"**
5. 登录成功 → 导航到原目标 URL → 继续 Phase 2

**若不需要登录** → 直接进入 Phase 2

---

## Phase 2：初始状态扫描（State₀）

> **三层扫描，按顺序执行，不可跳过。**

### Layer 1 — DOM 扫描

通过 `evaluate_script` 提取所有交互元素：

```javascript
Array.from(document.querySelectorAll(
  'button, a[href], input, select, textarea, ' +
  '[role="button"], [role="tab"], [role="menuitem"], ' +
  '[role="checkbox"], [role="radio"], [role="combobox"], ' +
  '[aria-haspopup], [aria-expanded]'
))
.filter(el => {
  const style = getComputedStyle(el)
  return style.display !== 'none' && style.visibility !== 'hidden' && !el.hidden
})
.map((el, idx) => ({
  uid: `${el.tagName.toLowerCase()}-${idx}`,
  tag: el.tagName.toLowerCase(),
  text: el.textContent?.trim().slice(0, 80) || '',
  role: el.getAttribute('role') || el.tagName.toLowerCase(),
  testId: el.getAttribute('data-testid') || null,
  ariaLabel: el.getAttribute('aria-label') || null,
  placeholder: el.getAttribute('placeholder') || null,
  type: el.getAttribute('type') || null,
  href: el.getAttribute('href') || null,
  disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
  expanded: el.getAttribute('aria-expanded'),
  haspopup: el.getAttribute('aria-haspopup'),
}))
```

### Layer 2 — Accessibility Tree

```
mcp__chrome-devtools__take_snapshot()
```

补充：语义角色、层级关系、选中/展开状态。

### Layer 3 — 截图

```
mcp__chrome-devtools__take_screenshot()
```

保存到 `tests/e2e/screenshots/{slug}-S0.png`（目录不存在则创建）。

### locatorHint 生成规则

对每个 DOM 元素，按以下优先级生成 `locatorHint`：

| 优先级 | 条件 | 生成的 locatorHint |
|--------|------|------------------|
| 1（最高） | 有 `data-testid` | `getByTestId('{testId}')` |
| 2 | 有 `ariaLabel` | `getByRole('{role}', { name: '{ariaLabel}' })` |
| 3 | 有 `role` + `text` 非空 | `getByRole('{role}', { name: /{text}/i })` |
| 4 | 有 `placeholder` | `getByPlaceholder('{placeholder}')` |
| 5 | 有唯一可见文本 | `getByText('{text}')` |
| 6（兜底） | 无以上任何条件 | `locator('{tag}:has-text("{text}")')` |

**永远不要使用 Tailwind utility class 作为 locator**（`rounded-*`、`p-*`、`flex`、`bg-*` 等随版本变化，极不稳定）。

---

## Phase 3：交互式探查（BFS）

### 探查优先级队列

从 Phase 2 的元素中，按优先级排序：

| 优先级 | 元素特征 | 原因 |
|--------|---------|------|
| P0（最高） | `aria-haspopup`、`aria-expanded="false"`、未选中的 `role="tab"` | 最可能揭示隐藏状态 |
| P1（高） | `role="menuitem"`、同域导航链接、accordion 触发器 | 可能触发新页面/区域 |
| P2（中） | `button`、同域 `a[href]`、`input`、`select` | 常见交互元素 |
| P3（低） | tooltip 触发器、纯视觉 hover 效果 | 小状态变化 |

### 交互策略（4 类）

| 类型 | 触发条件 | 执行方式 |
|------|---------|---------|
| 直接探查 | Tab 切换、下拉展开、详情面板 | click → 记录新状态 S_n |
| 探查后回退 | 表单字段（未提交）、checkbox、搜索框 | 填充/点击 → 记录 → Escape 或 navigate back |
| 探查后回退 | 同域导航链接 | 导航 → 记录目标页 State₀ → browser back |
| **跳过** | 破坏性操作（Delete、Remove、Clear All、Logout） | 仅记录元素，**不执行** |

### 状态等价检测（避免循环）

每次交互后：
```
mcp__chrome-devtools__take_snapshot()
→ 提取当前所有交互元素集合（role + text 去重）
→ 与已知状态比较：
  集合 80% 以上重合 → 标记为等价状态，停止该分支
  否则 → 记录为新状态 S_n，加入探查队列
```

### 深度限制

- 默认最多探查 **3 层**状态深度（S0 → S1 → S2 → S3 停止）
- 每层最多探查 **20 个**元素（避免超大页面超时）
- 可通过调用方参数 `maxDepth` / `maxElements` 覆盖

---

## Phase 4：输出 Baseline JSON

**路径**：`tests/e2e/test-cases/generated/cdp-baseline-{slug}.json`

**Slug 命名规则**（从 URL path 提取）：
- `/invoice/billing` → `invoice-billing`
- `/tasks/list` → `tasks-list`
- `/` → `home`
- 已有 `--slug` 参数 → 直接使用

**文件结构**：

```json
{
  "meta": {
    "url": "https://app.example.com/invoice/billing",
    "slug": "invoice-billing",
    "exploredAt": "2026-06-11T10:30:00Z",
    "mode": "full",
    "stats": {
      "statesDiscovered": 3,
      "interactionsPerformed": 12,
      "elementsFound": 45
    }
  },
  "states": {
    "S0": {
      "name": "Initial page",
      "trigger": null,
      "screenshot": "tests/e2e/screenshots/invoice-billing-S0.png",
      "elements": [
        {
          "uid": "button-0",
          "tag": "button",
          "text": "批量上传影像文件",
          "role": "button",
          "testId": "batch-upload-btn",
          "ariaLabel": null,
          "locatorHint": "getByTestId('batch-upload-btn')",
          "disabled": false,
          "expanded": null,
          "haspopup": null
        },
        {
          "uid": "input-1",
          "tag": "input",
          "text": "",
          "role": "textbox",
          "testId": null,
          "ariaLabel": "申请单号",
          "placeholder": "请输入申请单号",
          "locatorHint": "getByPlaceholder('请输入申请单号')",
          "disabled": false
        }
      ]
    },
    "S1": {
      "name": "Upload Dialog",
      "trigger": { "action": "click", "elementUid": "button-0", "fromState": "S0" },
      "screenshot": "tests/e2e/screenshots/invoice-billing-S1.png",
      "elements": [
        {
          "uid": "input-file-0",
          "tag": "input",
          "text": "",
          "role": "input",
          "testId": null,
          "ariaLabel": null,
          "type": "file",
          "locatorHint": "locator('input[type=file]')",
          "disabled": false
        },
        {
          "uid": "button-upload-confirm",
          "tag": "button",
          "text": "上传",
          "role": "button",
          "testId": null,
          "ariaLabel": null,
          "locatorHint": "getByRole('button', { name: /^上传$/ })",
          "disabled": false
        }
      ]
    }
  },
  "stateGraph": {
    "edges": [
      { "from": "S0", "action": "click", "element": "button-0", "to": "S1" },
      { "from": "S1", "action": "press:Escape", "element": null, "to": "S0" }
    ]
  },
  "forms": [
    {
      "state": "S1",
      "name": "Upload Form",
      "fields": [
        { "uid": "input-file-0", "type": "file", "locatorHint": "locator('input[type=file]')" }
      ]
    }
  ],
  "summary": {
    "totalStates": 3,
    "totalElements": 45,
    "hasLoginWall": false,
    "loginHandled": false,
    "skippedDestructive": ["button:删除", "button:Clear All"]
  }
}
```

**写入后验证**：
- [ ] 合法 JSON，`states.S0` 存在
- [ ] 每个 element 有非空 `locatorHint`
- [ ] `stateGraph.edges` 中引用的所有 state/element uid 均存在
- [ ] `summary.totalElements` 与实际 elements 数量一致
- [ ] 截图文件路径已记录（文件可能在 tests/e2e/screenshots/ 下）

---

## 输出文件

| 文件 | 说明 |
|------|------|
| `tests/e2e/test-cases/generated/cdp-baseline-{slug}.json` | 完整状态流转图，含真实 locatorHint |
| `tests/e2e/screenshots/{slug}-S{n}.png` | 各状态的截图（视觉确认用） |

## 下游消费

本 Skill 的输出格式是与以下 Skill 之间的契约：

| 下游 | 使用方式 |
|------|---------|
| `test-case-generator` | 以 CDP baseline 模式输入，从 states 推断用户故事，elements[].locatorHint → Handoff JSON uiElements[].locatorHint |
| `playwright-script-generator` | 通过 Handoff JSON 间接使用，locatorHint 保持原样写入 POM |
