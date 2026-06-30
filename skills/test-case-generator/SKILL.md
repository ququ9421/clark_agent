---
name: test-case-generator
description: 从需求文档、用户故事、设计稿（Figma/Pencil MCP）或 CDP 页面探索结果，使用 6 种测试设计方法生成结构化 BDD 测试用例，并输出强制的 Playwright Handoff JSON
version: 1.3.0
allowed_tools: [Read, Write, Bash, Grep, Glob]
---

# Skill: test-case-generator

## 用途

从需求文档、用户故事或功能描述，使用 6 种测试设计方法生成结构化的 BDD 测试用例，
输出 Markdown 文档 + 强制 Playwright Handoff JSON（供后续脚本生成使用）。

## 输出语言

所有测试用例内容（标题、前置条件、步骤、预期结果、测试数据）**必须使用简体中文**。
仅以下内容保留英文：用例 ID（TC-xxx-xxx-001）、优先级标签（P0/P1/P2）、代码引用（URL、CSS 选择器、API 路径）。

---

## 支持的输入源

在开始生成之前，先识别用户提供的输入类型：

| 输入类型 | 识别方式 | 处理方式 |
|---------|---------|---------|
| 需求文档（PRD/Markdown） | `.md` / `.txt` 文件路径，或包含标题/列表/表格的粘贴内容 | 解析 Markdown 结构，提取功能点和验收标准 |
| 用户故事文本 | "作为...我希望...以便..." 格式 | 直接解析每条故事 |
| 纯文本 / Word 需求 | 编号列表、"应/须/需"规范语句、粘贴散文 | **先转换为用户故事**，再解析 |
| Figma 设计稿（MCP） | 用户提供 Figma URL 或节点 ID，且 Figma MCP 工具可用 | 调用 Figma MCP 工具提取组件、文本、交互标注 |
| Pencil 原型（MCP） | 用户提供 Pencil 项目文件路径，且 Pencil MCP 工具可用 | 调用 Pencil MCP 工具提取页面和组件 |
| **MD + 设计稿（对齐模式）** | 同时提供 `.md` 需求文档 **和** Figma URL / Pencil 文件 | **先对齐，再生成**（见下方 Alignment Mode） |
| CDP baseline JSON | `cdp-baseline-{slug}.json` 或用户指定 URL 且 Chrome 正在运行 | 从页面元素和交互推断用户故事；有 baseline 直接复用，否则先调用 cdp-explorer |
| Linear Issue | Issue 编号或文本 | 从 Issue 描述提取功能点 |
| 混合输入 | 以上任意组合（设计稿除外） | 分别提取后合并去重 |

---

## 多源输入处理规则

### Alignment Mode（需求 + 设计稿对齐，优先级最高）

当**同时**提供 Markdown 需求文档和 Figma/Pencil 设计文件时，**必须先对齐再生成**，不可直接跳到设计方法阶段。

**Step 1 — 分别提取**

| 来源 | 提取内容 |
|------|---------|
| 需求文档 | 功能点、验收标准、业务规则、数据字段 |
| 设计工具 | 界面元素名称、占位符、状态变体（Normal/Hover/Disabled/Error）、交互流程 |

**Step 2 — 交叉对比（Alignment Check）**

| 情况 | 处理方式 |
|------|---------|
| 需求文档有，设计稿无 | 标记为"设计缺失"，用例加注 `⚠️ 设计稿未体现` |
| 设计稿有，需求文档无 | 标记为"需求未覆盖"，询问用户是否生成对应用例 |
| 两者一致 | 正常生成，优先使用设计稿的真实元素名称和 locatorHint |
| 两者存在描述差异 | 以需求文档为准，在用例注释中标注设计差异 |

**Step 3 — 生成对齐后的用例**
- `uiElements[].name` 使用设计工具中提取的真实 UI 元素名称
- `uiElements[].locatorHint` 优先使用设计工具标识符（Figma layer name → aria-label 推断）
- 状态变体直接转化为边界值和错误场景用例

---

### Figma MCP 提取流程

