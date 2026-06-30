---
name: playwright-script-generator
description: 从 playwright-handoff-{slug}.json 生成 Page Object Model (.page.ts) 和 Playwright 测试脚本 (.test.ts)。严格 1:1 映射，每条 handoff entry 对应一个 test() 块，强制强断言校验。
version: 1.1.0
allowed_tools: [Read, Write, Grep, Glob]
---

# Playwright Script Generator Skill

> **核心原则**：Handoff JSON 是唯一真实来源。每条 entry → 一个 `test()` 块，不合并，不拆分。

## 输出语言

测试文件注释使用**简体中文**，代码标识符（变量名、方法名、类名）保留英文。

---

## Phase 0a：断言质量校验（生成 spec 后强制执行）

> 生成每个 spec 文件后，扫描所有 `expect()` 调用，校验断言质量。
> 只检查"存在性"而不验证业务语义的弱断言必须加强。

| 模式 | 判定 | 处理方式 |
|------|------|---------|
| `expect(locator).toBeVisible()` 单独出现（非加载状态） | **弱断言** | 追加内容断言：`.toHaveText()`、`.toContainText()` 或语义校验 |
| `expect(locator).toBeVisible()` 用于 loading spinner/skeleton | **OK** — 存在即业务含义 | 无需修改 |
| `expect(locator).toHaveText('...')` 含具体期望值 | **强断言** ✅ | 无需修改 |
| `expect(locator).toContainText('...')` | **强断言** ✅ | 无需修改 |
| `expect(locator).toHaveAttribute('...', '...')` | **强断言** ✅ | 无需修改 |
| `expect(page).toHaveURL('...')` | **强断言** ✅ | 无需修改 |
| `expect(locator).toHaveCount(N)`（N > 0） | **强断言** ✅ | 无需修改 |
| `expect(locator).toBeTruthy()` | **弱断言** | 一律替换为具体断言 |
| `expect(locator).not.toBeVisible()` 用于错误/空状态 | **OK** — 不存在即业务含义 | 无需修改 |
| `expect(locator).toBeHidden()` 用于缺失状态验证 | **语义正确** ✅ | 无需修改 |

**校验流程**：Grep spec 中所有 `expect()` 调用。`toBeVisible()` 单独出现（非 spinner）→ 若 `assertions[].expected` 有值则改为 `toContainText()` / `toHaveText()`，无值则保留但加注释 `// TODO: 补充内容断言`。`toBeTruthy()` → 一律替换。输出：`"已加强 {specFile} 中 N 处弱断言"`。

---

## Phase 0b：去重检查（生成前防御性预检）

在生成任何文件前，扫描已有脚本，避免重复生成：

```
Glob("$QA_WORKSPACE_DIR/tests/e2e/specs/**/*.test.ts") → existingSpecs[]
Glob("$QA_WORKSPACE_DIR/tests/e2e/pages/*.ts")         → existingPages[]

对每条 handoff entry:
  Grep("{entry.id}", existingSpecs)           // 按 TC ID 精确匹配
  Grep("{entry.title 关键词}", existingSpecs)  // 按标题关键词兜底匹配
  若已找到 → 跳过该 entry，记入 skipped[]

对目标页面的 POM：
  若 existingPages 已有同名 POM → 复用，追加新方法，不重建

若所有 entry 均跳过 → 输出"所有用例已有脚本覆盖，跳过生成" → 停止
```

---

## Phase 0c：测试数据自足性（每个 test() 强制执行）

> **核心原则**：每个 `test()` 块必须完全自包含——自行准备数据、执行、验证、清理。
> 任何测试都**不得**依赖其他测试的输出状态。

**规则：**

