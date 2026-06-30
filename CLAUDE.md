# QA Agent 平台

## 项目简介

这是一个基于 Claude Code 的 QA 自动化测试平台，通过 AI 驱动测试用例生成、UI 测试执行、接口测试和白盒测试，逐步建立完整的测试闭环。

## 项目结构

```
my_qa_agent/
├── .claude/
│   ├── commands/       ← 用户可调用的 /slash 命令
│   ├── agents/         ← 专职子 Agent 定义
│   └── references/     ← 各 Agent/Skill 共享的参考文档
├── skills/             ← 可复用技能模块（每个有 SKILL.md）
├── tests/
│   ├── e2e/
│   │   ├── test-cases/ ← 测试用例文档（由 /qa-gen-cases 生成）
│   │   ├── pages/      ← Page Object 文件（由 /qa-gen-script 生成）
│   │   └── specs/      ← Playwright spec 文件（由 /qa-gen-script 生成）
│   ├── api/            ← API 测试产物（由 /qa-gen-api 生成）
│   ├── mocks/handlers/ ← MSW mock handlers
│   ├── fixtures/       ← 测试数据 fixtures
│   └── reports/        ← 测试报告 JSON
├── playwright.config.ts ← Playwright 配置（由 /qa-gen-script 自动生成）
├── playwright-report/  ← HTML 测试报告（运行时生成）
├── docs/               ← 架构文档
├── CLAUDE.md           ← 本文件（Claude 启动时读取）
├── vitest.config.ts    ← Vitest 配置
└── .env                ← 环境变量配置
```

## 已有能力

### Slash 命令
| 命令 | 说明 |
|------|------|
| `/qa-explore` | **CDP 探查**：连接真实浏览器 → 发现真实 locator → 生成用例 → 生成脚本（locator 准确率更高） |
| `/qa-gen-cases` | 从需求文档生成测试用例（Markdown + Excel + Handoff JSON） |
| `/qa-gen-script` | 从 Handoff JSON 生成 Page Object + Playwright spec（UI 测试脚本生成） |
| `/qa-run` | 执行已生成的 Playwright E2E 测试，输出报告（支持 smoke/regression/full 套件） |
| `/qa-gen-unit` | 分析 TypeScript 源文件 → 自动检测框架 → 增量生成单元测试 → 执行 → 报告 |
| `/qa-gen-api` | 扫描 API Schema → 生成三类测试（单端点/调用链/数据一致性）+ 三层 Mock → 执行 → 报告 |

### Agents
| Agent | 说明 |
|-------|------|
| `e2e-orchestrator` | E2E 脚本生成引擎（opus）。读取 Handoff JSON，调用 Skill 生成 POM + Playwright spec |
| `test-executor` | Playwright 测试执行器（sonnet）。运行 npx playwright test，返回结果摘要 |
| `unit-test-agent` | 单元测试生成专家（opus）。读取函数清单，按 SKILL.md 生成 Vitest 测试文件 |
| `api-orchestrator` | API 测试编排引擎（sonnet）。分析 Schema，生成三类测试和三层 Mock |

### Skills
| Skill | 说明 |
|-------|------|
| `cdp-explorer` | 通过 CDP 连接浏览器探查页面状态，BFS 发现所有交互元素，输出含真实 locatorHint 的 cdp-baseline JSON |
| `test-case-generator` | 用 6 种设计方法从需求生成 BDD 测试用例；TC ID 格式 `TC-{SOURCE}-{FEATURE}-{NNN}`；强制输出 Playwright Handoff JSON；支持 CDP baseline 模式 |
| `excel-case-export` | 将 Markdown 测试用例导出为 Excel（.xlsx），含用例列表、详细用例、统计三个 Sheet |
| `playwright-script-generator` | Handoff JSON → Page Object + Playwright spec；严格 1:1 映射；强断言质量校验；定位器优先级策略 |
| `test-data-setup` | 为 E2E 测试生成前置数据基础设施；配置驱动（test-data.config.json）；并行创建 + 三级回退（env → 缓存 → UI 创建）；支持从已有 spec 反向抽象 fixture |
| `mock-config-generator` | 扫描源码自动生成三层 Mock 配置；L1 MSW Handler（HTTP 拦截）/ L2 MockLanguageModelV2+Langfuse 录制回放（LLM）/ L3 Drizzle seed 脚本（数据层）；零侵入不修改业务代码 |
| `unit-test-generator` | 4 种方法（等价类/边界值/分支路径覆盖/异常场景）生成单元测试；框架自动检测；8 种 Mock 策略 |
| `api-test-generator` | 3 类测试（单端点/调用链/数据一致性）+ L1/L2/L3 三层 Mock；Schema 优先级检测 |
| `perf-test-generator` | 为 AI 应用生成 k6 性能测试脚本；支持 REST/SSE/WebSocket/混合 4 种模板；AI Streaming 专属指标（TTFT P95<2s、Stream Throughput）；baseline.json PR 级退化检测（>10% 告警） |