1. **调用 Figma MCP 工具**获取设计数据（组件树、文本、交互标注）
2. **提取关键信息**：

   | 设计元素 | 映射到用例字段 |
   |---------|--------------|
   | 页面/Frame 标题 | 功能域 `{FEATURE}` |
   | 按钮/链接文本 | `uiElements[].name`、`locatorHint` |
   | 输入框占位符 / Label | 表单字段识别、等价类输入值 |
   | 状态变体（Disabled/Error/Empty） | 边界值分析 + 错误猜测用例 |
   | 条件显示组件（Hidden layer） | 条件渲染场景、状态转换用例 |

3. **降级处理**：Figma MCP 工具不可用 → 要求用户提供截图或元素清单，或切换为纯文档模式

---

### Pencil MCP 提取流程

1. **调用 Pencil MCP 工具**获取页面列表和组件数据
2. **提取规则**：与 Figma 相同（页面→功能域、组件→uiElements、状态→场景用例）
3. **降级处理**：Pencil MCP 不可用 → 要求用户导出为 PNG/HTML 后手动描述元素

---

### Chrome CDP 实时页面模式

当用户提供目标 URL 且 Chrome 正在运行（无需求文档）时：

1. **检查是否已有 baseline**：Glob `tests/e2e/test-cases/generated/cdp-baseline-{slug}.json`
   - 已有 → 直接复用，不重复探查
   - 不存在 → 先调用 `cdp-explorer` Skill 生成 baseline
2. **从 baseline 推断用户故事**：
   - 每个可交互区域 → 一个用户故事
   - 元素状态（enabled/disabled/expanded）→ 前置条件
   - 表单字段 → 输入等价类和边界值
3. **locatorHint 直接来自 CDP 探查结果**，准确率最高；`source` 字段设为 `cdp`

---

### 纯文本 / Word 需求转换规则

遇到以下格式时，先转换为用户故事再进入 Phase B：

| 原始格式 | 转换规则 |
|---------|---------|
| `1. 系统应支持用户上传文件` | → `作为用户，我希望上传文件，以便保存数据` |
| `功能要求：密码须包含大小写字母` | → `作为用户，我希望设置包含大小写的密码，以便通过安全验证` |
| `必须支持批量操作` | → `作为用户，我希望批量操作多条记录，以便提高效率` |

转换后按用户故事模式进入标准流程。

---

## 执行流程

### Phase A：去重扫描（生成前）

> **目的**：避免重复生成已有用例，只输出增量。

1. 扫描 `tests/e2e/test-cases/generated/*.md`，提取已有用例 ID 和验证目标
2. 扫描 `tests/e2e/testcases/**/*.test.ts`，提取已有测试名称和断言
3. 构建覆盖索引：`{ caseId, feature, verificationTarget }`
4. 生成完成后在 Phase C 与新用例对比，仅保留增量

若所有新用例均已存在，输出"所有用例已覆盖，跳过生成"并停止。

---

### Phase B：解析输入

**Step B.1 — 输入源分发**

根据识别到的输入类型，选择对应处理路径（可并行）：

```
同时有 .md 需求 + Figma/Pencil？
  → Alignment Mode（见"多源输入处理规则"）

只有 Figma URL / Pencil 文件？
  → Figma/Pencil MCP 提取流程

只有目标 URL 且 Chrome 运行中（无文档）？
  → Chrome CDP 实时页面模式

只有纯文本 / Word 内容？
  → 先转换为用户故事，再执行 Step B.2

其他（PRD 文档 / 用户故事 / Issue / 混合）？
  → 直接执行 Step B.2
```

**Step B.2 — 功能点提取**

1. 读取已处理（或直接输入）的内容
2. 提取每个**可测试的功能点**（用户能做什么、系统如何响应）
3. 识别关键数据字段（输入项、状态值、边界值）
4. 确定功能域名称（用于 TC ID 中的 `{FEATURE}` 部分，大写英文）
5. 如来自设计工具，同步收集真实 UI 元素名称和 locatorHint 映射表，供 Phase H 写入 handoff

---

### Phase C：应用 6 种设计方法

> **强制规则**：必须逐一检查以下 6 种方法的适用性。
> 适用的方法必须产出用例；不适用的方法必须写 `N/A` 并说明原因。
> 禁止只写 Happy Path 就停止。至少 3 种方法必须产出实际用例。

#### 方法 1 — 等价类划分（Equivalence Partitioning）

