---
name: test-data-setup
description: 为 E2E 测试生成前置数据管理基础设施（data.setup.ts + fixtures.ts）。配置驱动，支持并行创建、三级回退（env var → 缓存 → UI 创建）、AI 交互式阻断处理，并可从已有 spec 中反向抽象 inline 数据为共享 fixture。
version: 1.0.0
allowed_tools: [Read, Write, Bash, Grep, Glob]
---

# Test Data Setup Skill

> **核心能力**：为 E2E 测试项目生成前置数据管理基础设施（`data.setup.ts` + `fixtures.ts` 中的数据 fixture）。
> 项目专属知识（prompt、选择器、路由）由 `test-data.config.json` 声明，本 Skill 读取配置生成代码。

---

## 适用场景

当目标项目需要"昂贵的前置数据"（如需要通过 UI 创建的任务、文件、分享链接等），且这些数据需要：
- 跨多个测试场景复用（查询、下载、查看、修改、删除）
- 并行创建以节省时间
- 缓存以避免每次运行都重新创建

---

## 架构：配置驱动的三级回退

```
test-data.config.json  ←  项目声明式配置（唯一的项目专属输入）
        ↓ Skill 读取
data.setup.ts          ←  并行创建 + 写入 .test-data.json 缓存
fixtures.ts            ←  worker-scope fixture + 三级回退
        ↓ 运行时
Env var → .test-data.json → UI 创建（fallback）
```

---

## 输入：test-data.config.json

在项目根目录（或 `$QA_WORKSPACE_DIR`）下创建 `test-data.config.json`，声明所有需要的前置数据：

```jsonc
{
  // ── 路由配置 ──
  "routes": {
    "taskCreation": "/create",   // 数据创建页面路径
    "signIn": "/sign-in"         // 登录页面路径
  },

  // ── 通用选择器（支持 | 多语言备选） ──
  "selectors": {
    "textarea": "请输入内容|Enter content",        // 输入框 accessible name
    "submitBtn": "提交|Submit",                    // 提交按钮 accessible name
    "completionIndicator": "已完成|Completed"      // 数据就绪的文本标志
  },

  // ── Fixture 声明 ──
  "fixtures": {
    "basic-record": {
      "name": "basicRecordUrl",
      "env": "E2E_BASIC_RECORD_URL",
      "prompt": "创建一条基础测试记录",
      "waitPattern": "已完成|Completed",
      "fallbackFill": "请使用默认设置直接创建",
      "timeout": 60000,
      "description": "基础测试记录，供查看/编辑/删除类用例使用"
    },
    "file-record": {
      "name": "fileRecordUrl",
      "env": "E2E_FILE_RECORD_URL",
      "prompt": "创建包含附件的测试记录",
      "waitPattern": "已完成|Completed",
      "fallbackFill": "请直接创建，使用默认附件",
      "timeout": 120000,
      "description": "含附件的记录，供文件预览/下载类用例使用"
    },
    "share": {
      "name": "shareUrl",
      "env": "E2E_SHARE_URL",
      "type": "share",
      "prompt": "创建可分享的测试记录",
      "waitPattern": "已完成|Completed",
      "fallbackFill": "请直接创建",
      "timeout": 120000,
      "description": "分享页 URL（含 access token），供分享场景用例使用",
      "shareDialog": {
        "shareButtonSelector": "[aria-label='分享'], button:has-text('分享')",
        "createLinkBtn": "创建分享链接|Create share link",
        "copyLinkBtn": "复制链接|Copy link",
        "urlPattern": "/share/"
      }
    }
  },

  // ── 澄清表单处理（可选，应用有 AI 交互式阻断时配置） ──
  "clarificationHandler": {
    "submitSelector": "[role='log'] button",
    "submitText": "提交|Submit",
    "inputSelector": "[role='log'] textarea",
    "bypassMessage": "请直接开始，使用默认设置"
  },

  // ── 缓存配置 ──
  "cache": {
    "ttlMs": 86400000,
    "path": "playwright/.test-data.json"
  }
}
```

