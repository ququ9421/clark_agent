# 实现指南 — TypeScript

> 测试用例生成逻辑的 TypeScript 参考实现。

---

## 1. story-parser.ts — 用户故事解析器

```typescript
import { UserStory, AcceptanceCriterion } from './types'

export function parseUserStories(text: string): UserStory[] {
  const storyPattern = /作为(.+?)，我希望(.+?)，以便(.+?)(?:\n|$)/g
  const stories: UserStory[] = []
  let match: RegExpExecArray | null

  while ((match = storyPattern.exec(text)) !== null) {
    const [, role, action, value] = match
    stories.push({
      id: generateStoryId(action),
      role: role.trim(),
      action: action.trim(),
      value: value.trim(),
      acceptanceCriteria: extractAcceptanceCriteria(text, action.trim()),
    })
  }

  return stories
}

function extractAcceptanceCriteria(text: string, context: string): AcceptanceCriterion[] {
  const acPattern = /AC-(\d+):\s*(.+)/g
  const criteria: AcceptanceCriterion[] = []
  let match: RegExpExecArray | null

  while ((match = acPattern.exec(text)) !== null) {
    criteria.push({
      id: `AC-${match[1]}`,
      description: match[2].trim(),
    })
  }

  return criteria
}

function generateStoryId(action: string): string {
  return action
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .slice(0, 30)
}
```

---

## 2. equivalence-generator.ts — 等价类生成器

```typescript
import { UserStory, TestCase, UIElement } from './types'

interface EquivalenceClass {
  type: 'valid' | 'invalid'
  description: string
  testValue: string
  dataType?: string
  dataVariant?: string
}

export function generateEquivalenceClasses(story: UserStory): TestCase[] {
  const fields = extractFields(story)
  const testCases: TestCase[] = []

  // 有效类：一个用例覆盖所有有效类
  const validInputs = fields.map(f => buildValidInput(f))
  testCases.push(buildPositiveCase(story, validInputs))

  // 无效类：每个字段的每个无效类单独一个用例
  for (const field of fields) {
    const invalidClasses = buildInvalidClasses(field)
    for (const ec of invalidClasses) {
      testCases.push(buildNegativeCase(story, field, ec))
    }
  }

  return testCases
}

function buildValidInput(field: FieldDefinition): UIElement {
  const dataTypeMap: Record<string, { dataType: string; value: string }> = {
    email:    { dataType: 'contact.email',    value: 'test@example.com' },
    password: { dataType: 'account.password', value: 'Test@12345' },
    mobile:   { dataType: 'contact.mobile',   value: '13800138000' },
    name:     { dataType: 'identity.name',    value: '张三' },
  }

  const mapped = dataTypeMap[field.semanticType] ?? { dataType: undefined, value: field.defaultValue }
  return {
    role: field.role,
    name: field.name,
    action: 'fill',
    value: mapped.value,
    dataType: mapped.dataType,
    dataVariant: mapped.dataType ? 'valid' : undefined,
    locatorHint: `getByRole('${field.role}', { name: /${field.name}/i })`,
  }
}

function buildInvalidClasses(field: FieldDefinition): EquivalenceClass[] {
  const classes: EquivalenceClass[] = []

  if (field.required) {
    classes.push({
      type: 'invalid', description: '空值',
      testValue: '', dataType: field.dataType, dataVariant: 'invalid',
    })
  }

  if (field.maxLength) {
    classes.push({
      type: 'invalid', description: `超过最大长度 ${field.maxLength}`,
      testValue: 'x'.repeat(field.maxLength + 1), dataVariant: 'oversized',
    })
  }

  if (field.semanticType === 'email') {
    classes.push({
      type: 'invalid', description: '无效邮箱格式（缺少@）',
      testValue: 'invalidemail.com', dataType: 'contact.email', dataVariant: 'invalid',
    })
  }

  return classes
}
```

---

## 3. gherkin-formatter.ts — Gherkin BDD 格式输出

```typescript
import { TestCase } from './types'

export function formatAsGherkin(testCases: TestCase[]): string {
  const features = groupByFeature(testCases)
  const lines: string[] = []

  for (const [feature, cases] of Object.entries(features)) {
    lines.push(`Feature: ${feature}`)
    lines.push('')

    for (const tc of cases) {
      lines.push(`  Scenario: ${tc.title}`)
      for (const pre of tc.preconditions) {
        lines.push(`    Given ${pre}`)
      }
      for (const [i, step] of tc.steps.entries()) {
        const keyword = i === 0 ? 'When' : 'And'
        lines.push(`    ${keyword} ${step}`)
      }
      for (const [i, assertion] of tc.assertions.entries()) {
        const keyword = i === 0 ? 'Then' : 'And'
        lines.push(`    ${keyword} ${formatAssertion(assertion)}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

function formatAssertion(assertion: { type: string; target?: string; expected?: string }): string {
  switch (assertion.type) {
    case 'url':     return `URL is "${assertion.expected}"`
    case 'visible': return `"${assertion.target}" is visible`
    case 'text':    return `"${assertion.target}" shows "${assertion.expected}"`
    case 'count':   return `"${assertion.target}" count is ${assertion.expected}`
    default:        return `${assertion.type}: ${assertion.expected}`
  }
}
```

---

## 4. scenario-generator.ts — 场景法生成器

```typescript
import { UserStory, TestCase } from './types'

export function generateScenarios(story: UserStory): TestCase[] {
  return [
    buildHappyPath(story),
    buildAlternativePath(story),
    buildUnhappyPath(story),
  ].filter(Boolean) as TestCase[]
}

function buildHappyPath(story: UserStory): TestCase {
  return {
    id: `TC-PRD-${story.feature}-H001`,
    storyId: story.id,
    title: `${story.action}成功（Happy Path）`,
    source: 'prd',
    priority: 'P0',
    scenarioType: 'positive',
    tags: ['@P0', '@smoke', '@regression', '@full'],
    criterionId: story.acceptanceCriteria[0]?.id ?? null,
    preconditions: buildPreconditions(story),
    setup: buildSetup(story),
    uiElements: buildUIElements(story, 'valid'),
    assertions: buildAssertions(story, 'success'),
    teardown: buildTeardown(story),
    timeout: null,
  }
}

function buildUnhappyPath(story: UserStory): TestCase | null {
  if (!story.hasInputFields) return null

  return {
    id: `TC-PRD-${story.feature}-H002`,
    storyId: story.id,
    title: `${story.action}失败（无效输入）`,
    source: 'prd',
    priority: 'P1',
    scenarioType: 'negative',
    tags: ['@P1', '@regression', '@full'],
    criterionId: null,
    preconditions: [`当前在 ${story.entryPage}`],
    setup: [{ type: 'navigate', action: `导航到 ${story.entryPage}`, pomMethod: 'goto',
              data: { url: story.entryUrl } }],
    uiElements: buildUIElements(story, 'invalid'),
    assertions: buildAssertions(story, 'error'),
    teardown: [],
    timeout: null,
  }
}
```

---

## 5. types.ts — 接口定义

见 `references/project-setup.md`。
