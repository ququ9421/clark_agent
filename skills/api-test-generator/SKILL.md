---
name: api-test-generator
description: 基于 API Schema + 调用链自动生成 API/集成测试，支持 MSW mock 和测试数据 fixture 生成。所有测试描述和注释使用简体中文，技术标识符保留英文。
version: 1.0.0
allowed_tools: [Read, Write, Bash, Grep, Glob]
---

# API Test Generator Skill

> **通用能力**：分析源项目的 API 路由、Schema 和数据模型，生成三类测试（单端点 / 调用链 / 数据一致性）+ 三层 Mock（L1 网络 / L2 LLM / L3 数据）。

## 输出语言

所有测试描述和注释**必须使用简体中文**。仅以下内容保留英文：HTTP 方法、路径、类型名、变量名、技术标识符。

---

## 适用场景

- 源项目有 API 路由（Express / Next.js App Router / tRPC）
- OpenAPI / Swagger spec 可用
- 需要测试 API 端点并隔离外部依赖

## 输入

| 输入 | 必填 | 说明 |
|------|:----:|------|
| API 路由文件或 OpenAPI spec | YES | 端点定义来源 |
| TS 类型定义 | 推荐 | request/response 类型契约 |
| schemaAnalysis（来自 api-orchestrator Phase 1） | YES | 已解析的结构化端点信息 |
| mockLevel | 可选 | L1 / L2 / L3 / all（默认 all） |

---

## Schema 检测优先级

### Priority 1: OpenAPI / Swagger Spec

```
Glob("$sourceProjectDir/**/{openapi,swagger}.{json,yaml,yml}")
```

若找到：解析所有 paths、methods、parameters、requestBody、responses，解引用 `$ref`，提取 security schemes。

### Priority 2: tRPC Router

```
Grep("createTRPCRouter|initTRPC|router\\(", "$sourceProjectDir", glob: "*.ts")
```

若找到：解析 procedure 名称（query / mutation），提取 `.input()` 和 `.output()` 的 Zod schema，识别 auth middleware。

### Priority 3: Next.js App Router API Routes

```
Glob("$sourceProjectDir/app/api/**/route.{ts,js}")
```

若找到：解析导出函数（GET / POST / PUT / DELETE / PATCH），提取 request 解析模式，映射动态路径段（`[id]`）。

### Priority 4: Express / Hono Routes

```
Grep("app\\.(get|post|put|delete|patch|use)\\(|Hono\\(", "$sourceProjectDir", glob: "*.ts")
```

若找到：解析路由注册和 handler 函数，提取中间件链（auth、validation），映射路由参数和 query string。

---

## 测试类型

### Type 1: 单端点测试

为每个端点生成以下类别的测试用例：

| 类别 | 测试内容 | 优先级 |
|------|---------|--------|
| CRUD happy path | 正常创建/读取/更新/删除 | P0 |
| Input validation | 必填字段缺失、类型错误、格式非法 | P1 |
| Auth & permission | 无 token→401、错误角色→403、过期 token | P0 |
| Boundary values | 空字符串、最大长度、数值边界、空数组 | P1 |
| Error handling | 404、409 冲突、非法状态转换 | P1 |
| Edge cases | 并发请求、unicode、特殊字符 | P2 |

**测试结构模板**：

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { handlers } from '../mocks/handlers/{feature}'

const server = setupServer(...handlers)

describe('POST /api/tasks', () => {
  beforeAll(() => server.listen())
  afterAll(() => server.close())

  it('应创建任务并返回201', async () => {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test Task', status: 'open' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ title: 'Test Task', status: 'open' })
    expect(body.id).toBeDefined()
  })

  it('缺少必填字段时应返回400', async () => {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
```

### Type 2: 调用链集成测试

识别跨多个端点的业务流程，生成链式测试：

| 模式 | 流程 | 验证点 |
|------|------|--------|
| CRUD lifecycle | create → read → update → delete | 每步验证上一步的副作用 |
| 依赖创建 | create parent → create child → list children | 父子关系完整性 |
| 状态转换 | create(open) → update(in-progress) → update(done) | 状态机合法性 |
| 写后读 | create → search/filter → verify included | 数据可见性 |

**链式测试结构**：

```typescript
describe('任务 CRUD 完整链路', () => {
  let taskId: string

  it('Step 1: 创建任务', async () => {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: `Chain-${Date.now()}` }),
    })
    expect(res.status).toBe(201)
    taskId = (await res.json()).id
  })

  it('Step 2: 读取刚创建的任务', async () => {
    const res = await fetch(`/api/tasks/${taskId}`)
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe(taskId)
  })

  it('Step 3: 更新任务', async () => {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ title: 'Updated' }),
    })
    expect(res.status).toBe(200)
  })

  it('Step 4: 删除任务', async () => {
    const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('Step 5: 确认已删除', async () => {
    const res = await fetch(`/api/tasks/${taskId}`)
    expect(res.status).toBe(404)
  })
})
```

### Type 3: 数据一致性测试

验证写操作产生的数据可通过相关端点读取：

- POST 创建 → GET 读取 → 所有字段完全匹配
- PUT 更新 → GET 读取 → 更新字段已反映在响应中
- 创建子实体 → GET 父实体子列表 → 所有子实体在列表中
- DELETE 删除 → 相关查询 → 已删除实体不再出现

---

## Mock 策略

### L1: 网络层（MSW Handlers）

拦截对外部服务的出站 HTTP 请求：

```typescript
// tests/mocks/handlers/{feature}.ts
import { http, HttpResponse } from 'msw'

