---
description: "单元测试流水线：分析源码 → 生成增量单元测试 → 执行 → 报告"
allowed-tools: Agent, Bash, Read, Write, Edit, Grep, Glob
---

# /qa-gen-unit — 白盒单元测试生成

## 用法

```
/qa-gen-unit [--target <文件或目录>] [--style <vitest|jest>] [--source <本地路径>]
```

## 参数

| 参数 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `--target <path>` | 否 | git diff 变更文件 | 指定要分析的文件或目录；省略则自动分析当前分支 vs main 的变更 |
| `--style <framework>` | 否 | 自动检测 | 强制指定测试框架：`vitest` 或 `jest` |
| `--source <dir>` | 否 | `.env` 的 `SOURCE_PROJECT_DIR` | 覆盖源码目录（本地路径） |

支持中英文自然语言输入，无需严格使用 flag 格式。

## 示例

```bash
# 分析单个文件
/qa-gen-unit --target src/services/auth.ts

# 分析整个目录（递归扫描所有 .ts 文件）
/qa-gen-unit --target src/utils/

# 指定测试框架
/qa-gen-unit --target src/services/ --style jest

# 分析当前分支 vs main 的所有变更文件
/qa-gen-unit

# 自然语言输入
/qa-gen-unit 给 auth.service.ts 写单测
/qa-gen-unit 测试当前分支变更
/qa-gen-unit 分析 src/utils
```

---

## 流程概览

```
/qa-gen-unit [--target] [--style] [--source]
     |
Phase 0: 加载上下文（.env → 源码路径 + 测试框架检测）
     |
Step 1: 变更分析（扫描函数 → 去重已覆盖 → 输出 functionList）
     |
Step 2: 调度 unit-test-agent / opus（生成测试文件）
     |
Step 3: 执行测试（vitest / jest run → 自动修复最多 2 次）
     |
Step 4: 输出报告（统计 + 潜在 Bug 检测）
```

---

## Phase 0: 加载项目上下文

```
Read(".env")
```

提取以下配置：

| 变量 | 用途 |
|------|------|
| `QA_WORKSPACE_DIR` | 项目工作目录 |
| `SOURCE_PROJECT_DIR` | 被测项目源码目录（本地路径） |
| `TARGET_GITHUB_OWNER` / `TARGET_GITHUB_REPO` | 被测项目 GitHub 仓库 |
| `TARGET_BRANCH` | 读取的分支（默认 `main`） |
| `GITHUB_TOKEN` | GitHub 认证 Token |
| `UNIT_TEST_STYLE` | 默认测试框架（可被 `--style` 覆盖） |

**源码路径解析（优先级从高到低）**：

```
1. --source 参数（显式指定本地路径）

2. TARGET_GITHUB_OWNER + TARGET_GITHUB_REPO 均非空
   → 通过 GitHub Contents API 按需读取文件（不 clone）
   → branch = TARGET_BRANCH，token = GITHUB_TOKEN

   读取文件：
     GH_TOKEN=$GITHUB_TOKEN gh api \
       "repos/$OWNER/$REPO/contents/{filePath}?ref=$BRANCH" \
       --jq '.content' | base64 -d | head -c 20000

   列出目录：
     GH_TOKEN=$GITHUB_TOKEN gh api \
       "repos/$OWNER/$REPO/contents/{dirPath}?ref=$BRANCH" \
       --jq '[.[] | {name, path, type}]'

   API 失败（401/404）→ 提示检查 GITHUB_TOKEN 和仓库名 → exit

3. SOURCE_PROJECT_DIR 非空 → 读本地文件系统

4. 均未配置 → 提示用户配置其中一项 → exit
```

**测试框架检测**：

```
优先级：--style 参数 > UNIT_TEST_STYLE 环境变量 > package.json 自动检测
  Grep("vitest", package.json) → vitest
  Grep("jest", package.json)   → jest
  均未找到                     → 默认 vitest
```

---

## Step 1: 变更分析

### 1.1 确定分析范围

```
--target 是文件    → files = [target]
--target 是目录    → Glob("$target/**/*.{ts,tsx,js,jsx}")（排除 *.test.* 和 node_modules）
--target 未指定    → git diff main...HEAD --name-only --diff-filter=ACMR
                     无 diff → 提示使用 --target 指定文件 → exit
```