- 将每个输入字段划分为有效等价类和无效等价类
- 每个等价类至少一个用例；一个用例可以覆盖多个有效类，但只能覆盖一个无效类
- 示例：邮箱字段 → 有效（标准格式）/ 无效（缺少@、空值、超过254字符）

#### 方法 2 — 边界值分析（Boundary Value Analysis）

- 找出边界点：最小值、最小值+1、最大值-1、最大值
- 重点覆盖：字符长度限制、数量上下限、时间范围、分页边界
- 示例：密码 8-20 位 → 测试 7、8、20、21 个字符

#### 方法 3 — 判定表 / 因果图（Decision Table / Cause-Effect Graph）

- 找出多条件组合场景（条件 A + 条件 B → 结果 C）
- 列出所有有意义的条件组合（可剪枝掉逻辑上不可能的组合）
- 示例：已登录 × 有权限 → 可访问；未登录 × 有权限 → 跳转登录页

#### 方法 4 — 状态转换（State Transition Testing）

- 找出对象的状态机（如：草稿 → 提交 → 审核中 → 已通过 / 已拒绝）
- 覆盖正常转换路径和非法转换（不允许的状态跳转）
- 示例：订单不能从"已完成"直接跳回"待支付"

#### 方法 5 — 场景法（Scenario Method）

- 设计完整的用户旅程（Happy Path + Unhappy Path）
- 每个场景包含：前置条件 → 操作序列 → 预期结果
- 示例：新用户注册 → 首次登录 → 完善资料 → 使用核心功能

#### 方法 6 — 错误猜测（Error Guessing）

- 基于经验猜测容易出错的地方
- 重点：空值提交、特殊字符注入、网络中断、并发操作、权限边界、重复提交
- 示例：表单提交时断网、连续双击提交按钮、粘贴超长文本

> 每种方法的详细步骤、完整 Markdown 示例和 Gherkin BDD 示例见 `references/design-methods.md`。

---

### Phase D：前置条件与测试数据自给自足

> **核心原则**：每个用例必须完全自包含——自行创建前置数据、执行、验证、清理。
> 用例之间不得有依赖关系，不得假设某条数据"已经存在"。

#### CRUD 前置条件规范

| 操作类型 | 需要前置数据？ | 前置条件写法 | 清理 |
|---------|:------------:|------------|------|
| **Create（新建）** | 否 | 导航到目标页面即可 | 删除新建的数据 |
| **Read（查看）** | 是 | 通过 UI 先创建目标数据 | 删除创建的数据 |
| **Update（编辑）** | 是 | 通过 UI 先创建目标数据 | 删除创建的数据 |
| **Delete（删除）** | 是 | 通过 UI 先创建目标数据 | 无（测试本身就是删除） |
| **List / Filter（列表筛选）** | 是 | 通过 UI 创建多条符合条件的记录 | 删除全部创建的记录 |
| **Navigate / Validate（导航/校验）** | 否 | 导航到目标页面即可 | 无 |

**前置条件写法规范**：
- ✅ 正确：`通过 UI 创建任务"Test-Edit-{timestamp}"`
- ❌ 错误：`假设已有一条任务数据`（不可执行）
- ❌ 错误：`依赖 TC-001 先执行`（有执行顺序依赖）

**测试数据唯一性**：涉及名称/标题的数据，使用时间戳确保唯一：`测试任务-${Date.now()}`

---

### Phase E：优先级分配

| 优先级 | 标准 | 示例 |
|--------|------|------|
| **P0** | 核心业务路径、登录/支付/核心操作的 Happy Path | 正常登录、提交订单 |
| **P1** | 重要功能分支、常见错误处理、关键边界值 | 密码错误提示、连续失败锁定 |
| **P2** | 边缘场景、兼容性、非关键 UX 细节 | 特殊字符输入、超长文本截断 |

目标比例：**P0 约 15-20%，P1 约 40-50%，P2 约 30-40%**

> 优先级决策树、常见误判场景和比例校验方法见 `references/priority-framework.md`。

---

### Phase F：输出测试用例文档

**TC ID 格式**：`TC-{SOURCE}-{FEATURE}-{NNN}`
- `{SOURCE}`：输入来源，大写，取值：`PRD` / `CDP` / `ISSUE` / `BRANCH`
- `{FEATURE}`：功能域，大写英文，例如：`LOGIN` / `CHECKOUT` / `PROFILE`
- `{NNN}`：三位序号，从 `001` 开始

