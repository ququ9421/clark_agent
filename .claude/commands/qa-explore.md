---
description: "CDP 页面探查：连接浏览器 → 探查真实元素 → 生成测试用例 → 生成 Playwright 脚本（locator 准确率更高）"
allowed-tools: Agent, Bash, Read, Write, Glob, mcp__chrome-devtools__list_pages, mcp__chrome-devtools__select_page, mcp__chrome-devtools__take_snapshot, mcp__chrome-devtools__take_screenshot, mcp__chrome-devtools__evaluate_script, mcp__chrome-devtools__click, mcp__chrome-devtools__fill, mcp__chrome-devtools__hover, mcp__chrome-devtools__navigate_page, mcp__chrome-devtools__wait_for, mcp__chrome-devtools__press_key
---

# /qa-explore — CDP 页面探查 + 测试生成

用 Chrome DevTools Protocol 探查**真实浏览器页面**，发现真实 locator，生成高准确率的 Playwright 测试脚本。

与 `/qa-gen-cases`（需求文档驱动）的区别：
- `/qa-gen-cases`：AI 根据文档**猜测** locator，可能运行时失效
- `/qa-explore`：从真实页面 DOM **发现** locator，准确率大幅提升

## 用法

```
/qa-explore [页面URL] [--slug <模块名>] [--area <功能区域>]
```

## 参数

| 参数 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `页面URL` | 否 | `.env` 的 `APP_URL` / `PLAYWRIGHT_BASE_URL` | 要探查的页面完整 URL |
| `--slug` | 否 | 从 URL path 自动推断 | 输出文件名前缀（英文小写连字符） |
| `--area` | 否 | 全页面 | 只探查特定功能区域（如 `upload`、`filter`、`modal`） |

## 示例

```bash
# 探查 .env 中配置的默认应用首页
/qa-explore

# 探查指定 URL（自动推断 slug 为 invoice-billing）
/qa-explore https://your-app.com/invoice/billing

# 指定 slug 便于文件管理
/qa-explore https://your-app.com/invoice/billing --slug invoice

# 只探查上传相关区域（缩短探查时间）
/qa-explore https://your-app.com/invoice/billing --area upload

# 完整参数
/qa-explore https://your-app.com/login --slug login --area form
```

## 前置条件

1. Chrome DevTools MCP 已配置（`.claude/settings.json` 中的 `chrome-devtools` server）
2. Chrome 浏览器已打开（无需打开目标页面，探查时会自动导航）
3. 若应用需要登录，在 `.env` 中配置 `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`

---

## 流程概览

```
/qa-explore [URL] [--slug] [--area]
     |
Phase 0: 读 .env → 解析 pageUrl / slug / 凭据
     |
Step 1: CDP 探查（cdp-explorer Skill → Phase 1~4）
  → 连接浏览器 → 处理登录 → State₀ 扫描 → BFS 探查
  → cdp-baseline-{slug}.json（含真实 locatorHint）
     |
Step 2: 生成测试用例（test-case-generator Skill，CDP 模式）
  → playwright-handoff-{slug}.json
  → {slug}-cdp.md（测试用例文档）
     |
Step 3: 生成 Playwright 脚本（e2e-orchestrator Agent）
  → tests/e2e/pages/{slug}.page.ts
  → tests/e2e/specs/{slug}-cdp.test.ts
     |
Step 4: 输出摘要
```

---

## Phase 0：加载项目上下文

```
Read(".env")
```

提取：
- `APP_URL` / `PLAYWRIGHT_BASE_URL` — 默认探查 URL
- `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` — 登录凭据（可选）
- `QA_WORKSPACE_DIR` — 输出目录

**pageUrl 解析**：参数 > `PLAYWRIGHT_BASE_URL` > `APP_URL` > 报错

**slug 解析**：
```
--slug 参数           → 直接使用
无参数，有 URL path   → 转换：/invoice/billing → invoice-billing
                              /                 → home
                              /tasks            → tasks
```

**MCP 可用性检查**：
```
尝试调用 mcp__chrome-devtools__list_pages()
失败（工具不存在）→ 停止并提示：
  "Chrome DevTools MCP 工具不可用。
   请确认：
   1. 已安装 MCP server：npm install -g chrome-devtools-mcp@latest
   2. .claude/settings.json 中已配置 chrome-devtools server
   3. 已重启 Claude Code 使配置生效"
```

---

## Step 1：CDP 探查

读取 `skills/cdp-explorer/SKILL.md`，严格按 Phase 1→4 执行：

