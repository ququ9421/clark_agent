# 项目结构与 TypeScript 接口定义

---

## 1. 推荐项目目录布局

```
tests/
├── e2e/
│   ├── test-cases/
│   │   └── generated/
│   │       ├── {feature}-{source}.md              ← 测试用例文档
│   │       └── playwright-handoff-{slug}.json      ← Handoff JSON
│   ├── pages/
│   │   └── {feature}.page.ts                      ← Page Object
│   ├── specs/
│   │   └── {feature}-{source}.test.ts             ← Playwright spec
│   ├── fixtures.ts                                 ← 扩展 base.extend
│   └── data.setup.ts                               ← 前置数据创建
├── api/
│   ├── specs/                                      ← API 测试 spec
│   └── mocks/                                      ← MSW handlers
├── mocks/
│   ├── handlers/                                   ← L1 MSW handlers
│   ├── llm-fixtures/                               ← L2 LLM mock
│   └── seeds/                                      ← L3 DB seed
├── perf/
│   ├── *.k6.js                                     ← k6 脚本
│   ├── baseline.json                               ← 性能基线
│   └── results/                                    ← k6 结果
└── reports/
    └── *.json                                      ← 测试报告
```

---

## 2. TypeScript 接口定义

### 核心类型

```typescript
// types.ts

export interface UserStory {
  id: string                       // kebab-case，如 "user-login"
  feature: string                  // 大写，如 "LOGIN"（用于 TC ID）
  role: string                     // 用户角色
  action: string                   // 行为描述
  value: string                    // 业务价值
  hasInputFields: boolean          // 是否有表单输入
  entryPage: string                // 入口页面中文名
  entryUrl: string                 // 入口页面 URL
  acceptanceCriteria: AcceptanceCriterion[]
}

export interface AcceptanceCriterion {
  id: string                       // AC-001
  description: string              // 验收标准描述
}

export interface FieldDefinition {
  name: string                     // 字段显示名（中文）
  role: string                     // ARIA role
  semanticType: string             // 字段语义类型（email/password/mobile/name）
  dataType?: string                // contact.email 等
  required: boolean
  maxLength?: number
  defaultValue: string
}

export type ScenarioType = 'positive' | 'negative' | 'boundary' | 'error' | 'blocked'
export type Priority = 'P0' | 'P1' | 'P2'
export type Source = 'prd' | 'cdp' | 'issue' | 'branch'

export interface SetupStep {
  type: 'navigate' | 'fixture' | 'api' | 'login' | 'custom'
  action: string
  pomMethod: string
  data?: Record<string, unknown>
  scope?: 'worker'
  fixtureId?: string
}

export interface UIElement {
  role: string
  name: string
  action: 'fill' | 'click' | 'select' | 'check' | 'upload' | 'hover' | 'press'
  value?: string
  dataType?: string
  dataVariant?: string
  i18nKey?: string
  locatorHint: string
}

export interface Assertion {
  type: 'url' | 'visible' | 'text' | 'value' | 'count' | 'enabled' | 'disabled' | 'custom'
  target?: string
  expected?: string | number
  i18nKey?: string
}

export interface TeardownStep {
  action: string
  pomMethod: string
  data?: Record<string, unknown>
}

export interface TestCase {
  id: string                       // TC-PRD-LOGIN-001
  storyId: string                  // prd-login
  title: string                    // 简体中文，动词开头
  source: Source
  priority: Priority
  criterionId: string | null
  scenarioType: ScenarioType
  tags: string[]
  preconditions: string[]
  setup: SetupStep[]
  uiElements: UIElement[]
  assertions: Assertion[]
  teardown: TeardownStep[]
  timeout: number | null
}
```

---

## 3. Cucumber 项目集成

若项目使用 Cucumber.js（BDD 风格），建议以下目录结构：

```
features/
├── step_definitions/
│   ├── login.steps.ts
│   └── shared.steps.ts
├── support/
│   ├── world.ts                   ← CustomWorld 定义
│   └── hooks.ts                   ← Before/After 钩子
└── *.feature                      ← Gherkin feature 文件（从 handoff 生成）
```

### CustomWorld 定义

```typescript
// features/support/world.ts
import { setWorldConstructor, World, IWorldOptions } from '@cucumber/cucumber'
import { Page, Browser, BrowserContext, chromium } from '@playwright/test'

interface CustomWorldOptions extends IWorldOptions {
  page?: Page
}

export class CustomWorld extends World {
  browser!: Browser
  context!: BrowserContext
  page!: Page

  constructor(options: CustomWorldOptions) {
    super(options)
  }
}

setWorldConstructor(CustomWorld)
```

### Before/After 钩子

```typescript
// features/support/hooks.ts
import { Before, After, BeforeAll, AfterAll } from '@cucumber/cucumber'
import { chromium } from '@playwright/test'
import { CustomWorld } from './world'

BeforeAll(async function () {
  // 全局初始化
})

Before(async function (this: CustomWorld) {
  this.browser = await chromium.launch()
  this.context = await this.browser.newContext()
  this.page = await this.context.newPage()
})

After(async function (this: CustomWorld) {
  await this.context.close()
  await this.browser.close()
})
```

---

## 4. 环境变量配置

| 变量 | 说明 | 示例 |
|------|------|------|
| `APP_URL` | 被测应用 URL | `http://localhost:3000` |
| `i18nMessagesDir` | i18n 消息文件目录 | `src/messages` |
| `i18nDefaultLocale` | 默认语言 | `zh` |
| `QA_WORKSPACE_DIR` | 测试产物输出目录 | `tests/e2e/test-cases/generated` |
| `E2E_TEST_EMAIL` | E2E 测试账号邮箱 | `ci@example.com` |
| `E2E_TEST_PASSWORD` | E2E 测试账号密码 | （从 .env 读取，勿硬编码） |
