---
name: mock-config-generator
description: 自动扫描源码中的外部依赖（HTTP 调用、LLM 调用、DB 查询），生成三层 Mock 配置（L1 网络层 MSW Handler / L2 LLM 层 MockLanguageModelV2+录制回放 / L3 数据层 Drizzle seed）。零侵入，不修改业务代码。
version: 1.0.0
allowed_tools: [Read, Write, Bash, Grep, Glob]
---

# Mock Config Generator Skill

> **核心能力**：自动分析源码中的外部依赖（HTTP 调用、LLM 调用、DB 查询），生成三层 Mock 配置。
> **零侵入**：不修改任何业务代码，通过网络拦截、LLM 替身、seed 数据实现测试隔离。

---

## 适用场景

当目标项目需要在测试环境中隔离以下外部依赖：
- HTTP / REST API 调用（第三方服务、内部微服务）
- LLM API 调用（OpenAI、Anthropic 等，通过 Vercel AI SDK）
- 数据库查询（通过 Drizzle ORM）

---

## 三层 Mock 架构

```
┌─────────────────────────────────────────────────────────┐
│  L1 网络层 Mock                                          │
│  MSW (Mock Service Worker) + Hono mock-server            │
│  覆盖：fetch / axios → 第三方 API、内部微服务             │
│  方式：分析调用点 → 自动生成 MSW handler                  │
│  零侵入：在网络层拦截，不修改业务代码                      │
├─────────────────────────────────────────────────────────┤
│  L2 LLM 层 Mock                                          │
│  MockLanguageModelV2 + Langfuse 录制回放                 │
│  单元/集成测试：MockLanguageModelV2 确定性响应            │
│  E2E 测试：Langfuse trace → fixture JSONL → 回放         │
│  Eval：必须调用真实 LLM（eval 的价值所在，不可 mock）      │
├─────────────────────────────────────────────────────────┤
│  L3 数据层 Mock                                          │
│  Drizzle Schema → seed 脚本 + fixture 管理               │
│  方式：从 Schema 自动推断并生成 seed 数据                  │
│  隔离：worker-scope fixture，测试前 seed / 测试后 cleanup │
└─────────────────────────────────────────────────────────┘
```

---

## 输入参数

| 参数 | 必填 | 说明 | 示例 |
|------|:----:|------|------|
| `sourceDir` | YES | 源码目录（扫描 import/fetch/axios 调用） | `src/` |
| `schemaDir` | NO | Drizzle Schema 目录（L3 数据层 Mock） | `src/db/schema` |
| `langfuseProject` | NO | Langfuse 项目名（L2 录制回放） | `my-ai-app` |
| `outputDir` | NO | Mock 文件输出目录，默认 `tests/mocks` | `tests/mocks` |

---

## 工作流

### Step 1：扫描源码，识别外部依赖

```
扫描范围：sourceDir/**/*.{ts,tsx,js,jsx}

识别模式：

  L1 网络层：
    - fetch("https://...")  /  fetch("/api/...")
    - axios.get / post / put / delete(...)
    - 自定义 HTTP client 调用
    → 提取：URL pattern、HTTP method、request/response 类型

  L2 LLM 层：
    - import { generateText, streamText } from 'ai'
    - import { openai } from '@ai-sdk/openai'
    - import { anthropic } from '@ai-sdk/anthropic'
    - new OpenAI(...)  /  new Anthropic(...)
    → 提取：model name、调用方式（generate/stream）、prompt 模板

  L3 数据层：
    - import { db } from './db'
    - db.select / insert / update / delete(...)
    - Drizzle schema 定义（pgTable, mysqlTable, sqliteTable）
    → 提取：表名、字段定义、关系
```

### Step 2：分类到 L1 / L2 / L3

```
对每个识别到的依赖：
  HTTP 调用  → L1
  LLM SDK 调用 → L2
  DB 操作    → L3

输出分类报告（示例）：
  L1: 12 个 HTTP endpoint（3 个第三方、9 个内部 API）
  L2:  4 个 LLM 调用点（2 个 streamText、2 个 generateText）
  L3:  8 张表（users, tasks, files, ...）
```

