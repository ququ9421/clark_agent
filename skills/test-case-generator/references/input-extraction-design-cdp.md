# 输入源提取 — 设计工具与 CDP

---

## 1. Figma MCP 提取流程

### 前置条件
- Figma MCP 工具可用（用户已配置 `figma` MCP server）
- 用户已提供 Figma 文件 URL 或节点 ID

### 提取步骤

```
Step 1: 调用 Figma MCP 工具获取节点树
  → get_figma_data(fileId, nodeId)

Step 2: 遍历节点树，按类型提取：
  - FRAME / PAGE → 功能域名称（→ {FEATURE}）
  - COMPONENT / COMPONENT_SET → UI 组件类型
  - TEXT → 按父节点角色分类：
    - Button 内的 text → 按钮文本（→ uiElements[].name）
    - Input placeholder → 输入框描述（→ 等价类划分的字段名）
    - Label 旁的 text → 表单字段名
    - Error state text → 错误提示（→ assertions[].expected）
  - VARIANT / PROPERTY → 状态变体

Step 3: 提取状态变体
  - Normal / Default → 正常状态（positive）
  - Hover / Focus → 交互反馈（不生成独立用例，作为 P2）
  - Disabled → 禁用条件（→ 判定表用例）
  - Error / Invalid → 错误状态（→ 等价类无效类 + 断言）
  - Empty / Loading / Success → 状态转换用例

Step 4: 提取交互流程（Prototype Links）
  - 箭头从 A 指向 B → A 操作后导航到 B
  - → 场景法的操作序列
```

### 元素映射规则

| Figma 元素 | 映射到 Handoff |
|-----------|--------------|
| Button 文本 | `uiElements[].name`（action: click） |
| Input placeholder | `uiElements[].name`（action: fill） |
| Input label | 等价类输入字段名 |
| Dropdown 选项 | `uiElements[].value`（action: select） |
| Error 文本 | `assertions[].expected` |
| Success 文本 | `assertions[].expected` |
| Figma layer name | `uiElements[].locatorHint` 推断基础 |

### locatorHint 推断规则

```
Figma layer name → locatorHint

"Submit Button" → getByRole('button', { name: /Submit/i })
"Email Input"   → getByRole('textbox', { name: /Email/i })
"Error Message" → getByRole('alert')
"Loading..."    → getByText(/Loading/)
"Close Dialog"  → getByRole('button', { name: /Close/i })
```

### 降级处理

```
Figma MCP 不可用时：
1. 请求用户提供组件截图 → 人工识别元素
2. 请求用户粘贴元素清单（名称、类型、状态）
3. 仅有 URL 时 → 切换为 CDP 模式（如页面可访问）
4. 以上都不可用 → 切换为纯文档模式，locatorHint 标注为 [需人工确认]
```

---

## 2. Pencil MCP 提取流程

### 前置条件
- Pencil MCP 工具可用
- 用户已提供 `.ep` 或 `.epgz` 项目文件路径

### 提取步骤

```
Step 1: 调用 Pencil MCP 工具获取页面列表
  → get_pencil_pages(filePath)

Step 2: 遍历每个页面的 shapes：
  - Rectangle + Text → 按钮或卡片
  - TextInput shape → 输入字段
  - Label shape → 字段名称或提示文本
  - Select / Dropdown → 下拉选择

Step 3: 按 z-order 和位置分组，识别表单结构：
  - Label 在 Input 上方/左侧 → Label 为该字段的 name
  - Button 在表单区域底部 → 提交/取消按钮

Step 4: 提取页面间链接
  - 页面跳转关系 → 场景法的导航序列
```

### 降级处理

```
Pencil MCP 不可用时：
1. 请求用户导出为 PNG → 视觉识别（类 Figma 降级）
2. 请求用户导出为 HTML → 解析 DOM 结构
3. 以上都不可用 → 切换为纯文档模式
```

---

## 3. CDP Baseline 提取规则

### 前置条件

满足以下任一条件：
- 存在 `tests/e2e/test-cases/generated/cdp-baseline-{slug}.json`（直接复用）
- 用户提供目标 URL 且 Chrome 浏览器正在运行（生成新 baseline）

### CDP Baseline 结构

```json
{
  "url": "https://app.example.com/tasks",
  "slug": "tasks",
  "capturedAt": "2026-06-30T00:00:00Z",
  "elements": [
    {
      "role": "button",
      "name": "新建任务",
      "locatorHint": "getByRole('button', { name: /新建任务/i })",
      "state": "enabled",
      "boundingBox": { "x": 100, "y": 50, "width": 120, "height": 36 }
    },
    {
      "role": "textbox",
      "name": "搜索任务",
      "locatorHint": "getByPlaceholder(/搜索/i)",
      "state": "enabled",
      "inputType": "text"
    },
    {
      "role": "listitem",
      "name": "任务列表项",
      "locatorHint": "getByRole('listitem')",
      "count": 5,
      "state": "visible"
    }
  ],
  "interactions": [
    { "type": "click", "element": "新建任务", "navigatesTo": "/tasks/new" },
    { "type": "fill", "element": "搜索任务", "triggersSearch": true }
  ]
}
```

### Baseline 到用户故事的推断规则

```
每个"可交互区域"推断为一个用户故事：

按钮（role: button）：
  → 作为用户，我希望点击"{name}"按钮执行操作

输入框（role: textbox）：
  → 作为用户，我希望在"{name}"输入框中输入内容

表单（多个输入框 + 一个提交按钮）：
  → 作为用户，我希望填写表单并提交

下拉/选择（role: combobox）：
  → 作为用户，我希望从"{name}"选择器中选择选项

列表项（role: listitem，count > 0）：
  → 作为用户，我希望查看列表中的数据

元素 state=disabled：
  → 作为用户，当条件不满足时，我不应该能执行该操作
  → 生成判定表用例（禁用条件）
```

### locatorHint 直接复用规则

CDP baseline 中的 `locatorHint` 来自真实 DOM，**直接写入 handoff 的 `uiElements[].locatorHint`**，不需要推断。

这是 CDP 模式的最大优势：locator 准确率 100%，无需猜测。

### Baseline 有效期与重新生成

```
检查 baseline 是否需要重新生成：
  - capturedAt 距今 > 7 天
  - 用户报告 UI 已更新
  - 脚本执行失败（locator 失效）

→ 任意条件满足 → 提示用户使用 /qa-explore 重新生成 baseline
```
