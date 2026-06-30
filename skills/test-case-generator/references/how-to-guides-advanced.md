# 实现指南 — 高级用法

---

## 1. 优先级计算器

```typescript
import { TestCase } from './types'

interface PriorityMetrics {
  p0: number; p1: number; p2: number; total: number
  p0Ratio: number; p1Ratio: number; p2Ratio: number
  isValid: boolean
  warnings: string[]
}

export function calculatePriorityMetrics(cases: TestCase[]): PriorityMetrics {
  const counts = { p0: 0, p1: 0, p2: 0 }
  for (const tc of cases) {
    if (tc.priority === 'P0') counts.p0++
    else if (tc.priority === 'P1') counts.p1++
    else counts.p2++
  }

  const total = cases.length
  const p0Ratio = counts.p0 / total
  const p1Ratio = counts.p1 / total
  const p2Ratio = counts.p2 / total

  const warnings: string[] = []
  if (p0Ratio > 0.20) warnings.push(`P0 比例 ${(p0Ratio * 100).toFixed(1)}% 超过 20%：检查是否有非核心路径误标为 P0`)
  if (p0Ratio < 0.15) warnings.push(`P0 比例 ${(p0Ratio * 100).toFixed(1)}% 低于 15%：检查核心路径是否覆盖`)
  if (p1Ratio < 0.40) warnings.push(`P1 比例 ${(p1Ratio * 100).toFixed(1)}% 低于 40%：检查错误提示和边界值用例`)
  if (p2Ratio < 0.30) warnings.push(`P2 比例 ${(p2Ratio * 100).toFixed(1)}% 低于 30%：检查边缘场景覆盖`)

  return { ...counts, total, p0Ratio, p1Ratio, p2Ratio,
           isValid: warnings.length === 0, warnings }
}

// 使用示例
const metrics = calculatePriorityMetrics(generatedCases)
if (!metrics.isValid) {
  console.warn('优先级比例异常：')
  metrics.warnings.forEach(w => console.warn(' -', w))
}
```

---

## 2. 可追溯性矩阵构建器

将测试用例与验收标准（AC）建立映射，验证需求覆盖率。

```typescript
interface TraceabilityMatrix {
  requirements: Map<string, string>    // criterionId → AC 描述
  testCases: Map<string, string[]>     // criterionId → 覆盖的 TC IDs
  coverage: { covered: string[]; uncovered: string[] }
}

export function buildTraceabilityMatrix(
  cases: TestCase[],
  criteria: AcceptanceCriterion[]
): TraceabilityMatrix {
  const requirements = new Map(criteria.map(ac => [ac.id, ac.description]))
  const testCases = new Map<string, string[]>()

  for (const tc of cases) {
    if (tc.criterionId) {
      const existing = testCases.get(tc.criterionId) ?? []
      testCases.set(tc.criterionId, [...existing, tc.id])
    }
  }

  const covered = criteria.filter(ac => testCases.has(ac.id)).map(ac => ac.id)
  const uncovered = criteria.filter(ac => !testCases.has(ac.id)).map(ac => ac.id)

  return { requirements, testCases, coverage: { covered, uncovered } }
}

// 输出 Markdown 表格
export function formatMatrixAsMarkdown(matrix: TraceabilityMatrix): string {
  const lines = ['| 验收标准 | 描述 | 覆盖用例 | 状态 |', '|---------|------|---------|------|']

  for (const [id, desc] of matrix.requirements.entries()) {
    const tcs = matrix.testCases.get(id) ?? []
    const status = tcs.length > 0 ? '✅' : '❌'
    lines.push(`| ${id} | ${desc} | ${tcs.join(', ') || '—'} | ${status} |`)
  }

  const { covered, uncovered } = matrix.coverage
  lines.push('')
  lines.push(`**覆盖率**：${covered.length}/${covered.length + uncovered.length}`)
  if (uncovered.length > 0) {
    lines.push(`**未覆盖**：${uncovered.join(', ')}`)
  }

  return lines.join('\n')
}
```

---

## 3. Python 实现示例