### Step 3：为每个依赖生成 Mock 配置

#### L1 — MSW Handler 生成

```typescript
// tests/mocks/handlers/api-tasks.ts
import { http, HttpResponse } from 'msw'

export const taskHandlers = [
  http.get('/api/tasks', () => {
    return HttpResponse.json([
      { id: '1', title: 'Mock Task', status: 'completed' },
    ])
  }),

  http.post('/api/tasks', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: '2', ...body, status: 'pending' })
  }),
]
```

**生成规则**：
- 从源码提取 URL pattern + HTTP method
- 推断 response 类型（从 TypeScript 类型或调用上下文）
- 按字段名推断合理的 mock 数据（`id` → UUID、`email` → test@example.com 等）
- 外部第三方 API → 固定 mock 响应，确保测试稳定
- 内部 API → 可选 `passthrough()`，集成测试不 mock 内部调用

#### L2 — LLM Fixture 生成

**单元 / 集成测试：MockLanguageModelV2（确定性响应）**

```typescript
// tests/mocks/llm-fixtures/chat-completion.ts
import { MockLanguageModelV2 } from 'ai/test'

export const mockChatModel = new MockLanguageModelV2({
  defaultObjectGenerationMode: 'json',
  doGenerate: async () => ({
    rawCall: { rawPrompt: null, rawSettings: {} },
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 20 },
    text: '这是一个确定性的 mock 响应，用于测试。',
  }),
  doStream: async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-delta', textDelta: 'Mock ' })
        controller.enqueue({ type: 'text-delta', textDelta: 'streaming ' })
        controller.enqueue({ type: 'text-delta', textDelta: 'response.' })
        controller.enqueue({
          type: 'finish',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 3 },
        })
        controller.close()
      },
    }),
    rawCall: { rawPrompt: null, rawSettings: {} },
  }),
})
```

**E2E 测试：Langfuse 录制回放（真实 trace → JSONL fixture）**

```jsonl
// tests/mocks/llm-fixtures/chat-traces.jsonl
{"traceId":"tr_001","input":"用Python写快速排序","output":"```python\ndef quicksort(arr):\n  ...```","model":"gpt-4o","latencyMs":1200,"tokens":{"prompt":15,"completion":85}}
{"traceId":"tr_002","input":"解释这段代码","output":"这段代码实现了...","model":"gpt-4o","latencyMs":800,"tokens":{"prompt":120,"completion":200}}
```

**回放流程**：
1. 从 Langfuse API 导出 trace（按 project + time range）
2. 序列化为 JSONL fixture 文件
3. 测试运行时按 `input` 哈希匹配 → 返回录制的 `output`
4. 匹配不到 → fallback 到 `MockLanguageModelV2`

#### L3 — Drizzle Seed 脚本生成

```typescript
// tests/mocks/seeds/users-seed.ts
import { db } from '../../src/db'
import { users } from '../../src/db/schema'

export async function seedUsers() {
  await db.insert(users).values([
    {
      id: 'test-user-1',
      name: 'Test User',
      email: 'test@example.com',
      role: 'admin',
      createdAt: new Date('2026-01-01'),
    },
    {
      id: 'test-user-2',
      name: 'Regular User',
      email: 'user@example.com',
      role: 'member',
      createdAt: new Date('2026-01-01'),
    },
  ])
}

export async function cleanupUsers() {
  await db.delete(users).where(
    users.id.in(['test-user-1', 'test-user-2'])
  )
}
```

**生成规则**：
- 从 Drizzle Schema 读取表结构和字段类型
- 按字段名推断合理 seed 数据（`email` → `test@example.com`、`role` → 枚举第一项等）
- 每个表生成 `seed()` + `cleanup()` 函数对
- worker 隔离：ID 带 worker 索引前缀（`test-user-${workerIndex}-1`），避免并行冲突

### Step 4：输出 Handler 文件 + 配置清单

---

## 输出文件