**输出文件**：`tests/e2e/test-cases/generated/{feature}-{source_type}.md`

**文件结构（强制包含全部 8 个 section）**：

```markdown
# {feature_name} 测试用例

> 来源：{source_type} | 生成时间：{date} | 功能域：{FEATURE}

---

## Method 1: 等价类划分
<!-- 用例列表，或：N/A — 原因：{此功能无可划分的输入等价类} -->

**TC-{SOURCE}-{FEATURE}-001**: 用例标题
- **优先级:** P1
- **测试类型:** 等价类划分
- **前置条件:** 用户已注册账号，当前在登录页
- **操作步骤:** 1. 在邮箱输入框输入"invalid-email" 2. 点击"继续"按钮
- **预期结果:** 显示错误提示"邮箱格式不正确"，按钮保持不可用状态
- **测试数据:** 邮箱: invalid-email

---

## Method 2: 边界值分析
<!-- 用例列表，或：N/A — 原因 -->

---

## Method 3: 判定表 / 因果图
<!-- 用例列表，或：N/A — 原因 -->

---

## Method 4: 状态转换
<!-- 用例列表，或：N/A — 原因 -->

---

## Method 5: 场景法
<!-- 用例列表，或：N/A — 原因 -->

---

## Method 6: 错误猜测
<!-- 用例列表，或：N/A — 原因 -->

---

## Merged Test Case List

> 合并去重后的最终用例列表（内部去重 + 与已有用例对比后的增量）

**TC-{SOURCE}-{FEATURE}-001**: 用例标题
- **优先级:** P0
- **测试类型:** 场景法
- **前置条件:** 用户已注册账号，当前在登录页
- **操作步骤:** 1. 输入有效邮箱 test@example.com 2. 点击"继续" 3. 输入正确密码 Test@12345 4. 点击"登录"
- **预期结果:** 跳转到首页（URL 变为 /dashboard），顶部显示用户名称
- **测试数据:** 邮箱: test@example.com | 密码: Test@12345
```

---

### Phase G：断言质量标准

> **核心原则**：每个预期结果必须验证业务语义，不能只写元素是否可见。

| 断言类型 | ❌ 差（空洞） | ✅ 好（验证语义） |
|---------|------------|----------------|
| 存在性 | 显示成功提示 | 显示文字为"登录成功"的绿色提示条 |
| 数值 | 显示数量 | 显示数量大于 0 且为纯数字 |
| 跳转 | 页面跳转 | URL 变更为 /dashboard，且页面标题为"工作台" |
| 一致性 | 显示任务名 | 详情页任务名与列表页点击的任务名完全一致 |
| 列表 | 显示列表 | 列表至少包含 1 条数据，每条数据包含名称和时间 |
| 错误提示 | 显示错误 | 在邮箱输入框下方显示红色文字"邮箱格式不正确" |

---

### Phase H：生成 Playwright Handoff JSON（强制）

> **强制规定**：无论何种输入源，都必须生成 `playwright-handoff-{slug}.json`。
> 没有 handoff 文件，playwright-script-generator 将拒绝生成脚本。

**文件路径**：`tests/e2e/test-cases/generated/playwright-handoff-{slug}.json`

**Schema**：

```json
[
  {
    "id": "TC-PRD-LOGIN-001",
    "storyId": "prd-login",
    "title": "正常登录流程",
    "source": "prd",
    "priority": "P0",
    "criterionId": "AC-001",
    "scenarioType": "positive",
    "tags": ["@P0", "@smoke", "@regression"],
    "preconditions": ["用户已注册账号"],
    "setup": [
      {
        "type": "navigate",
        "action": "navigate",
        "pomMethod": "goto",
        "data": { "url": "/login" }
      }
    ],
    "uiElements": [
      {
        "role": "textbox",
        "name": "邮箱",
        "action": "fill",
        "value": "test@example.com",
        "dataType": "contact.email",
        "dataVariant": "valid",
        "i18nKey": "auth.emailPlaceholder",
        "locatorHint": "getByRole('textbox', { name: /邮箱/i })"
      }
    ],
    "assertions": [
      { "type": "url", "expected": "/dashboard" },
      { "type": "visible", "target": "用户名称", "i18nKey": "nav.userName" }
    ],
    "teardown": [],
    "timeout": null
  }
]
```

