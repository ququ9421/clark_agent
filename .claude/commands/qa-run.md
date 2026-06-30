---
description: "E2E 测试执行：运行 Playwright 测试 → 输出报告"
allowed-tools: Agent, Bash, Read, Write, Glob
---

# /qa-run — 执行 Playwright E2E 测试

执行已生成的 Playwright 测试脚本，输出通过/失败报告。

## 用法

```
/qa-run [spec文件或模块名] [--suite smoke|regression|full] [--slug <关键词>]
```

## 参数

| 参数 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `spec文件/模块名` | 否 | 全部 spec | 指定文件路径或模块名 |
| `--suite` | 否 | `full` | 套件：`smoke`（P0）/ `regression`（P0+P1）/ `full`（全部） |
| `--slug` | 否 | — | 按关键词过滤模块（如 `login`） |

支持中英文自然语言，无需严格使用 flag 格式。

## 示例

```bash
# 全量执行
/qa-run

# 只跑 P0 冒烟测试
/qa-run --suite smoke

# P0 + P1 回归测试
/qa-run --suite regression

# 只跑 login 相关的所有测试
/qa-run --slug login

# 指定具体 spec 文件
/qa-run tests/e2e/specs/login-prd.test.ts

# 自然语言
/qa-run 冒烟
/qa-run 回归
/qa-run 只跑 invoice
/qa-run 全量 invoice
```

---

## 流程概览

```
/qa-run [spec] [--suite] [--slug]
     |
Phase 0: 读 .env + 检查 playwright 安装状态
     |
Step 1: 解析参数 → 确定 spec 范围 + suite filter
     |
Step 2: 调度 test-executor / sonnet（执行测试）
     |
Step 3: 解析测试报告
     |
Step 4: 输出报告摘要
```

---

## Phase 0：加载项目上下文

```
Read(".env")
```

提取 `QA_WORKSPACE_DIR`。

**前置检查**：

```
playwright.config.ts 存在？
  否 → 提示："playwright.config.ts 不存在，请先运行 /qa-gen-script"
  → exit

tests/e2e/specs/ 下有 .test.ts 文件？
  否 → 提示："未找到 spec 文件，请先运行 /qa-gen-script 生成脚本"
  → exit

node_modules/@playwright/test 存在？
  否 → 自动运行 npm install
```

---

## Step 1：解析参数

**自然语言解析**：

| 输入 | 解析结果 |
|------|---------|
| `冒烟` / `smoke` | suite = smoke |
| `回归` / `regression` | suite = regression |
| `全量` / `full` / `所有` | suite = full |
| `只跑 {名称}` / `--slug {名称}` | slug = {名称} |
| `P0` | suite = smoke |
| `P0+P1` | suite = regression |

**spec 文件范围解析**：

```
有 positional 文件路径（以 .test.ts 结尾）
  → specFiles = [该路径]

有 --slug 或自然语言模块名
  → Glob("tests/e2e/specs/**/*{slug}*.test.ts")
  → 找到 0 个 → 提示："未找到 {slug} 相关的 spec 文件"

无参数
  → specFiles = []（test-executor 会运行全部）
```

---

## Step 2：调度 test-executor

启动 test-executor（sonnet）：

```
你是 test-executor。先读取 .claude/agents/test-executor.md 了解职责。

Input:
  specFiles  : {解析后的文件列表，空数组表示全量}
  suite      : {smoke | regression | full}
  projectDir : {QA_WORKSPACE_DIR}

执行测试，返回结果摘要。
```

等待执行完成（不设超时，Playwright 自己管理超时）。

收集：`total` / `passed` / `failed` / `skipped` / `duration` / `failures[]`

---

## Step 3：解析测试报告

```
Read("$QA_WORKSPACE_DIR/tests/reports/playwright-results.json")
```

提取失败用例的详情，进行初步诊断（连接失败、定位器失效、文案变化等）。

---

## Step 4：输出报告摘要

**全部通过时**：
```
✅ 全部通过

| 项目     | 值 |
|----------|-----|
| 执行套件 | {suite} |
| 总用例数 | {total} |
| 通过     | {passed} ✓ |
| 跳过     | {skipped} |
| 耗时     | {duration}s |

报告文件：
  JSON：tests/reports/playwright-results.json
  HTML：playwright-report/index.html（运行 npm run test:e2e:report 打开）
```

**存在失败时**：
```
❌ 存在失败

| 项目     | 值 |
|----------|-----|
| 执行套件 | {suite} |
| 总用例数 | {total} |
| 通过     | {passed} ✓ |
| 失败     | {failed} ✗ |
| 跳过     | {skipped} |
| 耗时     | {duration}s |

### 失败用例
| # | 用例 ID | 标题 | 错误摘要 | 可能原因 |
|---|---------|------|---------|---------|
| 1 | TC-PRD-INVOICE-001 | 批量上传... | Timeout 30000ms | baseURL 未配置或应用未启动 |

报告文件：
  JSON：tests/reports/playwright-results.json
  HTML：playwright-report/index.html（运行 npm run test:e2e:report 打开）

### 常见失败排查
- Timeout / ECONNREFUSED → 检查 PLAYWRIGHT_BASE_URL / APP_URL 是否正确，应用是否已启动
- locator resolved to N elements → POM 定位器匹配多个元素，需加 .first() 或更精确的 selector
- Expected...to have text → 页面文案与 Handoff JSON 中的 expected 值不一致，需更新 Handoff JSON
```

---

## 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| playwright.config.ts 不存在 | 提示运行 `/qa-gen-script` |
| 无 spec 文件 | 提示运行 `/qa-gen-script` |
| --slug 无匹配文件 | 列出 `tests/e2e/specs/` 下可用文件 |
| npx playwright 执行失败（非用例失败） | 输出完整错误日志，提示检查 Playwright 安装 |

---

## 产物输出

```
tests/reports/
  playwright-results.json    ← 执行结果 JSON（机器可读）

playwright-report/
  index.html                 ← HTML 可视化报告（npm run test:e2e:report 打开）

test-results/
  {失败截图和 trace 文件}    ← 失败时自动生成
```