| 文件 | 路径 | 说明 |
|------|------|------|
| MSW handlers | `tests/mocks/handlers/*.ts` | 每个 API 模块一个文件 |
| MSW server setup | `tests/mocks/server.ts` | MSW server 初始化（Node / Browser 双端） |
| LLM fixtures（mock） | `tests/mocks/llm-fixtures/*.ts` | MockLanguageModelV2 实例 |
| LLM fixtures（replay） | `tests/mocks/llm-fixtures/*.jsonl` | Langfuse trace 录制回放数据 |
| Seed 脚本 | `tests/mocks/seeds/*.ts` | Drizzle seed + cleanup 函数 |
| Mock 配置清单 | `tests/mocks/mock-manifest.json` | 所有 mock 依赖的索引（机器可读） |

### mock-manifest.json 结构

```json
{
  "_generatedAt": "2026-06-30T00:00:00Z",
  "_sourceDir": "src/",
  "l1_network": {
    "handlers": [
      {
        "file": "handlers/api-tasks.ts",
        "endpoints": [
          { "method": "GET",  "path": "/api/tasks",  "source": "src/hooks/useTasks.ts:12" },
          { "method": "POST", "path": "/api/tasks", "source": "src/actions/createTask.ts:8" }
        ]
      }
    ],
    "total": 12
  },
  "l2_llm": {
    "mocks": [
      {
        "file": "llm-fixtures/chat-completion.ts",
        "type": "MockLanguageModelV2",
        "callSites": ["src/lib/ai/chat.ts:25", "src/lib/ai/summarize.ts:10"]
      }
    ],
    "replays": [
      {
        "file": "llm-fixtures/chat-traces.jsonl",
        "traceCount": 50,
        "langfuseProject": "my-ai-app"
      }
    ],
    "total": 4
  },
  "l3_data": {
    "seeds": [
      {
        "file": "seeds/users-seed.ts",
        "table": "users",
        "schema": "src/db/schema/users.ts",
        "recordCount": 2
      }
    ],
    "total": 8
  }
}
```

---

## MSW Server Setup 模板

```typescript
// tests/mocks/server.ts
import { setupServer } from 'msw/node'
import { taskHandlers } from './handlers/api-tasks'
// import { userHandlers } from './handlers/api-users'
// ... 其余 handler

export const server = setupServer(
  ...taskHandlers,
  // ...userHandlers,
)
```

**Vitest 集成**（`tests/setup.ts`）：

```typescript
import { beforeAll, afterEach, afterAll } from 'vitest'
import { server } from './mocks/server'

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

---

## 各测试类型使用规则

| 测试类型 | L1 网络层 | L2 LLM 层 | L3 数据层 |
|---------|:---------:|:---------:|:---------:|
| 单元测试 | MSW handler | MockLanguageModelV2 | seed + cleanup |
| 集成测试 | MSW handler（内部 API 可 passthrough） | MockLanguageModelV2 | seed + cleanup |
| E2E 测试 | 按需（通常不 mock） | Langfuse 录制回放 | test-data-setup fixture |
| Eval | 不 mock | **真实 LLM（必须）** | 真实数据 |

> **Eval 不可 mock LLM**：eval 的价值在于评估真实模型行为，mock 会使评估结果失去意义。

---

## 新项目接入流程

1. 提供 `sourceDir` → Skill 自动扫描依赖
2. 审核 `mock-manifest.json` → 确认 mock 准确性（**首次接入需人工审核**）
3. 将 MSW server setup 集成到 `tests/setup.ts`
4. 如需 L2 录制回放 → 配置 `langfuseProject` 并运行一次导出
5. 如需 L3 数据层 Mock → 提供 `schemaDir`，Skill 自动生成 seed 脚本

## 增量更新规则

| 情况 | 处理方式 |
|------|---------|
| 源码新增 API 调用 | 重新扫描 → 追加新 handler，不覆盖已有 handler |
| 修改 API response 结构 | 手动更新对应 handler（Skill 不自动覆盖已有文件） |
| 新增数据库表 | 重新扫描 schemaDir → 追加 seed 脚本 |
| 删除依赖 | Skill 生成报告，人工确认后删除对应 mock 文件 |