### 配置字段说明

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `routes.taskCreation` | YES | 数据创建页的 URL 路径 |
| `routes.signIn` | YES | 登录页的 URL 路径 |
| `selectors.textarea` | YES | 输入框的 accessible name（`\|` 分隔多语言备选） |
| `selectors.submitBtn` | YES | 提交按钮的 accessible name |
| `selectors.completionIndicator` | YES | 数据就绪的文本标志 |
| `fixtures.*` | YES | 至少声明 1 个 fixture |
| `fixtures.*.name` | YES | fixture 变量名（camelCase），对应 fixtures.ts 中的 key |
| `fixtures.*.env` | YES | 环境变量名（SCREAMING_SNAKE_CASE） |
| `fixtures.*.prompt` | YES | 创建数据时输入的内容 |
| `fixtures.*.waitPattern` | YES | 等待就绪的正则文本 |
| `fixtures.*.waitLocator` | NO | 自定义等待元素的 CSS selector（默认用 `getByText(waitPattern)`） |
| `fixtures.*.fallbackFill` | NO | 澄清表单的默认填充文本 |
| `fixtures.*.timeout` | YES | fixture 超时时间（ms），创建耗时较长时适当调大 |
| `fixtures.*.type` | NO | `"share"` 表示需要额外的分享对话框交互 |
| `fixtures.*.shareDialog` | NO | 分享对话框选择器（仅 `type=share` 时必填） |
| `clarificationHandler` | NO | AI 交互式阻断处理（无则跳过） |
| `cache.ttlMs` | NO | 缓存有效期，默认 24h（86400000） |
| `cache.path` | NO | 缓存文件路径，默认 `playwright/.test-data.json` |

---

## 生成规则

### 1. data.setup.ts 生成

读取 `test-data.config.json`，生成 `tests/e2e/data.setup.ts`：

**生成逻辑**：
1. 遍历 `fixtures` 中每个条目
2. `type !== "share"` → 生成 `createRecordInContext(browser, key, prompt, waitPattern, fallbackFill)` 调用
3. `type === "share"` → 生成 `createShareInContext(browser)` 调用，使用 `shareDialog` 配置
4. 所有创建任务放入 `Promise.allSettled` 并行执行
5. `needsCreation()` 实现三级回退：env var → `.test-data.json` → 需要 UI 创建

**生成模板**：

```typescript
// AUTO-GENERATED from test-data.config.json — do not edit manually
// Regenerate: invoke test-data-setup skill

import { test as setup } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const AUTH_FILE = 'playwright/.auth/user.json'
const SIGN_IN_PATH = '{config.routes.signIn}'
const TEST_DATA_PATH = path.join(__dirname, '..', '..', '{config.cache.path}')
const DATA_MAX_AGE_MS = {config.cache.ttlMs}

function readTestData(): Record<string, string> {
  try {
    if (!fs.existsSync(TEST_DATA_PATH)) return {}
    const raw = JSON.parse(fs.readFileSync(TEST_DATA_PATH, 'utf-8'))
    if (raw._createdAt && Date.now() - raw._createdAt > DATA_MAX_AGE_MS) {
      console.log('[data-setup] 缓存已过期，将重新创建')
      return {}
    }
    return raw
  } catch { return {} }
}

function writeTestData(data: Record<string, string>) {
  fs.mkdirSync(path.dirname(TEST_DATA_PATH), { recursive: true })
  fs.writeFileSync(TEST_DATA_PATH, JSON.stringify({ ...data, _createdAt: Date.now() }, null, 2))
}

function needsCreation(key: string, envVar: string, cached: Record<string, string>): boolean {
  return !process.env[envVar] && !cached[key]
}

setup('create test data', async ({ browser }) => {
  const cached = readTestData()
  const results: Record<string, string> = { ...cached }
  const tasks: Array<{ key: string; promise: Promise<string> }> = []

  // For each fixture in config.fixtures（由 Skill 展开生成）：
  // if (needsCreation('basic-record', 'E2E_BASIC_RECORD_URL', cached)) {
  //   tasks.push({ key: 'basicRecordUrl', promise: createRecordInContext(browser, ...) })
  // }

  const settled = await Promise.allSettled(tasks.map(t => t.promise))
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') results[tasks[i].key] = result.value
    else console.error(`[data-setup] ${tasks[i].key} 创建失败:`, result.reason)
  })

  writeTestData(results)
})
```