## 命名规范

### 测试产物命名
- 测试用例文档：`{slug}-{source}.md`
  - source ∈ `{prd, issue, cdp, branch}`
- 测试脚本：`{slug}-{source}.test.ts`
- Page Object：`{slug}.page.ts`

### 优先级定义
- P0：核心业务路径，必须通过
- P1：重要功能，回归必测
- P2：边界/异常场景，有时间则测

## 环境变量

所有敏感配置在 `.env` 中管理，`.env.example` 作为模板。

| 变量 | 用途 |
|------|------|
| `APP_URL` | 被测应用 URL |
| `SOURCE_PROJECT_DIR` | 被测项目源码目录（本地路径，与 TARGET_GITHUB 配置二选一） |
| `TARGET_GITHUB_URL` | 被测项目 GitHub 完整 URL（展示用） |
| `TARGET_GITHUB_OWNER` | 被测项目 GitHub Owner（配置后通过 Contents API 按需读取，优先于本地路径） |
| `TARGET_GITHUB_REPO` | 被测项目 GitHub 仓库名 |
| `TARGET_BRANCH` | 读取的分支（默认 `main`，被测项目 GitHub 和 E2E 分支分析共用） |
| `GITHUB_TOKEN` | GitHub Token（被测项目读取和 QA 平台 GitHub 操作共用） |
| `QA_WORKSPACE_DIR` | 测试产物输出目录 |
| `PLAYWRIGHT_BASE_URL` | Playwright E2E 测试 base URL（留空则读 APP_URL） |
| `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` | E2E 测试账号（`/qa-explore` 登录墙自动填充；`playwright.config.ts` 启用认证 setup） |
| `UNIT_TEST_STYLE` | 单元测试框架（留空自动检测：vitest → jest） |
| `API_SPEC_PATH` | OpenAPI/Swagger spec 文件路径 |
| `TEST_BASE_URL` | API 测试 base URL |
| `API_MOCK_LEVEL` | Mock 层级：L1 / L2 / L3 / all |
| `APP_LANGUAGES` | 被测应用支持的语言列表（逗号分隔，默认 `zh`，用于 i18n 测试） |
| `PLAYWRIGHT_HEADLESS` | Playwright 是否无头模式（默认 `true`） |
| `GITHUB_OWNER` / `GITHUB_REPO` | QA 平台自身的 GitHub 仓库（与 TARGET_GITHUB_* 区分，用于平台 CI/CD 操作） |
| `LINEAR_API_KEY` | Linear API Token（可选，用于从 Issue 生成测试用例） |
| `LINEAR_PROJECT_ID` / `LINEAR_TEAM_ID` | Linear 项目和团队 ID（配置 LINEAR_API_KEY 后生效） |

## 当前目标应用

（填写你要测试的应用信息，例如：应用名称、URL、技术栈）

## 开发原则

1. **先描述清楚，再让 AI 执行** — Skill/Agent 文档越详细，生成质量越高
2. **串行 CDP + 并行 AI** — 浏览器操作串行，AI 生成可并行
3. **上下文隔离** — 子 Agent 处理大数据，只向上返回摘要
4. **渐进增强** — 每个阶段先跑通核心闭环，再扩展能力
5. **CDP 探查优先于需求推断** — 有真实可访问应用时，优先用 `/qa-explore` 代替 `/qa-gen-cases`，locator 直接来自真实 DOM，准确率更高