```
Phase 1: 连接浏览器页面，处理登录墙
Phase 2: State₀ 三层扫描（DOM + Accessibility Tree + 截图）
Phase 3: BFS 交互探查（优先级队列，深度限制 3 层）
Phase 4: 验证并写入 cdp-baseline-{slug}.json
```

收集探查统计：`statesDiscovered` / `interactionsPerformed` / `elementsFound`

若 `--area` 已指定：在 Phase 3 中只探查包含该关键字的功能区域（如 area="upload" → 只深度探查含"上传"文字/功能的区域）。

---

## Step 2：生成测试用例（CDP 模式）

读取 `skills/test-case-generator/SKILL.md`，以 **CDP baseline 模式**执行：

```
输入：tests/e2e/test-cases/generated/cdp-baseline-{slug}.json

从 baseline 的 states 和 stateGraph 中推断用户故事：
  - 每条 stateGraph.edge → 一个可测试的用户操作
  - 每个 state.elements → 可验证的 UI 状态
  - forms[] → 表单填写类测试用例

应用 6 种设计方法（等价类/边界值/判定表/状态转换/场景法/错误猜测）

关键：uiElements[].locatorHint 直接从 baseline 复制，不重新猜测。

输出：
  tests/e2e/test-cases/generated/{slug}-cdp.md
  tests/e2e/test-cases/generated/playwright-handoff-{slug}.json
```

---

## Step 3：生成 Playwright 脚本

启动 e2e-orchestrator（opus）：

```
你是 e2e-orchestrator。先读取 .claude/agents/e2e-orchestrator.md，
再读取 skills/playwright-script-generator/SKILL.md。

Input:
  handoffFile    : tests/e2e/test-cases/generated/playwright-handoff-{slug}.json
  slug           : {slug}
  targetProjectDir: {QA_WORKSPACE_DIR}
  baseURL        : {pageUrl}

注意：本次 Handoff JSON 来自 CDP baseline，locatorHint 已是真实定位器，
      生成 POM 时优先使用 locatorHint，不要替换或推断。

生成：
  tests/e2e/pages/{slug}.page.ts       （命名：{slug}-cdp.test.ts 中引用）
  tests/e2e/specs/{slug}-cdp.test.ts
```

---

## Step 4：输出摘要

```
✅ CDP 探查完成

🔍 探查统计：
  - 发现状态     : {statesDiscovered} 个
  - 执行交互     : {interactionsPerformed} 次
  - 发现元素     : {elementsFound} 个
  - 跳过破坏操作 : {skippedDestructive} 个

📁 产物文件：
  cdp-baseline   : tests/e2e/test-cases/generated/cdp-baseline-{slug}.json
  测试用例文档   : tests/e2e/test-cases/generated/{slug}-cdp.md
  Handoff JSON   : tests/e2e/test-cases/generated/playwright-handoff-{slug}.json
  Page Object    : tests/e2e/pages/{slug}.page.ts
  Spec 文件      : tests/e2e/specs/{slug}-cdp.test.ts
  截图目录       : tests/e2e/screenshots/

下一步：
  - 运行 /qa-run --slug {slug} 执行生成的测试
  - 运行 /qa-run --suite smoke 只跑 P0 冒烟测试
  - 测试失败时查看 playwright-report/index.html
```

---

## 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| Chrome DevTools MCP 工具不可用 | 提示安装步骤（见 Phase 0）|
| 无可用的浏览器页面 | 提示在 Chrome 中打开任意页面后重试 |
| 目标 URL 无法访问（连接拒绝） | 提示检查应用是否已启动，`APP_URL` 是否正确 |
| 遇到登录页但凭据未配置 | 提示在 `.env` 配置 `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` |
| 自动登录失败 | 提示手动登录后重试（浏览器保持登录状态即可） |
| Baseline JSON 验证失败 | 输出具体缺失字段，提示重新运行 |
| CDP baseline 为空（无元素） | 可能被 CORS 或 CSP 拦截，提示检查浏览器控制台 |

---

## 产物输出

```
tests/e2e/
├── screenshots/
│   ├── {slug}-S0.png          ← 初始状态截图
│   ├── {slug}-S1.png          ← 交互后状态截图
│   └── ...
├── test-cases/generated/
│   ├── cdp-baseline-{slug}.json      ← CDP 状态流转图（真实 locator）
│   ├── {slug}-cdp.md                 ← 测试用例文档
│   └── playwright-handoff-{slug}.json ← Handoff JSON
├── pages/
│   └── {slug}.page.ts         ← Page Object
└── specs/
    └── {slug}-cdp.test.ts     ← Playwright spec
```
