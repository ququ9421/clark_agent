# 最佳实践、反模式与调试技巧

---

## 1. 11 条最佳实践

### BP-01: 测试数据唯一性
始终在测试数据中使用时间戳或 UUID，防止并行运行时数据冲突。

```json
// ✅ 正确
{ "value": "Test-Task-${Date.now()}", "dataType": "text.content", "dataVariant": "valid" }

// ❌ 错误
{ "value": "Test Task", "dataType": "text.content", "dataVariant": "valid" }
// 多个 worker 并行时"Test Task"冲突
```

### BP-02: 断言业务语义，而非存在性
断言必须验证业务结果，不能只检查元素是否可见。

```json
// ✅ 正确：验证具体内容
{ "type": "text", "target": "成功提示", "expected": "任务已创建" }

// ❌ 错误：只检查存在性
{ "type": "visible", "target": "提示信息" }
// 不知道显示了什么内容
```

### BP-03: 前置条件完全可执行
前置条件中不允许出现无法自动执行的描述。

```
// ✅ 正确
preconditions: ["通过 UI 创建任务 'TestEdit-{timestamp}'，记录其 URL"]

// ❌ 错误
preconditions: ["数据库中存在一条任务数据"]
// 无法通过 UI 验证或自动化执行
```

### BP-04: 每个 entry 的 assertions 数量
每个 handoff entry 至少 2 个 assertions：一个验证主要结果，一个验证副作用。

```json
// ✅ 正确：主结果 + 副作用
"assertions": [
  { "type": "url", "expected": "/dashboard" },           // 主结果：导航成功
  { "type": "visible", "target": "用户名称", "i18nKey": "nav.userName" }  // 副作用：UI 状态
]

// ❌ 错误：只有一个断言，未覆盖完整预期
"assertions": [
  { "type": "url", "expected": "/dashboard" }
]
```

### BP-05: 善用 dataType 让数据有语义
对有语义的输入字段，使用 `dataType` + `dataVariant` 而非硬编码值。

```json
// ✅ 正确：语义化，script-generator 可生成适合场景的测试数据
{ "name": "密码", "dataType": "account.password", "dataVariant": "strong", "value": "placeholder" }

// ❌ 可接受但不够语义化
{ "name": "密码", "value": "T3st@Password2026" }
```

### BP-06: timeout 只在必要时设置
不要对所有 entry 设置固定 timeout；让自动检测规则处理。

```json
// ✅ 正确：AI 任务自动检测到关键词，设 timeout: 600000
setup: [{ "action": "等待 AI 生成报告", "scope": "worker" }]

// ❌ 错误：手动给所有 entry 设置 600000，掩盖了真正的慢 test
"timeout": 600000  // 不含 AI 关键词的普通 test
```

### BP-07: worker scope 只给真正共享的只读数据
错误使用 `scope: "worker"` 会导致数据状态污染。

```json
// ✅ 正确：多个只读测试共享同一份 AI 生成报告
{ "scope": "worker", "action": "AI 生成分析报告" }

// ❌ 错误：需要删除操作的数据用了 worker scope
// 第一个 test 删除了数据，后续 worker 内的 test 都失败
{ "scope": "worker", "action": "创建待删除的任务" }
```

### BP-08: source 字段精确标记
`source` 字段影响 TC ID 和文件命名，必须准确。

| 来源 | source 值 |
|------|-----------|
| PRD / 需求文档 | `"prd"` |
| CDP 探查 | `"cdp"` |
| Linear Issue | `"issue"` |
| Git Branch 差异 | `"branch"` |

### BP-09: i18nKey 只在有消息文件时填写
不要猜测 i18nKey，只在能从消息文件反向查找到时填写。

### BP-10: blocked 用例必须有说明
`scenarioType: "blocked"` 的用例必须在 preconditions 中说明缺失什么信息。

