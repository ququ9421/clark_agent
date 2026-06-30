---
description: "需求驱动测试用例生成：读取需求文档 → 生成 BDD 测试用例 → 导出 Excel + Handoff JSON"
allowed-tools: Bash, Read, Write, Glob
---

# /qa-gen-cases — 从需求文档生成测试用例

## 用法

```
/qa-gen-cases [需求文档路径] [功能模块名]
```

## 参数

| 参数 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `需求文档路径` | 否 | `docs/requirements.md` | 需求文档的相对路径（支持 .md / .txt） |
| `功能模块名` | 否 | 从文件名推断 | 输出文件名前缀，英文小写、连字符分隔 |

## 示例

```bash
# 最常用：指定需求文档和模块名
/qa-gen-cases docs/login-requirements.md login

# 只指定文档，模块名自动推断为 checkout
/qa-gen-cases docs/checkout.md

# 使用默认路径 docs/requirements.md
/qa-gen-cases
```

---

## 流程概览

```
/qa-gen-cases [文档路径] [模块名]
     |
Step 1: 参数解析（路径 + 模块名 + 输出目录）
     |
Step 2: 调用 test-case-generator Skill（6 种设计方法生成 BDD 用例）
     |
Step 3: 写入 Markdown + Handoff JSON
     |
Step 4: 调用 excel-case-export Skill（导出 .xlsx）
     |
Step 5: 输出摘要
```

---

## Step 1：参数解析

从用户输入解析：
- `source_path`：需求文档路径（默认：`docs/requirements.md`）
- `feature_name`：功能模块名（默认：从文件名去掉扩展名）
- `output_dir`：输出目录，固定为 `tests/e2e/test-cases/generated/`

确认文件存在，若不存在则提示用户检查路径，并列出 `docs/` 目录下可用文件。

## Step 2：调用 test-case-generator Skill

读取 `skills/test-case-generator/SKILL.md`，按照其中定义的流程执行：

1. 读取需求文档内容
2. 识别功能点和数据字段
3. 应用 6 种测试设计方法生成用例（等价类、边界值、判定表、状态转换、场景法、错误猜测）
4. 分配 P0 / P1 / P2 优先级（目标比例约 2:4:3）
5. 输出 Markdown 文档（含 8 个 section + Merged Test Case List）

## Step 3：写入输出文件

确保输出目录存在：
```bash
mkdir -p tests/e2e/test-cases/generated
```

写入：
- 主文档：`tests/e2e/test-cases/generated/{feature_name}-prd.md`
- Handoff JSON：`tests/e2e/test-cases/generated/playwright-handoff-{feature_name}.json`

## Step 4：调用 excel-case-export Skill 导出 Excel

读取 `skills/excel-case-export/SKILL.md`，按照其中定义的流程执行：

1. 确认 exceljs 依赖已安装（若未安装则自动运行 `npm install`）
2. 运行导出脚本：
   ```bash
   node skills/excel-case-export/scripts/generate-excel.js \
     tests/e2e/test-cases/generated/{feature_name}-prd.md \
     tests/e2e/test-cases/generated/{feature_name}-prd.xlsx
   ```
3. 确认 `.xlsx` 文件已生成

## Step 5：输出摘要

```
✅ 测试用例生成完成

📄 Markdown : tests/e2e/test-cases/generated/{feature_name}-prd.md
📊 Excel    : tests/e2e/test-cases/generated/{feature_name}-prd.xlsx
📋 用例统计：
  - 总计：XX 个
  - P0：XX 个（核心路径）
  - P1：XX 个（重要功能）
  - P2：XX 个（边缘场景）
  - 覆盖设计方法：等价类、边界值、判定表、状态转换、场景法、错误猜测

下一步：
  - 打开 Excel 文件确认用例内容
  - 运行 /qa-gen-script 生成 Playwright 脚本
  - 运行 /qa-run --suite smoke 执行 P0 冒烟测试
```

---

## 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| 需求文档不存在 | 提示用户检查路径，列出 `docs/` 目录下可用文件 |
| 需求文档为空 | 提示用户补充需求内容 |
| exceljs 未安装 | 自动运行 `npm install`，安装后重试 |
| Markdown 格式无法解析 | 输出警告，跳过问题用例，继续导出其余用例 |
| 输出目录无写权限 | 提示用户检查目录权限 |
| 磁盘写入失败 | 提示用户检查磁盘空间和目录权限 |

---

## 产物输出

```
tests/e2e/test-cases/generated/
├── {feature_name}-prd.md                     ← 测试用例文档（含 8 个设计方法 section）
├── {feature_name}-prd.xlsx                   ← Excel（用例列表 / 详细用例 / 统计 三个 Sheet）
└── playwright-handoff-{feature_name}.json    ← 结构化数据（供后续 E2E 脚本生成使用）
```
