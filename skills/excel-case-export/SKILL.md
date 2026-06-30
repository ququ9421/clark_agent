# Skill: excel-case-export

## 用途

将 Markdown 格式的测试用例文档导出为 Excel（.xlsx）文件，方便测试管理和团队协作。

## 触发时机

- 用户运行 `/qa-gen-cases` 后自动调用
- 用户明确要求"导出 Excel"或"生成测试用例表格"

## 输入

| 参数 | 类型 | 说明 |
|------|------|------|
| `md_path` | 文件路径 | 测试用例 Markdown 文件路径 |
| `output_path` | 文件路径 | 输出 Excel 路径，默认与 md 同目录，扩展名改为 .xlsx |

## 执行步骤

### Step 1：确认依赖已安装

检查 `node_modules/exceljs` 是否存在：
```bash
node -e "require('exceljs')" 2>/dev/null || npm install
```

### Step 2：运行导出脚本

```bash
node skills/excel-case-export/scripts/generate-excel.js <md_path> <output_path>
```

### Step 3：确认输出

脚本执行完毕后，确认 `.xlsx` 文件已生成，向用户报告：
- 输出文件路径
- 导出用例数量
- 各优先级用例数

## 输出

| 文件 | 说明 |
|------|------|
| `{slug}-{source}.xlsx` | Excel 文件，包含"用例列表"和"详细用例"两个 Sheet |

## Excel 结构

**Sheet 1 — 用例列表（汇总）**

| 列名 | 内容 |
|------|------|
| 用例ID | TC-001 |
| 标题 | 用例标题 |
| 设计方法 | 等价类/场景法/… |
| 优先级 | P0 / P1 / P2 |
| 前置条件 | 简要描述 |
| 预期结果 | 简要描述 |

**Sheet 2 — 详细用例**

每个用例占若干行，包含完整步骤和断言说明。

## 注意事项

- 若 Markdown 无法解析（格式异常），输出解析警告，跳过该用例，继续处理其余用例
- 输出目录不存在时自动创建
