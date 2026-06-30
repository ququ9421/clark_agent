---
description: "Playwright 脚本生成：从 Handoff JSON 生成 Page Object + spec + config"
allowed-tools: Agent, Bash, Read, Write, Glob
---

# /qa-gen-script — 生成 Playwright 测试脚本

从 `playwright-handoff-{slug}.json` 生成可运行的 Playwright E2E 测试脚本，是 `/qa-gen-cases` 的最后一步。

## 用法

```
/qa-gen-script [handoff文件路径或功能模块名]
```

## 参数

| 参数 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `handoff路径或模块名` | 否 | 自动扫描 `tests/e2e/test-cases/generated/` | 支持：文件路径 / 模块名（如 `login`）/ 留空自动扫描 |

## 示例

```bash
# 指定模块名（最常用）
/qa-gen-script login
/qa-gen-script invoice-management

# 指定完整文件路径
/qa-gen-script tests/e2e/test-cases/generated/playwright-handoff-login.json

# 不带参数，自动扫描所有 handoff 文件
/qa-gen-script
```

---

## 流程概览

```
/qa-gen-script [handoff]
     |
Phase 0: 读 .env → 解析 baseURL
     |
Step 1: 定位 Handoff JSON（参数 > 自动扫描 > 报错）
     |
Step 2: 调度 e2e-orchestrator / opus（生成 POM + spec）
     |
Step 3: 确认 playwright.config.ts（不存在时由 Skill 生成）
     |
Step 4: 输出摘要
```

---

## Phase 0：加载项目上下文

```
Read(".env")
```

提取：
- `APP_URL` — 被测应用 URL
- `PLAYWRIGHT_BASE_URL` — Playwright 专用 base URL（优先，留空则回退到 APP_URL）
- `QA_WORKSPACE_DIR` — 测试产物输出目录
- `E2E_TEST_EMAIL` — 若非空，playwright.config.ts 会生成含 setup 项目的配置

`baseURL` 解析：`PLAYWRIGHT_BASE_URL` > `APP_URL` > `http://localhost:3000`

---

## Step 1：定位 Handoff JSON

```
有参数且以 .json 结尾
  → 直接使用该路径

有参数且为模块名（如 login）
  → 查找 tests/e2e/test-cases/generated/playwright-handoff-{模块名}.json

无参数
  → Glob("tests/e2e/test-cases/generated/playwright-handoff-*.json")
  → 找到 0 个 → 提示："未找到 Handoff JSON，请先运行 /qa-gen-cases"
  → 找到 1 个 → 直接使用
  → 找到多个 → 展示列表供用户选择：
    "找到 N 个 Handoff 文件，请选择要生成脚本的模块：
     1. invoice-management（17 个用例）
     2. login（12 个用例）
     ..."
```

提取 `slug`：从文件名去掉 `playwright-handoff-` 前缀和 `.json` 后缀。

---

## Step 2：调度 e2e-orchestrator

启动 e2e-orchestrator（opus）：

```
你是 e2e-orchestrator。先读取 .claude/agents/e2e-orchestrator.md 了解职责，
再读取 skills/playwright-script-generator/SKILL.md 了解生成规则。

Input:
  handoffFile    : {Handoff JSON 绝对路径}
  slug           : {功能模块名}
  targetProjectDir: {QA_WORKSPACE_DIR}
  baseURL        : {解析后的 baseURL}

按 SKILL.md Phase 0→E 执行，返回产物路径和统计信息。
```

等待 agent 完成，收集：
- `pomFile` — Page Object 路径
- `specFile` — Playwright spec 路径
- `configGenerated` — 是否新建了 playwright.config.ts
- `totalTests` / `skipped` / `weakAssertionsFixed`

---

## Step 3：确认基础设施

```
playwright.config.ts 存在？
  否（configGenerated = false 且文件不存在）→ 报错：配置生成失败

tests/e2e/specs/ 目录存在？
  否 → 提示目录创建失败

playwright/.auth/ 目录（当 E2E_TEST_EMAIL 非空时）
  不存在 → Bash("mkdir -p playwright/.auth")
```

---

## Step 4：输出摘要

```
✅ Playwright 脚本生成完成

📄 Page Object  : {pomFile}
🧪 Spec 文件    : {specFile}
⚙️  Config      : playwright.config.ts（{新建 / 使用已有}）
📋 测试统计：
  - 总计：{totalTests} 个 test()
  - P0（@smoke）：XX 个
  - P1（@regression）：XX 个
  - P2（@full）：XX 个
  - 跳过（已有覆盖）：{skipped} 个
  - 修复弱断言：{weakAssertionsFixed} 处

下一步：
  - 确认 .env 中 PLAYWRIGHT_BASE_URL 已指向被测应用
  - 若有文件上传用例，在 tests/e2e/fixtures/files/ 准备测试文件
  - 运行 /qa-run --suite smoke 执行 P0 冒烟测试
  - 运行 /qa-run 执行全量测试
```

---

## 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| Handoff JSON 不存在 | 提示运行 `/qa-gen-cases` 先生成用例 |
| Handoff JSON 格式无效 | 输出具体错误（哪条 entry 缺哪个字段） |
| 输出目录无写权限 | 提示检查目录权限 |
| playwright.config.ts 生成失败 | 输出错误详情，提示手动创建 |

---

## 产物输出

```
tests/e2e/
├── pages/
│   └── {slug}.page.ts              ← Page Object（新建或追加）
└── specs/
    └── {slug}-prd.test.ts          ← Playwright spec

playwright.config.ts                ← Playwright 配置（不存在时自动生成）
playwright/.auth/                   ← 认证状态目录（有 E2E_TEST_EMAIL 时创建）
```
