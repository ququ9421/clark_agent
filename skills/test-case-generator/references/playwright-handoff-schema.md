# Playwright Handoff JSON — 完整字段规范

> **权威来源**：本文件是 `playwright-handoff-{slug}.json` 的完整规范。
> 被以下组件引用：test-case-generator、playwright-script-generator、e2e-orchestrator。

---

## 1. 完整 Schema 定义

```typescript
interface HandoffEntry {
  id: string                    // TC-PRD-LOGIN-001
  storyId: string               // prd-login（kebab-case，来自功能域）
  title: string                 // 简体中文，动词开头
  source: 'prd' | 'cdp' | 'issue' | 'branch'
  priority: 'P0' | 'P1' | 'P2'
  criterionId: string | null    // AC-001，无则 null
  scenarioType: ScenarioType
  tags: string[]                // ["@P0","@smoke","@regression","@full"]
  preconditions: string[]       // 简体中文，可执行描述
  setup: SetupStep[]
  uiElements: UIElement[]
  assertions: Assertion[]
  teardown: TeardownStep[]
  timeout: number | null        // ms，null = Playwright 默认值
}

type ScenarioType = 'positive' | 'negative' | 'boundary' | 'error' | 'blocked'

interface SetupStep {
  type: 'navigate' | 'fixture' | 'api' | 'login' | 'custom'
  action: string                // 可读描述
  pomMethod: string             // POM 方法名
  data?: Record<string, unknown>
  scope?: 'worker'              // 省略 = 默认 "test"
  fixtureId?: string            // type=fixture 时必填
}

interface UIElement {
  role: string                  // ARIA role
  name: string                  // accessible name（简体中文或来自设计稿）
  action: 'fill' | 'click' | 'select' | 'check' | 'upload' | 'hover' | 'press'
  value?: string                // fill/select/press 时填写
  dataType?: string             // 语义类型（见 §2）
  dataVariant?: string          // 数据变体，设了 dataType 时必填
  i18nKey?: string              // 元素文本对应的 i18n key
  locatorHint: string           // Playwright locator 表达式
}

interface Assertion {
  type: 'url' | 'visible' | 'text' | 'value' | 'count' | 'enabled' | 'disabled' | 'custom'
  target?: string               // 元素描述或选择器
  expected?: string | number    // 期望值
  i18nKey?: string              // 期望文本对应的 i18n key
}

interface TeardownStep {
  action: string
  pomMethod: string
  data?: Record<string, unknown>
}
```

---

## 2. dataType 完整推断表

Script-generator 根据 `dataType` + `dataVariant` 自动生成具体测试数据。

| 字段语义关键词 | dataType | dataVariant 取值 | 示例值 |
|---------------|----------|-----------------|--------|
| 手机号、mobile、phone、电话 | `contact.mobile` | `valid` / `invalid` / `boundary` | `13800138000` / `abc` / `12345678901234` |
| 邮箱、email、e-mail | `contact.email` | `valid` / `invalid` / `xss` | `test@example.com` / `not-email` / `<script>@x.com` |
| 姓名、name、真实姓名、full name | `identity.name` | `valid` / `boundary` | `张三` / `${50个汉字}` |
| 密码、password、passwd | `account.password` | `valid` / `invalid` / `strong` / `boundary` | `Test@12345` / `123` / `T3st!Str0ng#2026` / `${21位}` |
| 图片文件 | `file.image` | `valid` / `oversized` / `invalid_type` | `test.jpg` / `large.jpg(>10MB)` / `test.exe` |
| PDF 文件 | `file.pdf` | `valid` / `oversized` | `test.pdf` / `large.pdf(>50MB)` |
| 视频文件 | `file.video` | `valid` / `oversized` | `test.mp4` / `large.mp4(>500MB)` |
| 文本内容、content、描述、message | `text.content` | `valid` / `boundary` / `xss` | `测试内容` / `${255字符}` / `<img src=x onerror=alert(1)>` |
| 数字、金额、amount、price | `number.currency` | `valid` / `boundary` / `negative` | `100` / `0.01` / `-1` |
| 日期、date、时间 | `datetime.date` | `valid` / `boundary` / `past` / `future` | `2026-06-30` / `1900-01-01` / `2000-01-01` / `2099-12-31` |
| URL、链接、link | `text.url` | `valid` / `invalid` | `https://example.com` / `not-a-url` |
| 验证码、code、OTP | `auth.code` | `valid` / `invalid` / `expired` | `123456` / `abcdef` / `000000(过期)` |

---

## 3. i18nKey 反向查找算法

当项目有 i18n 消息文件时，script-generator 可用 i18nKey 替代硬编码文本，实现多语言测试。

**触发条件**：`$i18nMessagesDir` 环境变量已设置，且对应目录下存在 `{defaultLocale}.json`。

**查找步骤**：

```
1. 读取 $i18nMessagesDir/{defaultLocale}.json（如 messages/zh.json）
2. 将 JSON 扁平化：{ "auth.emailPlaceholder": "请输入邮箱", "nav.userName": "用户名" }
3. 对 uiElements[].name 和 assertions[].expected 做反向查找：
   value → key（取第一个匹配）
4. 找到 → 填写 i18nKey；找不到 → i18nKey 留 undefined，用原始文本
5. 警告：若有多个 key 对应同一文本，输出 WARN 提示人工确认
```

