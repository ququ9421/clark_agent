# Clark Agent — 目录结构与调用关系

## 总体架构：3 层调用链

```
用户输入
   ↓
.claude/commands/   ← 第 1 层：入口，解析参数、编排流程
   ↓
.claude/agents/     ← 第 2 层：专职执行者，负责具体生成工作
   ↓
skills/             ← 第 3 层：规则文档，定义"怎么做"的标准
```

---

## 各目录详解

### `.claude/commands/` — 入口层（你直接调用的）

你在对话框输入 `/qa-gen-cases` 时，Claude 就会读取这里对应的 `.md` 文件并按其流程执行。

```
命令文件的职责：
  1. 读取 .env，解析参数
  2. 执行准备工作（确认文件存在、创建目录等）
  3. 把任务分发给 Agent 或直接调用 Skill
  4. 执行完后汇总输出给用户
```

| 文件 | 触发方式 | 主要做什么 |
|------|---------|-----------|
| `qa-gen-cases.md` | `/qa-gen-cases docs/login.md login` | 读需求文档 → 调 Skill 生成用例 → 导出 Excel |
| `qa-gen-unit.md` | `/qa-gen-unit --target src/auth.ts` | 扫描源码函数 → 派发给 unit-test-agent → 执行测试 |
| `qa-gen-api.md` | `/qa-gen-api --target app/api/` | 检测 API Schema → 派发给 api-orchestrator → 执行测试 |

---

### `.claude/agents/` — 执行层（命令调用，你不直接用）

Agent 是被命令文件"召唤"出来的专家，负责复杂的具体生成工作。每个 Agent 启动时第一件事就是读取对应的 SKILL.md，确保按规范执行。

```
Agent 文件的职责：
  1. 声明自己用哪个模型（opus/sonnet）
  2. 定义接收的输入参数格式
  3. 规定执行的 Phase 流程
  4. 规定返回给命令层的 JSON 格式
```

| 文件 | 由谁调用 | 使用模型 | 主要做什么 |
|------|---------|---------|-----------|
| `unit-test-agent.md` | `qa-gen-unit.md` | opus | 读函数体 → 设计用例 → 写 .test.ts 文件 |
| `api-orchestrator.md` | `qa-gen-api.md` | sonnet | 解析 Schema → 生成三类测试 + 三层 Mock 文件 |

---

### `skills/` — 规则层（Agent 读取，定义标准）

Skill 是**纯文档**，不直接执行，只定义"规则"。Agent 启动后必须先读 SKILL.md，然后严格按里面的方法执行。

```
SKILL.md 的职责：
  1. 定义测试设计方法（几种方法、每种怎么用）
  2. 定义代码生成模板（输出什么格式的代码）
  3. 定义质量检查清单（生成完后自检什么）
  4. 定义输出文件的命名和结构
```

| 目录 | 被谁读取 | 定义什么规则 |
|------|---------|------------|
| `test-case-generator/` | `qa-gen-cases.md` 直接读取 | 6 种设计方法、TC ID 格式、Handoff JSON Schema |
| `excel-case-export/` | `qa-gen-cases.md` 直接读取 | Markdown 解析规则、Excel 三个 Sheet 的格式 |
| `unit-test-generator/` | `unit-test-agent.md` 读取 | 4 种测试方法、8 种 Mock 策略、复杂度分级规则 |
| `api-test-generator/` | `api-orchestrator.md` 读取 | 3 类测试结构、L1/L2/L3 Mock 规则、文件命名规范 |

`excel-case-export/scripts/generate-excel.js` 是这里唯一的**可执行脚本**，由命令层直接用 `node` 运行。

---

### `tests/` — 产物层（自动生成，不手写）

这里的文件全部由命令执行后自动写入，你不需要手动操作。

```
tests/
├── e2e/test-cases/generated/   ← /qa-gen-cases 生成的用例文档
│   ├── {feature}-prd.md
│   ├── {feature}-prd.xlsx
│   └── playwright-handoff-{feature}.json
│
├── api/                        ← /qa-gen-api 生成的测试脚本
│   ├── {feature}.api.test.ts
│   └── {feature}-chain.api.test.ts
│
├── mocks/handlers/             ← /qa-gen-api 生成的 MSW mock
│   └── {feature}.ts
│
├── fixtures/                   ← /qa-gen-api 生成的测试数据
│   └── {feature}.ts
│
└── reports/                    ← 执行后的 JSON 报告
    ├── unit-results.json
    └── api-results.json
```

单元测试（`/qa-gen-unit`）生成的 `.test.ts` 不在这里，而是**贴近源码放置**（放在 `SOURCE_PROJECT_DIR` 里对应文件旁边）。

---

### `docs/` — 输入层（你写的需求文档）

```
docs/
└── login-requirements.md   ← 示例：喂给 /qa-gen-cases 的需求文档
```

你把需求写成 Markdown 放这里，然后用 `/qa-gen-cases docs/xxx.md` 触发生成。

---

## 完整调用流程图

```
你输入命令
    │
    ▼
.claude/commands/{cmd}.md
    │  ① 读 .env（获取路径、Token、配置）
    │  ② 解析参数、检查文件
    │  ③ 准备工作（创建目录等）
    │
    ├─── 简单任务 ──→ 直接读 skills/SKILL.md 执行（如 qa-gen-cases）
    │
    └─── 复杂任务 ──→ .claude/agents/{agent}.md
                          │  ① 读对应 skills/SKILL.md（获取规则）
                          │  ② 按 Phase 流程执行生成
                          │  ③ 写文件到 tests/
                          └─→ 返回 JSON 摘要给命令层
    │
    ▼
命令层汇总结果，输出报告给你
```

---

---

## 两条 UI 测试链路

### 链路 A：需求驱动（适合有需求文档、应用不可访问时）

```
/qa-gen-cases docs/login.md login
    ↓ AI 根据文档推断 locator（可能不准确）
playwright-handoff-login.json

/qa-gen-script login
    ↓
tests/e2e/specs/login-prd.test.ts

/qa-run --suite smoke
```

### 链路 B：CDP 探查驱动（适合有可访问应用时，locator 更准确）

```
/qa-explore https://your-app.com/login --slug login
    ↓ 真实浏览器 → 发现真实 DOM locator
cdp-baseline-login.json（含真实 locatorHint）
    ↓ test-case-generator（CDP 模式）
playwright-handoff-login.json
    ↓ e2e-orchestrator
tests/e2e/specs/login-cdp.test.ts

/qa-run --slug login
```

**CDP 探查前置条件**：
1. 安装 MCP 服务器：`npm install -g chrome-devtools-mcp@latest`
2. 在 `.claude/settings.json` 中注册（见下方配置说明）
3. Chrome 浏览器已打开

**`.claude/settings.json` 配置**（需手动创建）：
```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

---

## 一句话总结每层的角色

| 层 | 目录 | 角色类比 |
|----|------|---------|
| 入口层 | `.claude/commands/` | 项目经理：收需求、拆任务、出报告 |
| 执行层 | `.claude/agents/` | 工程师：接任务、按规范做、交付产物 |
| 规则层 | `skills/` | 规范文档：定义"什么叫做好" |
| 产物层 | `tests/` | 交付物：自动生成的测试文件 |
| 输入层 | `docs/` | 需求库：喂给 AI 的原始材料 |