1. **禁止 hardcoded 数据 ID** — 不允许 `const TASK_ID = 'abc123'` 或 `process.env.E2E_TASK_ID ?? 'fallback'`
2. **前置数据使用 worker-scope fixture** — 所有前置数据在 `fixtures.ts` 中以 worker-scope fixture 创建（`{ scope: 'worker', timeout: 360_000 }`），测试通过 fixture 参数解构获取。**禁止使用 `beforeAll`**（存在隐藏的 60s 超时限制，且阻止并行执行）
3. **等待异步数据就绪** — 使用 `waitForResponse` 或轮询确认数据可用后再断言
4. **唯一命名** — 始终使用 `Date.now()` 或 `crypto.randomUUID()` 后缀：
   ```typescript
   const fileName = `Test-Upload-${Date.now()}`
   ```
5. **POM 包含数据操作方法** — `createTask()`、`deleteTask()` 等写入 POM 而非 spec
6. **`{timestamp}` 占位符** → 替换为 `Date.now()`
7. **文件上传路径** 使用相对路径并加注释：
   ```typescript
   // 请在 tests/e2e/fixtures/files/ 下准备对应测试文件
   await p.setInputFilesFileSelector('tests/e2e/fixtures/files/sample.pdf')
   ```

**前置数据需求校验（生成每个测试前强制执行）** — 根据操作关键词判断是否需要 `setup[]`：

| 操作关键词 | 类型 | 需要 setup[]？ |
|-----------|------|:------------:|
| 创建、新增、上传、提交 | Create | 否 |
| 查看、详情、预览、搜索、打开 | Read | **是** |
| 编辑、修改、更新、重命名 | Update | **是** |
| 删除、移除、取消、撤销 | Delete | **是** |
| 下载、导出 | Download | **是** |
| 列表、筛选、排序、分页 | List/Filter | **是** |
| 导航、跳转 | Navigate | 否 |

若类型要求 setup 但 `setup[]` 为空 → 从 `preconditions[]` 推断前置条件；两者均为空 → 标记错误，**不生成该 test**，输出：`"ERROR: {entry.id} 需要前置数据但 setup[] 为空"`。

---

## Phase 0d：测试数据类型解析（handoff 含 `dataType` 时执行）

当 handoff 的 `uiElements[]` 条目包含 `dataType` 字段时，解析为具体的内联字面量写入 spec——**不引入工厂函数**。需要唯一性时追加 `Date.now()`。

**常见类型映射：**

| dataType | 生成值示例 |
|----------|-----------|
| `email` | `` `test-${Date.now()}@example.com` `` |
| `username` | `` `testuser-${Date.now()}` `` |
| `phone` | `` `138${Date.now().toString().slice(-8)}` `` |
| `file.pdf` | `'tests/e2e/fixtures/files/sample.pdf'` |
| `file.image` | `'tests/e2e/fixtures/files/sample.png'` |
| `datetime.now` | `new Date().toISOString()` |
| `text.unique` | `` `Test-${Date.now()}` `` |

若 `dataType` 未知 → 用 `Date.now()` 生成占位值，并加注释：`// TODO: 替换为正确的 {dataType} 数据`。

---

## Phase A：读取 Handoff JSON

**Handoff 不存在 → STOP**，输出：
```
ERROR: playwright-handoff-{slug}.json not found.
请先运行 /qa-gen-cases 生成测试用例和 Handoff JSON。
```

验证规则（每条 entry 必须满足）：
- `id` 非空字符串（格式 `TC-{SOURCE}-{FEATURE}-{NNN}`）
- `title` 非空字符串
- `assertions` 数组，长度 ≥ 1
- `storyId` 非空（用于 describe 分组）

---

## Phase B：生成 Page Object (`tests/e2e/pages/{slug}.page.ts`)

### B.1 同页面复用

```
If 文件 tests/e2e/pages/{slug}.page.ts 已存在:
  Read(pomFile)
  提取已有方法列表
  追加模式：只添加新方法，不重建类
Else:
  全新创建
```

### B.2 POM 结构

```typescript
import { type Page, type Locator } from '@playwright/test'

export class {Slug}Page {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  // ── 导航 ──────────────────────────────────────
  // 从 setup[].data.url 提取，若多个 URL 则生成多个 goto 方法
  async goto() {
    await this.page.goto('{url}')
  }

  // ── 操作方法（每个 uiElement 一个方法）─────────
  async click{ElementName}() {
    await {locator}.click()
  }

  async fill{ElementName}(value: string) {
    await {locator}.fill(value)
  }

  async setInputFiles{ElementName}(filePath: string) {
    // 注意：需要在本地准备对应的测试文件
    await {locator}.setInputFiles(filePath)
  }

  // ── Getter（每个 assertion target 一个 getter）─
  get{TargetName}(): Locator {
    return {locator}
  }
}
```