export const handlers = [
  // Mock 外部支付 API
  http.post('https://api.stripe.com/v1/charges', () => {
    return HttpResponse.json({ id: 'ch_mock', status: 'succeeded' })
  }),

  // Mock 第三方服务
  http.get('https://external-api.com/data', () => {
    return HttpResponse.json({ items: [] })
  }),
]
```

**何时生成**：始终生成——任何调用外部 HTTP 服务的端点都需要 L1 mock。

### L2: LLM 层（MockLanguageModelV2）

当端点调用 AI SDK（`generateText`、`streamText` 等）时生成：

```typescript
import { MockLanguageModelV2 } from 'ai/test'

const mockModel = new MockLanguageModelV2({
  doGenerate: async () => ({
    text: 'Mocked AI response',
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 20 },
  }),
})
```

**检测规则**：
```
Grep("generateText|streamText|generateObject|streamObject", "$sourceProjectDir", glob: "*.ts")
Grep("import.*from ['\"]ai['\"]", "$sourceProjectDir", glob: "*.ts")
→ 若找到，生成 L2 mock
```

### L3: 数据层（Fixtures + Seed）

当测试需要真实数据库状态时生成：

```typescript
// tests/fixtures/{feature}.ts
export const taskFixtures = {
  openTask: {
    id: 'fixture-open-1',
    title: 'Open Task',
    status: 'open',
    createdAt: new Date('2026-01-01'),
  },
  completedTask: {
    id: 'fixture-done-1',
    title: 'Completed Task',
    status: 'done',
    completedAt: new Date('2026-01-02'),
  },
}
```

Seed 脚本（针对 Drizzle 项目）：
```typescript
// tests/fixtures/seed.ts
import { db } from '@/db'
import { tasks } from '@/db/schema'

export async function seedTestData() {
  await db.insert(tasks).values([...taskFixtures])
}

export async function cleanTestData() {
  await db.delete(tasks).where(/* test data filter */)
}
```

**何时生成**：当测试需要可预期的数据库状态（CRUD 测试、过滤测试、分页测试）时。

---

## 输出文件规范

所有生成的文件必须是合法的 **Vitest** 测试文件：

- 从 `vitest` import：`describe`、`it`、`expect`、`beforeAll`、`afterAll`、`beforeEach`、`afterEach`
- 所有 HTTP 调用使用 `async/await`
- 每个测试文件自包含，带自己的 MSW server setup
- 测试数据使用 `Date.now()` 或 UUID 保证唯一性，不用可能冲突的固定 ID

### 文件命名

| 文件类型 | 路径 | 示例 |
|---------|------|------|
| 单端点测试 | `tests/api/{feature}.api.test.ts` | `tests/api/tasks.api.test.ts` |
| 调用链测试 | `tests/api/{feature}-chain.api.test.ts` | `tests/api/tasks-chain.api.test.ts` |
| MSW handlers | `tests/mocks/handlers/{feature}.ts` | `tests/mocks/handlers/tasks.ts` |
| LLM mocks | `tests/mocks/handlers/llm.ts` | （跨 feature 共享） |
| 数据 fixtures | `tests/fixtures/{feature}.ts` | `tests/fixtures/tasks.ts` |
| Seed 脚本 | `tests/fixtures/seed.ts` | （跨 feature 共享） |

---

## 约束

- **不修改业务代码** — 只在 `tests/` 下生成文件
- **优先使用项目已有的 HTTP 客户端** — 检查 `package.json` 中的 `axios`、`ky`、`got` 等
- **不 hardcode secrets** — API key、token、URL 均使用 `process.env.XXX`
- **测试隔离** — 每个测试自行创建/清理数据，不跨测试共享可变状态
- **确定性 mock** — LLM mock 返回固定响应，保证测试可重复
