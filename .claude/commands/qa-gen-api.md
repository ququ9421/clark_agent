---
description: "API 测试流水线：分析 API Schema → 生成 API/集成测试 → 执行 → 报告"
allowed-tools: Agent, Bash, Read, Write, Edit, Grep, Glob
---

# /qa-gen-api — API 与集成测试生成

## 用法

```
/qa-gen-api [--target <API目录或文件>] [--mock-level <L1|L2|L3|all>] [--source <本地路径>]
```

## 参数

| 参数 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `--target <path>` | 否 | 扫描整个源项目 | 聚焦到特定 API 目录或路由文件 |
| `--mock-level <level>` | 否 | `all`（或 `.env` 的 `API_MOCK_LEVEL`） | Mock 层级：`L1` 网络层 / `L2` LLM 层 / `L3` 数据层 / `all` |
| `--source <dir>` | 否 | `.env` 的 `SOURCE_PROJECT_DIR` | 覆盖源码目录（本地路径） |

支持中英文自然语言输入，无需严格使用 flag 格式。

## 示例

```bash
# 扫描整个项目，生成所有 API 测试（全量 Mock）
/qa-gen-api

# 只生成 tasks 相关端点的测试
/qa-gen-api --target app/api/tasks

# 只生成网络层 Mock（跳过 L2 LLM 和 L3 数据）
/qa-gen-api --mock-level L1

# 指定目录 + 限定 Mock 层级
/qa-gen-api --target app/api/ --mock-level L1

# 自然语言输入
/qa-gen-api 只测 tasks API
/qa-gen-api 不要 mock
/qa-gen-api 只要网络层 mock
```

---

## 流程概览

```
/qa-gen-api [--target] [--mock-level] [--source]
     |
Phase 0: 加载上下文（.env → 源码路径 + Mock 级别解析）
     |
Step 1: Schema 分析（检测 API 风格 + 数据模型 + AI SDK）
     |
Step 2: 调度 api-orchestrator / sonnet（生成三类测试 + 三层 Mock）
     |
Step 3: 执行测试（vitest run tests/api/）
     |
Step 4: 输出报告（覆盖率 + 失败分析 + Mock 层级统计）
```

---

## Phase 0: 加载项目上下文

```
Read(".env")
```

提取以下配置：

| 变量 | 用途 |
|------|------|
| `QA_WORKSPACE_DIR` | 测试文件写入目录 |
| `SOURCE_PROJECT_DIR` | 被测项目源码目录（本地路径） |
| `TARGET_GITHUB_OWNER` / `TARGET_GITHUB_REPO` | 被测项目 GitHub 仓库 |
| `TARGET_BRANCH` | 读取的分支（默认 `main`） |
| `GITHUB_TOKEN` | GitHub 认证 Token |
| `API_MOCK_LEVEL` | 默认 Mock 层级（可被 `--mock-level` 覆盖） |

**源码路径解析（优先级从高到低）**：

```
1. --source 参数（显式指定本地路径）

2. TARGET_GITHUB_OWNER + TARGET_GITHUB_REPO 均非空
   → 通过 GitHub Contents API 按需读取文件（不 clone）
   → branch = TARGET_BRANCH，token = GITHUB_TOKEN

   列出目录：
     GH_TOKEN=$GITHUB_TOKEN gh api \
       "repos/$OWNER/$REPO/contents/{dirPath}?ref=$BRANCH" \
       --jq '[.[] | {name, path, type}]'

   读取文件：
     GH_TOKEN=$GITHUB_TOKEN gh api \
       "repos/$OWNER/$REPO/contents/{filePath}?ref=$BRANCH" \
       --jq '.content' | base64 -d | head -c 20000

   关键字搜索：
     GH_TOKEN=$GITHUB_TOKEN gh api \
       "search/code?q={keyword}+repo:$OWNER/$REPO" \
       --jq '[.items[] | {path, url: .html_url}]'

   API 失败（401/404）→ 提示检查 GITHUB_TOKEN 和仓库名 → exit

3. SOURCE_PROJECT_DIR 非空 → 读本地文件系统

4. 均未配置 → 提示用户配置其中一项 → exit
```

**自然语言参数解析**：

| 输入 | 解析结果 |
|------|---------|
| `只测 tasks API` / `only tasks` | target = 含 "tasks" 的 API 路由路径 |
| `不要 mock` / `no mock` | mockLevel = none |
| `只要网络层 mock` | mockLevel = L1 |
| `包含 LLM mock` | mockLevel = L1+L2 |
| `全量 mock` / `all mocks` | mockLevel = all |

---

## Step 1: Schema 分析

扫描源项目检测 API 层（按优先级）：

```
1. OpenAPI / Swagger spec
   Glob("$sourceDir/**/{openapi,swagger}.{json,yaml,yml}")

2. tRPC Router
   Grep("createTRPCRouter|initTRPC", "$sourceDir", glob: "*.ts")

3. Next.js App Router
   Glob("$sourceDir/app/api/**/route.{ts,js}")

4. Next.js Pages Router
   Glob("$sourceDir/pages/api/**/*.{ts,js}")

5. Express / Hono
   Grep("app\\.(get|post|put|delete|patch)", "$sourceDir", glob: "*.ts")
```