### B.3 方法命名规则

从 `uiElements[].name`（中文）→ 英文 PascalCase 方法名：

| name | action | 方法名 |
|------|--------|--------|
| `批量上传影像文件` | click | `clickBatchUploadBtn` |
| `文件选择` | setInputFiles | `setInputFilesFileSelector` |
| `上传` | click | `clickUploadBtn` |
| `申请单号批量输入` | fill | `fillApplicationNoInput` |

**命名规则**：
- 取中文语义的英文缩写/直译（不要逐字翻译）
- 加 action 前缀：`click`、`fill`、`setInputFiles`、`select`、`check`
- 结尾加元素类型后缀：`Btn`、`Input`、`Link`、`Tab` 等

### B.4 定位器策略（优先级从高到低）

1. **`locatorHint` 非空** → 直接使用，包裹成 `this.page.{locatorHint}`
   ```typescript
   // locatorHint: "getByRole('button', { name: /批量上传影像文件/i })"
   return this.page.getByRole('button', { name: /批量上传影像文件/i })
   ```

2. **`locatorHint` 为空** → 根据 `role` + `name` 生成：

   | role | 生成的定位器 |
   |------|------------|
   | `button` | `this.page.getByRole('button', { name: /{name}/i })` |
   | `textbox` | `this.page.getByRole('textbox', { name: /{name}/i })` |
   | `input` | `this.page.locator('input[type="file"]')` |
   | `link` | `this.page.getByRole('link', { name: /{name}/i })` |
   | `heading` | `this.page.getByRole('heading', { name: /{name}/i })` |
   | 其他 | `this.page.locator('[aria-label="{name}"]')` |

3. **assertion target 的 getter**：若 `assertions[].locatorHint` 存在则使用，否则用 `target` 名称生成语义定位器

---

## Phase C：生成 Playwright Spec (`tests/e2e/specs/{slug}-prd.test.ts`)

### C.1 文件头（强制）

```typescript
// source: prd
// handoff: tests/e2e/test-cases/generated/playwright-handoff-{slug}.json
// generated: {date}

import { test, expect } from '@playwright/test'
import { {Slug}Page } from '../pages/{slug}.page'
```

### C.2 分组规则

按 `storyId` 分组 → 一个 `test.describe` 块：

```typescript
test.describe('{storyId}', () => {
  // 该 storyId 下的所有 test()
})
```

### C.3 标签系统（双维度）

| priority | 优先级标签 | 覆盖类型标签 |
|----------|-----------|------------|
| P0 | `@P0` | `@smoke` |
| P1 | `@P1` | `@regression` |
| P2 | `@P2` | `@full` |

每个 test() 同时带两个标签：
```typescript
test('[TC-PRD-INVOICE-001] 批量上传合法格式影像文件成功',
  { tag: ['@P0', '@smoke'] },
  async ({ page }) => { ... }
)
```

### C.4 test() 块结构

```typescript
test('[{id}] {title}',
  { tag: ['{priorityTag}', '{coverageTag}'] },
  async ({ page }) => {
    const p = new {Slug}Page(page)

    // ── 导航（来自 setup[]）─────────────────
    await p.goto()

    // ── UI 操作（来自 uiElements[]）────────
    await p.click{Btn}()
    await p.fill{Input}('具体值')
    await p.setInputFiles{Input}('test-files/sample.pdf') // 注意：需准备本地文件

    // ── 断言（来自 assertions[]）────────────
    await expect(p.get{Target}()).toBeVisible()
    await expect(p.get{Target}()).toContainText('{expected}')
  }
)
```

### C.5 断言映射规则