**fallback**：i18n 文件不存在或查找失败时，保持 `i18nKey: undefined`，不阻断生成。

---

## 4. timeout 自动检测完整关键词表

扫描每个 entry 的 `setup[].action` + `preconditions[]` 文本：

| 触发关键词 | 语言 | 场景 |
|-----------|------|------|
| `AI 生成` / `AI 任务` / `AI 处理` / `AI 响应` | 中文 | AI 内容生成 |
| `等待生成` / `等待完成` / `等待处理` | 中文 | 异步等待 |
| `流式输出` / `逐字输出` | 中文 | Streaming 响应 |
| `ai task` / `ai generate` / `ai process` | 英文 | AI 任务 |
| `wait for completion` / `wait for response` | 英文 | 异步等待 |
| `streaming` / `stream response` | 英文 | Streaming |
| `批量处理` / `batch process` | 中英 | 批量操作 |
| `训练` / `分析大文件` / `large file analysis` | 中英 | 计算密集 |

**规则**：任意一个关键词匹配 → 设 `timeout: 600000`（10 分钟）；否则 `timeout: null`。

---

## 5. setup[].scope 详细规则

### 何时设 "worker"

满足以下**全部三个条件**时，设 `"scope": "worker"`：

1. **只读数据**：setup 创建的数据在后续步骤中只被读取，不会被修改或删除
2. **耗时 > 30s**：action 包含 AI 生成、大文件处理、复杂 UI 创建序列等
3. **多测试共享**：同一 storyId 下有 ≥ 2 个 test 使用同一份前置数据

### 何时不设（省略 scope）

- 数据在 test 内被修改（编辑/删除场景）
- 数据创建耗时 < 30s
- 数据为单 test 专用（如唯一标题的新建操作）

### 示例

```json
// ✅ 设 scope: "worker" — AI 生成只读报告，多个 test 查看/导出该报告
{ "type": "custom", "action": "AI 生成分析报告", "pomMethod": "createAIReport",
  "scope": "worker" }

// ❌ 不设 scope — 创建数据后该 test 会编辑它
{ "type": "custom", "action": "创建待编辑任务", "pomMethod": "createTask" }
```

---

## 6. scenarioType 使用指南

| 值 | 适用场景 | 示例 |
|----|---------|------|
| `"positive"` | 正常流程、Happy Path、有效输入 | 正常登录、成功创建任务 |
| `"negative"` | 无效输入、错误场景、异常处理 | 密码错误、邮箱格式无效 |
| `"boundary"` | 边界值测试 | 密码恰好 8 位、最大上传文件 |
| `"error"` | 系统级错误、网络异常、权限错误 | 无权限访问、网络超时 |
| `"blocked"` | 对齐不完整，缺少足够信息无法生成完整步骤 | 设计稿有该功能但需求文档未描述交互细节 |

> `"blocked"` 用例必须在 title 前加 `[BLOCKED]` 前缀，并在 preconditions 中说明缺失信息。

---

## 7. tags 生成规则

| 标签 | 添加条件 |
|------|---------|
| `@P0` | priority === "P0" |
| `@P1` | priority === "P1" |
| `@P2` | priority === "P2" |
| `@smoke` | priority === "P0" 且 scenarioType === "positive" |
| `@regression` | priority === "P0" 或 "P1" |
| `@full` | 所有用例都加（完整回归套件） |
| `@blocked` | scenarioType === "blocked" |

---

## 8. 需求变更时的更新策略

当需求文档更新时，需逐一更新以下 7 类产物：

| # | 产物 | 更新内容 | 触发命令 |
|---|------|---------|---------|
| 1 | 测试用例 MD | 更新受影响的用例步骤/断言/数据，新增/删除用例 | `/qa-gen-cases --update` |
| 2 | Handoff JSON | 与 MD 保持同步，更新 schema 字段 | 同上，自动输出 |
| 3 | Page Object | 更新受影响的 POM 方法和 locator | `/qa-gen-script` |
| 4 | Playwright Spec | 更新受影响的 test() 块，保持 1:1 映射 | `/qa-gen-script` |
| 5 | test-data.config | 若前置数据类型变更，更新 fixtures 声明 | 手动修改后 `/qa-gen-cases` |
| 6 | MSW Handlers | 若 API 路径/response schema 变更，更新 handler | `/qa-gen-api --update` |
| 7 | Excel 用例表 | 重新导出（从更新后的 MD 自动生成） | `/qa-gen-cases --export-excel` |

**变更分类处理**：

| 变更类型 | 影响范围 | 处理方式 |
|---------|---------|---------|
| 新增功能点 | 1→2→3→4 | 增量生成，不覆盖已有用例 |
| 修改 UI 元素 / locator | 2→3→4 | 更新 uiElements[].locatorHint + POM |
| 修改验收标准 | 1→2 | 更新 assertions[]，priority 可能变化 |
| 删除功能点 | 1→2→3→4 | 标记为 deprecated，人工确认后删除 |
| 修改 API 契约 | 6 | 仅更新 MSW handler，spec 通常不变 |
| 修改测试数据 | 5→2→4 | 更新 config，重新生成 fixture + spec |
