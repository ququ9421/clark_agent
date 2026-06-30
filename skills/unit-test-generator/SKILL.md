---
name: unit-test-generator
description: 为 TypeScript 源文件中新增/修改的函数生成 Vitest 单元测试。自动检测测试框架，参考已有测试风格，按等价类+边界值+分支覆盖+异常场景设计测试用例。
version: 1.0.0
allowed_tools: [Read, Write, Bash, Grep, Glob]
---

# Unit Test Generator Skill

> **通用能力**：为指定 TypeScript/JavaScript 源文件中的函数生成 Vitest/Jest 单元测试。
> 自动检测项目测试框架，参考已有测试风格，按等价类 + 边界值 + 分支覆盖 + 异常场景设计测试用例。

---

## 适用场景

- 指定源文件需要单元测试覆盖
- 已有函数被修改，需要补充或更新测试用例
- 项目希望按统一规范批量补充单元测试

## 输入

| 参数 | 必填 | 说明 |
|------|:----:|------|
| `functionList` | YES | 需要测试的函数清单（文件路径 + 函数名 + 签名 + 行号范围） |
| `testSpecFile` | NO | 项目测试规范文件路径（unit-testing.md），存在则严格遵循 |
| `existingTests` | YES | 已有测试文件路径列表，用于风格学习和去重 |
| `testStyle` | NO | 强制指定框架：`vitest` / `jest`，未指定则自动检测 |
| `projectDir` | YES | 项目根目录 |

---

## 框架自动检测

当 `testStyle` 未指定时，按以下优先级检测：

```
1. Grep("vitest", "$projectDir/package.json")    → Vitest
2. Grep("jest", "$projectDir/package.json")       → Jest
3. Glob("$projectDir/**/*.test.ts") 存在          → Vitest（TS 默认）
4. 无法检测                                       → 报错，要求用户指定 --style
```

---

## 工作流

### Step 1: 解析函数

对 `functionList` 中的每个函数：

```
Read(functionFilePath, offset=startLine, limit=endLine-startLine)

提取：
- 函数名、导出方式（export function / export const = () => / class method）
- 参数列表：名称、类型（TypeScript 类型注解）
- 返回类型（显式注解或从 return 语句推断）
- 分支路径：if/else 数量、switch cases、try/catch、early return、optional chaining (?.)
- 外部依赖：import 的模块（区分内部 vs 外部）
- 副作用：是否修改参数、是否调用外部 API、是否读写文件/数据库
```

### Step 2: 设计测试用例

对每个函数，按以下 4 种方法设计测试用例：

#### 2.1 等价类划分

将输入参数划分为等价类：

| 类型 | 等价类 |
|------|--------|
| `string` | 空字符串、正常字符串、超长字符串、特殊字符、unicode |
| `number` | 0、正数、负数、小数、NaN、Infinity、MAX_SAFE_INTEGER |
| `array` | 空数组、单元素、多元素、超大数组 |
| `object` | 空对象、正常对象、嵌套对象、null/undefined |
| `boolean` | true、false |
| `enum/union` | 每个枚举值一个用例 |
| `optional` | 提供值 vs 不提供（undefined） |

每个等价类至少选一个代表值生成测试。

#### 2.2 边界值分析

```
数值参数 → 最小值、最小值-1、最小值+1、最大值、最大值-1、最大值+1、0
数组参数 → length=0、length=1、length=maxLength
字符串参数 → length=0、length=1、length=maxLength
分页参数 → page=0、page=1、page=lastPage、page=lastPage+1
```

#### 2.3 分支路径覆盖

```
Read function body
识别所有分支：
  - if/else → 至少一个 true case + 一个 false case
  - switch → 每个 case + default
  - try/catch → 正常执行 + 抛出异常
  - early return → 触发 early return 的条件
  - 三元表达式 → 两侧各一个用例
  - optional chaining (?.) → 值存在 + 值为 null/undefined
```

#### 2.4 异常/错误场景

```
- 参数类型不匹配（如果函数有运行时校验）
- null / undefined 输入
- 空输入（空字符串、空数组、空对象）
- 异步函数：resolve + reject 场景
- 外部依赖失败：网络错误、超时、404
```

### Step 3: 生成测试代码

#### 3.1 复杂度分级策略

| 条件 | 策略 |
|------|------|
| 纯函数 + <20行 + 无外部依赖 | AST 模板直接生成（快速、确定性高） |
| 有外部依赖或 >20行 | LLM 生成（理解上下文、处理 mock） |
| 类方法或复杂状态 | LLM 生成 + 额外的 setup/teardown |

#### 3.2 代码结构（Vitest）

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 外部依赖（如需）
vi.mock('axios');
vi.mock('../services/database');