```json
// ✅ 正确
{
  "scenarioType": "blocked",
  "title": "[BLOCKED] 密码重置流程",
  "preconditions": ["[缺失] 设计稿未提供密码重置页面的 UI 元素；需求文档第 3.2 节仅描述了 API，无前端交互"]
}
```

### BP-11: 每次生成后运行 Phase I 去重
生成后必须执行 Phase A 覆盖索引对比，确保输出真正的增量，不产生冗余用例。

---

## 2. 7 种反模式

### AP-01: 测试用例有执行顺序依赖
```
// ❌ 错误
preconditions: ["依赖 TC-PRD-LOGIN-001 先执行"]
// 测试套件不保证执行顺序，并行运行时必然失败
```

### AP-02: 使用占位符而非具体值
```
// ❌ 错误
value: "有效邮箱"
// 没有具体数据，script-generator 无法生成可执行脚本
```

### AP-03: 一个 entry 同时测试多个关注点
```
// ❌ 错误：一个用例同时测试登录 + 创建任务 + 注销
// 失败时无法定位是哪个环节出问题
```

### AP-04: 在 setup 中假设数据已存在
```
// ❌ 错误
preconditions: ["系统中有一条任务数据"]
// 应改为："通过 UI 创建任务 'TestRead-{timestamp}'"
```

### AP-05: teardown 为空但测试创建了数据
```
// ❌ 错误：创建了任务但 teardown: []
// 数据积累导致列表测试不稳定
// 应在 teardown 中删除创建的数据
```

### AP-06: assertions 只验证 URL 不验证内容
```
// ❌ 错误：只验证跳转，不验证页面内容
assertions: [{ "type": "url", "expected": "/dashboard" }]
// 页面可能是空白或错误页但 URL 正确
```

### AP-07: 所有用例都标 P0
```
// ❌ 错误：P0 > 20% 的用例集
// P0 的价值在于"快速冒烟"，如果所有用例都是 P0，冒烟测试失去意义
```

---

## 3. 8 条调试技巧

### DT-01: JSON 验证失败时的定位
```bash
# 在项目目录执行，快速定位无效 JSON
node -e "require('./tests/e2e/test-cases/generated/playwright-handoff-xxx.json')"
```

### DT-02: 用例数量不匹配时的对比
```bash
# 统计 MD 中的 TC 数量
grep -c "^\*\*TC-" tests/e2e/test-cases/generated/xxx.md

# 统计 JSON 中的 entry 数量
node -e "const j=require('./tests/e2e/test-cases/generated/playwright-handoff-xxx.json'); console.log(j.length)"
```

### DT-03: 缺少断言的 entry 查找
```bash
node -e "
const j = require('./tests/e2e/test-cases/generated/playwright-handoff-xxx.json');
j.filter(e => !e.assertions || e.assertions.length === 0)
 .forEach(e => console.log('Missing assertions:', e.id));
"
```

### DT-04: 优先级比例检查
生成完成后，统计 P0/P1/P2 数量，验证是否符合 15-20% / 40-50% / 30-40% 目标比例（参考 `references/priority-framework.md`）。

### DT-05: 重复用例检查
Phase I 去重后，若仍有疑似重复，比较两个 entry 的 `uiElements[].action + assertions[].expected` 组合是否完全相同。

### DT-06: locatorHint 可疑时的处理
若 locatorHint 来自设计稿推断（非 CDP），在 uiElements 中标注：
```json
"locatorHint": "getByRole('button', { name: /提交/i }) /* 推断，需 CDP 验证 */"
```

### DT-07: blocked 用例过多的处理
超过 20% 的 entry 为 `scenarioType: "blocked"` 时，说明需求/设计文档严重不全，应停止生成并向用户反馈缺失信息清单，请其补充后再重新生成。

### DT-08: i18nKey 查找失败时的处理
若 i18nKey 查找返回空，检查：
1. `$i18nMessagesDir` 环境变量是否设置
2. 消息文件路径是否正确
3. 文本是否经过变量插值（如 `Hello, {name}` → 需要部分匹配）