**新增字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `criterionId` | string \| null | 对应验收标准 ID（AC-001）；无对应时填 null |
| `scenarioType` | string | `"positive"` \| `"negative"` \| `"boundary"` \| `"error"` \| `"blocked"` |
| `tags` | string[] | `["@P0","@smoke","@regression","@full"]`，用于套件过滤 |
| `setup[].scope` | string \| undefined | `"worker"`（跨 test 复用的耗时操作）；省略 = 默认 "test" |
| `uiElements[].dataType` | string \| undefined | 语义数据类型（见 dataType 推断表） |
| `uiElements[].dataVariant` | string \| undefined | 数据变体（设了 dataType 时必填） |
| `uiElements[].i18nKey` | string \| undefined | 元素文本的 i18n key（来自消息文件） |
| `assertions[].i18nKey` | string \| undefined | 断言期望文本的 i18n key |

> `scenarioType: "blocked"` — 用于 Alignment Mode 中设计稿与需求文档对齐不完整、缺少足够信息无法生成完整测试步骤的用例；生成后需人工补充。

**dataType 推断表**（script-generator 据此生成具体测试数据）：

| 字段语义（name / label 关键词） | dataType | 常用 dataVariant |
|--------------------------------|----------|----------------|
| 手机号、mobile、phone | `contact.mobile` | `valid` / `invalid` / `boundary` |
| 邮箱、email | `contact.email` | `valid` / `invalid` / `xss` |
| 姓名、name、真实姓名 | `identity.name` | `valid` / `boundary` |
| 密码、password、passwd | `account.password` | `valid` / `invalid` / `strong` / `boundary` |
| 图片文件 | `file.image` | `valid` / `oversized` / `invalid_type` |
| PDF 文件 | `file.pdf` | `valid` / `oversized` |
| 视频文件 | `file.video` | `valid` / `oversized` |
| 文本内容 | `text.content` | `valid` / `boundary` / `xss` |
| 数字 / 金额 | `number.currency` | `valid` / `boundary` / `negative` |
| 日期 | `datetime.date` | `valid` / `boundary` / `past` / `future` |

**timeout 自动检测规则**：

扫描每个 entry 的 `setup[].action` 和 `preconditions[]`，若包含以下关键词 → 自动设 `timeout: 600000`；否则保持 `timeout: null`：

| 触发关键词 | 场景 |
|-----------|------|
| `AI 生成` / `AI 任务` / `AI 处理` | AI 内容生成 |
| `等待生成` / `等待完成` / `wait for completion` | 异步等待 |
| `流式输出` / `streaming` / `stream` | 流式响应 |
| `批量处理` / `batch` | 批量操作 |
| `训练` / `分析大文件` / `large file` | 计算密集型 |

**setup[].scope 规则**：

当满足以下**全部**条件时，设 `"scope": "worker"`；否则省略（默认 "test"）：
1. 创建的数据为只读共享数据（Read 操作，不涉及写入）
2. 初始化耗时 > 30s（AI 生成、大文件处理等）
3. 多个 test 共享同一份前置数据

**写入后验证（必须执行）**：
1. 解析 JSON，确认是有效数组且长度 > 0
2. entry 数量 === `## Merged Test Case List` 中的 TC 数量
3. 每个 entry 必须有非空：`id`、`storyId`、`title`、`priority`、`assertions`（长度 >= 1）
4. 验证失败 → 输出具体缺失字段和 entry ID，修复后重新写入

完整字段规范、i18nKey 查找算法和需求变更更新策略见 `references/playwright-handoff-schema.md`。

---

### Phase I：去重对比与最终输出

1. 将 Phase C 生成的新用例与 Phase A 的覆盖索引对比
2. 去重规则：
   - 相同操作 + 相同预期结果 = 重复，保留已有用例
   - 断言更弱的新用例 = 跳过
   - 全新场景 = 输出到 `## Merged Test Case List`
3. 若全部重复，输出"所有用例已覆盖，跳过生成"并停止

---

## 输出文件