适用于 Python 项目集成或数据分析场景。

```python
import json
import re
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class HandoffEntry:
    id: str
    storyId: str
    title: str
    source: str
    priority: str
    criterionId: Optional[str] = None
    scenarioType: str = 'positive'
    tags: list[str] = field(default_factory=list)
    preconditions: list[str] = field(default_factory=list)
    setup: list[dict] = field(default_factory=list)
    uiElements: list[dict] = field(default_factory=list)
    assertions: list[dict] = field(default_factory=list)
    teardown: list[dict] = field(default_factory=list)
    timeout: Optional[int] = None

def parse_markdown_cases(md_content: str) -> list[HandoffEntry]:
    """从 Markdown 测试用例文档解析 HandoffEntry 列表"""
    entries = []
    tc_pattern = re.compile(
        r'\*\*(TC-[A-Z]+-[A-Z]+-\d+)\*\*:\s*(.+?)\n'
        r'.*?- \*\*优先级:\*\*\s*(P[012])\n'
        r'.*?- \*\*前置条件:\*\*\s*(.+?)\n'
        r'.*?- \*\*操作步骤:\*\*\s*(.+?)\n'
        r'.*?- \*\*预期结果:\*\*\s*(.+?)(?:\n|$)',
        re.DOTALL
    )

    for match in tc_pattern.finditer(md_content):
        tc_id, title, priority, precond, steps, expected = match.groups()
        entries.append(HandoffEntry(
            id=tc_id,
            storyId=tc_id.split('-')[2].lower(),
            title=title.strip(),
            source=tc_id.split('-')[1].lower(),
            priority=priority,
            preconditions=[precond.strip()],
        ))

    return entries

def validate_handoff(entries: list[HandoffEntry]) -> list[str]:
    """验证 handoff 列表的完整性，返回错误列表"""
    errors = []
    for entry in entries:
        if not entry.assertions:
            errors.append(f"{entry.id}: assertions 为空")
        if not entry.title:
            errors.append(f"{entry.id}: title 为空")
    return errors
```

---

## 4. Java 实现示例

```java
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import java.util.regex.*;

public class HandoffGenerator {

    record HandoffEntry(
        String id, String storyId, String title, String source,
        String priority, String criterionId, String scenarioType,
        List<String> tags, List<String> preconditions,
        List<Map<String, Object>> setup,
        List<Map<String, Object>> uiElements,
        List<Map<String, Object>> assertions,
        List<Map<String, Object>> teardown,
        Integer timeout
    ) {}

    public List<HandoffEntry> parseFromMarkdown(String markdown) {
        List<HandoffEntry> entries = new ArrayList<>();
        Pattern pattern = Pattern.compile(
            "\\*\\*(TC-[A-Z]+-[A-Z]+-\\d+)\\*\\*:\\s*(.+?)\\n" +
            ".*?- \\*\\*优先级:\\*\\*\\s*(P[012])\\n",
            Pattern.DOTALL
        );

        Matcher matcher = pattern.matcher(markdown);
        while (matcher.find()) {
            String id = matcher.group(1);
            String title = matcher.group(2).trim();
            String priority = matcher.group(3);
            String source = id.split("-")[1].toLowerCase();

            String scenarioType = priority.equals("P0") ? "positive" : "negative";
            List<String> tags = buildTags(priority, scenarioType);

            entries.add(new HandoffEntry(
                id, source + "-" + id.split("-")[2].toLowerCase(),
                title, source, priority, null, scenarioType,
                tags, new ArrayList<>(), new ArrayList<>(),
                new ArrayList<>(), new ArrayList<>(), new ArrayList<>(), null
            ));
        }

        return entries;
    }

    private List<String> buildTags(String priority, String scenarioType) {
        List<String> tags = new ArrayList<>();
        tags.add("@" + priority);
        tags.add("@full");
        if (!priority.equals("P2")) tags.add("@regression");
        if (priority.equals("P0") && "positive".equals(scenarioType)) tags.add("@smoke");
        return tags;
    }
}
```