### 2. fixtures.ts 数据 fixture 生成

在 `tests/e2e/fixtures.ts` 中为每个 config fixture 生成 worker-scope fixture：

**规则**：
- 每个 fixture 遵循**三级回退**：`process.env[envVar]` → `readTestData()[name]` → UI 创建
- `scope: 'worker'`，使用 `{ browser }` 而非 `{ page }`
- `timeout` 取自配置（**必须指定，不可省略**）
- UI 创建逻辑作为 fallback，使用 config 中的 prompt/selectors
- `try/finally` 确保 browserContext 关闭

```typescript
// fixtures.ts（生成的数据 fixture 部分）

type TestDataFixtures = {
  basicRecordUrl: string   // 对应 config.fixtures.basic-record.name
  fileRecordUrl: string    // 对应 config.fixtures.file-record.name
  shareUrl: string         // 对应 config.fixtures.share.name
}

export const test = base.extend<{}, TestDataFixtures>({
  basicRecordUrl: [async ({ browser }, use) => {
    // 三级回退
    const url = process.env.E2E_BASIC_RECORD_URL
      ?? readTestData().basicRecordUrl
      ?? await createRecordViaUI(browser, config.fixtures['basic-record'])
    await use(url)
  }, { scope: 'worker', timeout: 60_000 }],

  // ... 其余 fixture 按相同模式展开
})
```

### 3. Fixture Registry 同步

生成完成后，检查并更新 `references/fixture-registry.md` 中的 Registry 表格，确保 `fixtureId`、`name`、env var、`description`、`timeout` 与 config 一致。

---

## Fixture Registry 校验

### 校验时机

| 时机 | 执行方 | 行为 |
|------|--------|------|
| **生成时** | 本 Skill | config → 代码，自动对齐；字段格式校验 |
| **用例生成时** | test-case-generator | handoff 中 `setup[].fixtureId` 必须存在于 config.fixtures keys |
| **脚本生成时** | playwright-script-generator | fixtureId → fixture name 映射，未知 ID 阻断生成 |

### 校验规则

```
VALID_FIXTURE_IDS = Object.keys(config.fixtures)

生成时：
  ✅ 每个 fixture 必须有 name、env、prompt、waitPattern、timeout
  ✅ name 必须是合法的 camelCase JavaScript 标识符
  ✅ env 必须是 SCREAMING_SNAKE_CASE 格式
  ✅ timeout 必须 > 0
  ✅ type === "share" 时必须有 shareDialog 配置

用例生成时（handoff setup[]）：
  if (setup[].fixtureId NOT IN VALID_FIXTURE_IDS) {
    ERROR: "Unknown fixtureId: {id}. Valid IDs: {VALID_FIXTURE_IDS.join(', ')}"
  }

脚本生成时：
  fixtureId → name → test('...', async ({ page, {name} }) => { ... })
  fixtureId 不存在 → ERROR，不生成 broken spec
```

详细规则见 `references/fixture-registry.md`。

---

## 新项目接入流程

1. 在 `$QA_WORKSPACE_DIR`（或项目根目录）创建 `test-data.config.json`
2. 至少声明 1 个 fixture
3. 调用本 Skill → 自动生成 `data.setup.ts` + `fixtures.ts` 中的数据 fixture
4. 首次执行测试 → `data-setup` 并行创建所有前置数据 → 写入缓存
5. 后续运行直接读取缓存（或 env var），跳过创建步骤

### CRUD 操作速查