| 文件 | 说明 |
|------|------|
| `tests/e2e/test-cases/generated/{slug}-{source_type}.md` | 人类可读的测试用例文档（含 8 个 section） |
| `tests/e2e/test-cases/generated/playwright-handoff-{slug}.json` | 供 playwright-script-generator 使用（强制生成） |

## Excel 字段映射

本 Skill 的输出格式是与 `excel-case-export/scripts/generate-excel.js` 之间的契约：

| Markdown 字段 | Excel 列 | 解析规则 |
|-------------|---------|---------|
| `**TC-xxx-xxx-001**: 标题` | A（用例ID）+ B（标题） | 正则：`\*\*(TC-[A-Z]+-[A-Z]+-\d+)\*\*:\s*(.+)` |
| `- **优先级:**` | D（优先级） | 关键词匹配："优先级" |
| `- **测试类型:**` | C（设计方法） | 关键词匹配："测试类型" |
| `- **前置条件:**` | E（前置条件） | 关键词匹配："前置条件" |
| `- **操作步骤:**` | F（操作步骤） | 关键词匹配："操作步骤" |
| `- **预期结果:**` | G（预期结果） | 关键词匹配："预期结果" |
| `- **测试数据:**` | H（测试数据） | 关键词匹配："测试数据"（可选字段） |

---

## 自检清单

生成完成后，逐项确认：

**多源输入（按实际输入源勾选）**
- [ ] Alignment Mode：已执行交叉对比，差异已标注 `⚠️` 或询问用户
- [ ] Figma/Pencil MCP：UI 元素名称和 locatorHint 已写入 handoff `uiElements[]`
- [ ] CDP 模式：已复用或重新生成 `cdp-baseline-{slug}.json`，`source` 字段设为 `cdp`
- [ ] 纯文本/Word：已先转换为用户故事再生成

**内容完整性**
- [ ] 输出文件包含全部 8 个 section（Method 1-6 + Merged + 来源头部）
- [ ] 不适用的方法写了 `N/A` + 原因（不能静默跳过）
- [ ] 至少 3 种方法产出了实际用例
- [ ] `## Merged Test Case List` 包含去重后的最终用例
- [ ] 每个用例 ID 格式为 `TC-{SOURCE}-{FEATURE}-{NNN}`，无重复
- [ ] 所有前置条件可执行（无"假设数据已存在"这类描述）
- [ ] 每个预期结果验证业务语义（非"应该正常显示"）
- [ ] `playwright-handoff-{slug}.json` 已生成且通过验证
- [ ] P0:P1:P2 比例约为 2:4:3

## Reference Files

| 文件 | 内容 |
|------|------|
| `references/playwright-handoff-schema.md` | Handoff JSON 完整字段规范、dataType 推断表（完整版）、i18nKey 查找算法、timeout 关键词完整列表、需求变更 7 类产物更新策略 |
| `references/design-methods.md` | 6 种设计方法详细步骤与完整示例（含 Markdown 表格和 Gherkin BDD 格式） |
| `references/priority-framework.md` | 优先级决策树、验证规则、P0:P1:P2 比例校验方法 |
| `references/input-extraction.md` | 输入源提取方法总览（索引） |
| `references/input-extraction-requirements.md` | 需求文档（Markdown / Word / 纯文本）提取规则 |
| `references/input-extraction-design-cdp.md` | Figma MCP / Pencil MCP / CDP baseline 提取规则 |
| `references/best-practices.md` | 11 条最佳实践、7 种反模式、8 条调试技巧 |
| `references/how-to-guides.md` | 实现指南总览（索引） |
| `references/how-to-guides-typescript.md` | TypeScript 实现：story-parser、等价类生成器、Gherkin formatter、场景生成器 |
| `references/how-to-guides-advanced.md` | 优先级计算器、可追溯性矩阵构建器、Python / Java 实现示例 |
| `references/project-setup.md` | Cucumber / TypeScript 项目目录布局、UserStory / AcceptanceCriterion 接口定义 |

---

## 注意事项

- 用例标题用动词开头，描述用户行为，不描述实现细节（"用户提交空表单"而非"系统校验空值"）
- 测试数据必须具体（`test@example.com`），不能用占位符（`有效邮箱`）
- 用例之间不得有执行顺序依赖