import { targetFunction } from '../targetModule';

describe('targetFunction', () => {
  // Setup (如需)
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Happy path
  it('should return expected result with valid input', () => {
    const result = targetFunction(validInput);
    expect(result).toEqual(expectedOutput);
  });

  // Edge cases
  it('should handle empty input gracefully', () => {
    const result = targetFunction([]);
    expect(result).toEqual([]);
  });

  // Error cases
  it('should throw TypeError when input is null', () => {
    expect(() => targetFunction(null)).toThrow(TypeError);
  });

  // Async
  it('should resolve with data on success', async () => {
    mockApi.get.mockResolvedValue({ data: mockData });
    const result = await targetFunction(id);
    expect(result).toEqual(mockData);
  });
});
```

#### 3.3 风格适配

生成代码前，从 `existingTests` 中提取风格特征并严格遵循：

```
从已有测试学习：
- describe 嵌套层级（1层 vs 多层）
- test / it 用词偏好
- 断言风格：toBe vs toEqual vs toStrictEqual 的使用场景
- Mock 初始化位置：顶层 vs beforeEach
- 变量命名：camelCase vs snake_case
- 注释风格：有无、位置、语言（中/英）
- import 排序：第三方优先 vs 本地优先
```

### Step 4: 输出

#### 4.1 测试文件放置

```
检测项目已有测试的目录结构：

If 存在 __tests__/ 目录:
  → 在对应的 __tests__/ 下创建测试文件
  → 文件名: {sourceName}.test.ts

If 测试文件与源文件同级:
  → 同级创建 {sourceName}.test.ts

默认: 同级创建 .test.ts
```

#### 4.2 纯函数 AST 模板（<20行无依赖）

对于简单纯函数，使用模板快速生成：

```
Input: function add(a: number, b: number): number { return a + b; }

Template:
  describe('{functionName}', () => {
    // 从参数类型自动推导等价类
    it('should return {expectedType} with normal inputs', () => { ... });
    it('should handle zero values', () => { ... });
    it('should handle negative values', () => { ... });
    // 从返回类型推导断言
  });
```

#### 4.3 复杂函数 LLM 生成

对于复杂函数（有外部依赖、>20行、涉及状态管理）：

```
读取完整函数体 + 上下文（同文件其他函数、类型定义）
理解业务逻辑后生成测试
包含适当的 Mock setup
处理异步、回调、事件等模式
```

---

## Mock 策略

| 依赖类型 | Mock 方式 (Vitest/Jest) |
|----------|------------------------|
| HTTP 请求 | MSW (`msw/node`) 或 `vi.mock('axios')` |
| 数据库 | `vi.mock('../db')` + 返回 fixture 数据 |
| 文件系统 | `memfs` 或 `vi.mock('fs')` |
| 环境变量 | `vi.stubEnv('KEY', 'value')` |
| 时间 | `vi.useFakeTimers()` |
| 随机数 | `vi.spyOn(Math, 'random').mockReturnValue(0.5)` |
| 内部函数 | **不 Mock** — 测试真实行为 |
| 第三方库 | `vi.mock('library')` |

---

## 质量检查

生成完成后自动执行以下检查：

### 检查清单

- [ ] 每个函数至少 3 个测试用例（happy path + edge + error）
- [ ] 无 hardcoded 魔术数字（使用常量或变量名说明含义）
- [ ] 每个 test 只验证一个行为（单一职责）
- [ ] test 描述使用自然语言，清晰表达预期行为
- [ ] Mock 只用于外部依赖，未 mock 内部函数
- [ ] 异步测试正确使用 async/await
- [ ] 无遗漏的 cleanup（clearMocks、restore）
- [ ] Import 路径正确（相对路径 vs alias）

### 常见反模式（必须避免）

```typescript
// BAD: 测试实现细节而非行为
expect(internalHelper).toHaveBeenCalledWith(x);

// GOOD: 测试公开行为
expect(result).toEqual(expectedOutput);

// BAD: 多个不相关断言混在一个 it 块
it('should work', () => {
  expect(fn(1)).toBe(2);
  expect(fn('a')).toBe('b');
});

// GOOD: 每个 test 一个关注点
it('should double the number', () => { expect(fn(1)).toBe(2); });
it('should uppercase the string', () => { expect(fn('a')).toBe('A'); });

// BAD: Mock 内部函数
vi.mock('../utils/internal');

// GOOD: Mock 外部依赖
vi.mock('axios');
```

---

## 输出格式

生成的测试文件，附带头部元数据注释：

```typescript
// Auto-generated unit tests
// Source: src/utils/calculate.ts
// Functions: calculateTotal, calculateDiscount, formatCurrency
// Style: vitest
// Generated: {date}
```