### 1.2 提取函数清单

对每个文件，提取所有可测试的导出函数/方法：

```
- export function xxx
- export const xxx = () =>
- export default function
- class methods（public）

记录：filePath / functionName / startLine / endLine / signature / complexity
  complexity: "simple"（<20行且无外部依赖）| "complex"
```

### 1.3 去重已覆盖函数

```
扫描：Glob("$projectDir/**/*.test.{ts,tsx,js,jsx}") → existingTests[]

For each function:
  Grep("describe|test|it.*{functionName}", existingTests)
  已覆盖 → 移出 functionList，记入 skipped[]
  签名变更 → 保留，标记 "needs update"
```

### 1.4 functionList 输出格式

```json
{
  "functionList": [
    {
      "filePath": "src/utils/calculate.ts",
      "functionName": "calculateTotal",
      "startLine": 15,
      "endLine": 32,
      "signature": "(items: Item[], taxRate: number) => number",
      "isExported": true,
      "complexity": "complex"
    }
  ],
  "skipped": [
    { "functionName": "formatDate", "reason": "already covered in __tests__/formatDate.test.ts" }
  ],
  "totalFunctions": 8,
  "needsTests": 5,
  "alreadyCovered": 3
}
```

`functionList` 为空 → 提示"所有函数已有测试覆盖" → exit

---

## Step 2: 调度 unit-test-agent

启动 unit-test-agent（opus）：

```
先读 .claude/agents/unit-test-agent.md，再读 skills/unit-test-generator/SKILL.md。

Input:
  functionList  : {Step 1 输出}
  testStyle     : {检测到的框架}
  projectDir    : $sourceDir
  testSpecFile  : $projectDir/unit-testing.md（不存在则 null）
  existingTests : {Step 1 扫描结果}

生成测试文件，返回 generatedFiles[] + coverageSummary + skipped[]
```

---

## Step 3: 执行测试

```bash
# Vitest
npx vitest run --reporter=json \
  --outputFile=tests/reports/unit-results.json {generatedFiles}

# Jest
npx jest --json \
  --outputFile=tests/reports/unit-results.json {generatedFiles}
```

**失败处理**：

| 失败类型 | 判断依据 | 处理方式 |
|---------|---------|---------|
| 测试写错 | assertion / mock 逻辑有误 | 修复测试代码，最多重试 2 次 |
| 代码 Bug | 函数行为与预期不符 | 不改源码，记入报告 Potential Bugs |

---

## Step 4: 报告

```markdown
## Unit Test Report

### Summary
- Functions analyzed : {total}
- Already covered   : {skipped}（跳过）
- Tests generated   : {generated}
- Total test cases  : {cases}

### Results
- Passed : {pass} / {total}
- Failed : {fail} / {total}

### Generated Files
| File | Functions Covered | Test Cases | Status |
|------|-------------------|------------|--------|
| src/utils/__tests__/calculate.test.ts | calculateTotal, calculateDiscount | 7 | PASS |

### Skipped（已有覆盖）
| Function | Existing Test |
|----------|---------------|
| formatDate | __tests__/formatDate.test.ts |

### Potential Bugs Detected
| Function | Expected | Actual | File:Line |
|----------|----------|--------|-----------|

### New Coverage
- Lines    : +{N} lines covered
- Branches : +{N} branches covered
```

---

## 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| 源码未配置（GitHub 和本地均缺失） | 提示在 `.env` 配置 `TARGET_GITHUB_OWNER/REPO` 或 `SOURCE_PROJECT_DIR` |
| `--target` 文件不存在 | 列出源码目录下的 `.ts` 文件供用户选择 |
| 文件中无可检测的导出函数 | 提示确认是否使用了标准导出语法 |
| GitHub API 返回 401 / 404 | 提示检查 `GITHUB_TOKEN` 权限和仓库名 |
| vitest / jest 未安装 | 提示运行 `npm install` |

---

## 产物输出

测试文件**贴近源码放置**（不集中在 `tests/` 下）：

```
源文件：src/utils/calculate.ts

优先放置（项目已有 __tests__/）：
  src/utils/__tests__/calculate.test.ts

默认放置（同级）：
  src/utils/calculate.test.ts
```

报告文件：
```
tests/reports/unit-results.json    ← 执行结果 JSON
```