| 操作 | 步骤 | 影响范围 |
|------|------|---------|
| **新增 fixture** | config 添加条目 → 重新生成 | data.setup.ts + fixtures.ts + Registry |
| **修改 prompt/selector** | 修改 config → 重新生成 → 删除 .test-data.json | data.setup.ts + fixtures.ts |
| **删除 fixture** | config 移除 → 重新生成 → Grep 确认无引用 | data.setup.ts + fixtures.ts + Registry |
| **切换测试环境** | 改 APP_URL → 删 .test-data.json | 缓存重建 |

---

## 抽象模式（Pattern B → A）：从已有 spec 反向抽象 fixture

> **适用场景**：项目已有 E2E 测试，spec 中存在 `beforeAll` / `beforeEach` 内联数据创建，
> 需要识别重复模式并抽象为共享 worker-scope fixture。

### 触发条件

以下任一满足即触发：

- **冷启动**：无 `test-data.config.json`，或 config 中 fixtures 为空
- **增量发现**：config 已有 fixture，但 spec 中有**未被已有 fixture 覆盖**的 inline 数据创建
- **手动触发**：用户主动要求"扫描可抽象的数据"

### Step 1 — 扫描已有 spec 中的 inline 数据创建

```
扫描范围: $QA_WORKSPACE_DIR/tests/e2e/specs/**/*.test.ts

识别模式:
  - test.beforeAll / beforeAll 中的 goto + fill + click 创建序列
  - test.beforeEach 中的数据创建
  - describe.serial 包裹的创建→验证链

排除（已覆盖）:
  - 已使用 fixture 解构的 spec（如 async ({ page, basicRecordUrl })）
  - fixture 参数名匹配 config 中已有 fixture.name → 跳过
```

提取每个 inline 创建的特征：

```json
{
  "specFile": "invoice-list.test.ts",
  "route": "/invoice",
  "action": "fill + click",
  "waitPattern": "已完成",
  "resultType": "invoice-record"
}
```

### Step 2 — 聚类分析

按 `route + resultType` 聚类，对比已有 config：

| 聚类结果 | 建议 |
|---------|------|
| ≥2 个 spec 使用同类数据 | 建议抽为 fixture |
| 仅 1 个 spec 使用 | 保持 inline，复用价值低 |
| 与已有 fixture 功能重叠 | 建议复用已有 fixture，不新增 |
| 数据可服务多种场景 | 优先抽象 |

### Step 3 — 输出建议报告

```markdown
## 前置数据抽象建议

### 建议抽为 Fixture（≥2 spec 复用）

| 建议 fixtureId | 当前 inline spec | 可覆盖场景 |
|---|---|---|
| `invoice-record` | invoice-list.test.ts, invoice-detail.test.ts | 查看、编辑、删除、导出 |

### 保持 Inline（仅 1 spec 使用）

| spec | 原因 |
|---|---|
| special-flow.test.ts | 仅此用例需要特殊输入，无复用价值 |
```

### Step 4 — 用户确认后执行

1. **更新 `test-data.config.json`**：冷启动时新建；增量时追加新条目，不动已有条目
2. **重新生成** data.setup.ts + fixtures.ts
3. **重构受影响的 spec**（只改有 inline 创建的，不动已用 fixture 的）：
   - 移除 `beforeAll` 中的数据创建逻辑
   - 移除 `describe.serial` 包裹
   - test 参数添加 fixture 解构：`async ({ page }) =>` → `async ({ page, basicRecordUrl }) =>`
   - 导航改为 fixture URL：`await page.goto(basicRecordUrl)`
4. **验证**：`npx playwright test --list` 确认 spec 正常加载

### 安全规则

- **扫描和聚类自动完成，重构必须经用户确认**
- **不删除 spec**：只修改 beforeAll → fixture 解构，测试逻辑不变
- **渐进式**：可先抽象一部分，观察后继续
- **可回退**：重构后测试失败，`git revert` 即可恢复

---

## Reference Files

- `references/fixture-registry.md` — Fixture Registry 校验规则、fixtureId ↔ fixture name 映射、handoff 集成规范
