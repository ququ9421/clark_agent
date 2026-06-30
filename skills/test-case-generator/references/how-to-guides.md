# 实现指南 — 总览（索引）

> 本文件是代码实现指南的索引，提供测试用例生成器的编程参考实现。

---

## 子文件索引

| 文件 | 内容 |
|------|------|
| `how-to-guides-typescript.md` | TypeScript 实现：story-parser、等价类生成器、Gherkin formatter、场景生成器 |
| `how-to-guides-advanced.md` | 优先级计算器、可追溯性矩阵、Python / Java 实现 |

---

## 使用场景

这些指南适用于需要：
- 将 test-case-generator 集成到 CI/CD 流水线的工程师
- 用编程方式批量生成测试用例的场景
- 理解 Gherkin 格式输出逻辑的开发者
- 在 Python 或 Java 项目中使用相同方法论的团队

---

## 快速参考

```typescript
// 最简单的用法：解析用户故事并生成等价类用例
import { parseUserStories } from './story-parser'
import { generateEquivalenceClasses } from './equivalence-generator'
import { formatAsGherkin } from './gherkin-formatter'

const stories = parseUserStories(requirementText)
const testCases = stories.flatMap(story =>
  generateEquivalenceClasses(story)
)
const output = formatAsGherkin(testCases)
```

完整实现见 `how-to-guides-typescript.md`。
