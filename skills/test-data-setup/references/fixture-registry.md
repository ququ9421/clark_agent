# Fixture Registry — 校验规则与映射规范

> **权威来源**：本文件定义 Fixture Registry 的校验规则。
> Registry 数据来自项目的 `test-data.config.json`，不在此处硬编码。
> 被以下组件引用：test-case-generator、playwright-script-generator、e2e-orchestrator。

---

## 1. Registry 数据来源

Fixture Registry 的唯一数据来源是项目的 `test-data.config.json` 中的 `fixtures` 字段。

```
test-data.config.json → fixtures → { fixtureId: { name, env, timeout, description, ... } }
```

每个 key 是一个 `fixtureId`，value 中的 `name` 是对应的 TypeScript fixture 变量名。

### 映射示例（以下仅为示例，实际以项目 config 为准）

| fixtureId（config key） | fixture name（TypeScript） | Env var | Timeout |
|---|---|---|---|
| `basic-record` | `basicRecordUrl` | `E2E_BASIC_RECORD_URL` | 60_000 |
| `file-record` | `fileRecordUrl` | `E2E_FILE_RECORD_URL` | 120_000 |
| `share` | `shareUrl` | `E2E_SHARE_URL` | 120_000 |

> 上表为 test-data-setup SKILL.md 中的默认示例。各项目有自己的 fixture 集合，
> 以实际 `test-data.config.json` 为准。

---

## 2. 校验规则

### 2.1 生成时校验（test-data-setup Skill）

在生成 data.setup.ts 和 fixtures.ts 时：

```
✅ 每个 fixture 必须有 name、env、prompt、waitPattern、timeout
✅ name 必须是合法的 camelCase JavaScript 标识符
✅ env 必须是 SCREAMING_SNAKE_CASE 格式
✅ timeout 必须 > 0
✅ type === "share" 时必须有 shareDialog 配置
```

### 2.2 用例生成时校验（test-case-generator → handoff）

当 test-case-generator 在 handoff JSON 中设置 `setup[].type = "fixture"` 时：

```
✅ fixtureId 必须存在于 test-data.config.json 的 fixtures keys 中
❌ 未知 fixtureId → 报错，阻止生成 handoff
```

handoff 格式：

```json
{
  "setup": [{
    "type": "fixture",
    "fixtureId": "basic-record"
  }]
}
```

### 2.3 脚本生成时校验（playwright-script-generator）

将 `fixtureId` 映射为 fixture 变量名，用于 test 函数的参数解构：

```
fixtureId "basic-record" → fixture name "basicRecordUrl"
→ test('...', async ({ page, basicRecordUrl }) => {
    await page.goto(basicRecordUrl)
  })
```

```
✅ fixtureId 存在于 config → 映射成功，生成 spec
❌ fixtureId 不存在 → ERROR at generation time，不生成 broken spec
```

---

## 3. 新增 Fixture 检查清单

当需要新增一种前置数据类型时：

1. **检查现有 Registry** — 是否有已存在的 fixtureId 能覆盖需求？
2. **如果没有**，在 `test-data.config.json` 中添加新条目
3. 重新调用 test-data-setup Skill → 自动重新生成 data.setup.ts + fixtures.ts
4. test-case-generator、playwright-script-generator 自动获得新 fixtureId
5. 验证：`npx playwright test --list` 应显示 data-setup test

---

## 4. fixtureId 命名规范

| 规则 | 正确示例 | 错误示例 |
|------|---------|---------|
| 使用 kebab-case | `basic-record`, `file-record` | `basicRecord`, `file_record` |
| 描述数据类型，而非操作 | `invoice-record`（not `create-invoice`） | `createInvoice` |
| 避免项目名前缀 | `share`（not `myapp-share`） | `myappShare` |
| 保持简短但有意义 | `share`（not `share-url-with-access-token`） | `shareUrlWithAccessToken` |

---

## 5. 数据最大化复用原则

设计 fixture 时要考虑**最大化复用**——一份前置数据应尽量服务于多个测试场景：

| 一份数据 | 可覆盖的测试场景 |
|---------|----------------|
| `basic-record` | 查看详情、编辑、删除、列表搜索 |
| `file-record` | 文件预览、下载、列表展示 |
| `share` | 分享页查看、权限验证、链接失效场景 |

**反模式**：为每个测试单独创建一份数据 → 浪费时间，增加服务器负载，串行化本可并行的测试。

**正确做法**：查询、下载、查看、修改、删除等操作尽量共享同一份前置数据。