同时检测：
```
数据模型：
  Grep("pgTable|mysqlTable|sqliteTable", glob: "*.ts") → Drizzle
  Grep("^model ", glob: "*.prisma")                    → Prisma

AI SDK（决定是否生成 L2 mock）：
  Grep("generateText|streamText|import.*from ['\"]ai['\"]", glob: "*.ts")
```

构建 `schemaAnalysis`：apiStyle / endpoints[] / entities[] / existingRequestLib / hasAiSdk

若指定了 `--target`：将扫描限制在该路径，数据模型仍全局扫描。

---

## Step 2: 调度 api-orchestrator

启动 api-orchestrator（sonnet）：

```
先读 .claude/agents/api-orchestrator.md，再读 skills/api-test-generator/SKILL.md。

Input:
  sourceProjectDir : $sourceDir
  targetProjectDir : $QA_WORKSPACE_DIR
  mockLevel        : {解析后的 mockLevel}
  targetPath       : {--target 参数或 null}
  schemaAnalysis   : {Step 1 输出}

执行：
  1. 使用 schemaAnalysis（跳过重新检测）
  2. 生成三类测试（单端点 / 调用链 / 数据一致性）
  3. 按 mockLevel 生成三层 Mock
  4. 返回产物路径
```

**三层 Mock 生成规则**：

| 层 | 技术 | 生成条件 |
|----|------|---------|
| L1 网络层 | MSW handlers | 始终生成（隔离外部 HTTP 依赖） |
| L2 LLM 层 | MockLanguageModelV2 | `hasAiSdk === true` 时自动生成 |
| L3 数据层 | fixtures + seed.ts | 需要数据库状态的测试时生成 |

---

## Step 3: 执行测试

```bash
cd $QA_WORKSPACE_DIR

# 全量执行
npx vitest run tests/api/ \
  --reporter=json \
  --outputFile=tests/reports/api-results.json

# 指定 target 时只跑匹配文件
npx vitest run tests/api/{feature}.api.test.ts \
  --reporter=json \
  --outputFile=tests/reports/api-results.json
```

**执行规则**：
- 使用 `vitest run`（不进入 watch 模式）
- 不 fail-fast，收集所有结果用于报告
- 始终输出 JSON 报告

---

## Step 4: 报告

```markdown
## API 测试报告

### 概览
- 总用例数 : {total}
- 通过     : {passed} ✓
- 失败     : {failed} ✗
- 跳过     : {skipped}

### API 覆盖率
- 已覆盖 endpoint : {covered} / {total}（{percentage}%）
- 未覆盖          : {未覆盖端点列表}

### 失败分析
- **{test name}**
  - 文件     : {测试文件路径}
  - 错误     : {error message}
  - 可能原因 : {AI 分析的根因}

### Mock 层级
- L1（网络层）: {count} handlers
- L2（LLM 层）: {count} handlers
- L3（数据层）: {count} fixtures
```

返回结构化 JSON：

```json
{
  "summary": { "total": 42, "passed": 38, "failed": 3, "skipped": 1, "coveragePercent": 85 },
  "testFiles": ["tests/api/tasks.api.test.ts"],
  "mockFiles": ["tests/mocks/handlers/tasks.ts"],
  "reportFile": "tests/reports/api-results.json",
  "failures": [
    {
      "test": "POST /api/tasks should validate input",
      "file": "tests/api/tasks.api.test.ts",
      "error": "Expected 400, received 500",
      "analysis": "服务端返回 500 而非 400 — 缺少输入验证中间件"
    }
  ]
}
```

---

## 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| 源码未配置（GitHub 和本地均缺失） | 提示在 `.env` 配置 `TARGET_GITHUB_OWNER/REPO` 或 `SOURCE_PROJECT_DIR` |
| 未检测到任何 API 路由 | 列出检测到的文件，提示确认 API 框架类型 |
| OpenAPI spec 格式无效 | 输出解析错误位置，提示用户修复 |
| `--target` 路径不存在 | 列出 API 目录下可用路径 |
| GitHub API 返回 401 / 404 | 提示检查 `GITHUB_TOKEN` 权限和仓库名 |
| vitest 未安装 | 提示运行 `npm install` |

---

## 产物输出

```
tests/
├── api/
│   ├── {feature}.api.test.ts          ← 单端点测试
│   └── {feature}-chain.api.test.ts    ← 调用链集成测试
├── mocks/
│   └── handlers/
│       ├── {feature}.ts               ← MSW handlers（L1）
│       └── llm.ts                     ← LLM mock（L2，跨 feature 共享）
├── fixtures/
│   ├── {feature}.ts                   ← 数据 fixture（L3）
│   └── seed.ts                        ← Seed 脚本（跨 feature 共享）
└── reports/
    └── api-results.json               ← 执行结果 JSON
```