| `assertions[].type` | Playwright expect | 备注 |
|--------------------|-------------------|------|
| `visible` | `expect(locator).toBeVisible()` | 若有 `expected` 值则必须追加 `toContainText()` |
| `hidden` | `expect(locator).toBeHidden()` | |
| `text` | `expect(locator).toHaveText('{expected}')` | 精确匹配 |
| `url` | `await expect(page).toHaveURL(/{expected}/)` | 正则匹配 |
| `count` | `await expect(locator).toHaveCount({expected})` | |
| `attribute` | `await expect(locator).toHaveAttribute('{attribute}', '{expected}')` | |

### C.6 断言质量规则

> 完整规则见 **Phase 0a**。生成时直接按 0a 规则写入强断言；生成完成后统一执行 0a 校验扫描。
> 核心：有 `assertions[].expected` 值时必须使用 `toHaveText()` 或 `toContainText()`，不能只写 `toBeVisible()`。

### C.7 测试数据自足规则

> 完整规则见 **Phase 0c**。核心要求：
> - 每个 `test()` 以独立的 `goto()` 开始，不依赖其他 test 的页面状态
> - 需要前置数据时用 worker-scope fixture，**禁止 `beforeAll`**
> - `{timestamp}` → `Date.now()`；文件路径用相对路径并加注释

---

## Phase D：生成 playwright.config.ts（若不存在）

```typescript
import { defineConfig } from '@playwright/test'
import dotenv from 'dotenv'
dotenv.config()

export default defineConfig({
  testDir: './tests/e2e/specs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [
    ['json', { outputFile: 'tests/reports/playwright-results.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? process.env.APP_URL ?? 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: process.env.E2E_TEST_EMAIL
    ? [
        { name: 'setup', testMatch: /auth\.setup\.ts/ },
        {
          name: 'e2e',
          dependencies: ['setup'],
          use: { storageState: 'playwright/.auth/user.json' },
        },
      ]
    : [{ name: 'e2e' }],
})
```

> **若 playwright.config.ts 已存在** → 不覆盖，在摘要中提示"使用已有配置"。

---

## Phase E：自检清单

生成完成后逐项确认：

**前置校验（0a-0d）**
- [ ] Phase 0a 已执行：spec 中无未修复的弱断言（无孤立的 `toBeVisible()`、无 `toBeTruthy()`）
- [ ] Phase 0b 已执行：重复 TC ID 已跳过，已有 POM 已复用而非重建
- [ ] Phase 0c 已执行：需要前置数据的测试已有 worker-scope fixture，无 `beforeAll`，无 hardcoded ID
- [ ] Phase 0d 已执行：handoff 含 `dataType` 的字段已解析为具体字面量

**文件结构**
- [ ] POM 文件路径：`tests/e2e/pages/{slug}.page.ts`
- [ ] Spec 文件路径：`tests/e2e/specs/{slug}-prd.test.ts`
- [ ] 文件头含 `// source: prd`、`// handoff:` 两行注释

**内容完整性**
- [ ] `test.describe` 数量 = handoff 中 `storyId` 去重数量
- [ ] `test()` 数量 = handoff 数组长度（减去 skipped 数量）
- [ ] 所有 `expect()` 均为强断言
- [ ] 无 hardcoded 数据 ID
- [ ] 文件上传用例含本地文件准备注释
- [ ] playwright.config.ts 存在（新建或已有均可）

---

## 常见反模式（必须避免）

```typescript
// BAD：弱断言，只检查存在，不验证内容
await expect(p.getSuccessToast()).toBeVisible()

// GOOD：有期望值时必须验证内容
await expect(p.getSuccessToast()).toBeVisible()
await expect(p.getSuccessToast()).toContainText('上传成功')

// BAD：直接在 test() 中使用 page.locator（绕过 POM）
await page.getByRole('button', { name: '上传' }).click()

// GOOD：通过 POM 方法操作
await p.clickUploadBtn()

// BAD：hardcoded 文件 ID
const fileId = 'TC-001-sample.pdf'

// GOOD：使用时间戳确保唯一性
const fileName = `test-upload-${Date.now()}.pdf`
```
