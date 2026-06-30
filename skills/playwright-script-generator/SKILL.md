---
name: playwright-script-generator
description: 从 playwright-handoff-{slug}.json 生成 Page Object Model (.page.ts) 和 Playwright 测试脚本 (.test.ts)。严格 1:1 映射，每条 handoff entry 对应一个 test() 块，强制强断言校验。
version: 1.0.0
allowed_tools: [Read, Write, Grep, Glob]
---

# Playwright Script Generator Skill

> **核心原则**：Handoff JSON 是唯一真实来源。每条 entry → 一个 `test()` 块，不合并，不拆分。

## 输出语言

测试文件注释使用**简体中文**，代码标识符（变量名、方法名、类名）保留英文。

---

## Phase 0：去重检查

在生成任何文件前，检查是否已有覆盖：

```
Glob("$QA_WORKSPACE_DIR/tests/e2e/specs/**/*.test.ts") → existingSpecs[]

对每条 handoff entry:
  Grep("{entry.id}", existingSpecs)
  若已找到 → 跳过该 entry，记入 skipped[]

若 functionList 全部跳过 → 输出"所有用例已有脚本覆盖，跳过生成" → 停止
```

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

### C.6 断言质量强制规则（对齐 qa_agent 0a 规范）

生成完 spec 后，扫描所有 `expect()` 调用执行质量校验：

| 模式 | 判定 | 必须修复 |
|------|------|---------|
| `expect(locator).toBeVisible()` 单独出现 | **弱断言** | 若 assertions[].expected 有值 → 改为 `toContainText()` 或 `toHaveText()`；无值 → 保留但加注释"// TODO: 补充内容断言" |
| `expect(locator).toBeTruthy()` | **弱断言** | 替换为具体断言 |
| `toHaveText('{expected}')` | 强断言 ✅ | 无需修改 |
| `toContainText('{expected}')` | 强断言 ✅ | 无需修改 |
| `toHaveAttribute(...)` | 强断言 ✅ | 无需修改 |
| `expect(locator).toBeHidden()` | 语义正确 ✅ | 缺失状态验证，无需修改 |

### C.7 测试数据自足规则

- 每个 `test()` 以独立的 `goto()` 开始，不依赖其他 test 的页面状态
- `{timestamp}` 占位符 → 替换为 `Date.now()`：
  ```typescript
  const taskName = `Test-Upload-${Date.now()}`
  ```
- 文件上传路径使用相对路径 + 注释说明：
  ```typescript
  // 请在 tests/e2e/fixtures/files/ 下准备对应测试文件
  await p.setInputFilesFileSelector('tests/e2e/fixtures/files/sample.pdf')
  ```

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

- [ ] POM 文件路径：`tests/e2e/pages/{slug}.page.ts`
- [ ] Spec 文件路径：`tests/e2e/specs/{slug}-prd.test.ts`
- [ ] 文件头含 `// source: prd`、`// handoff:` 两行注释
- [ ] `test.describe` 数量 = handoff 中 `storyId` 去重数量
- [ ] `test()` 数量 = handoff 数组长度（减去 skipped 数量）
- [ ] 所有 `expect()` 均为强断言（无未修复的弱断言）
- [ ] 无 hardcoded 数据 ID（如直接写 `'abc123'`）
- [ ] 已有 POM 未被重建（追加新方法，原有方法保留）
- [ ] 文件上传用例生成了本地文件准备的注释
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
