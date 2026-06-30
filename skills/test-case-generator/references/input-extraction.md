# 输入源提取 — 总览（索引）

> 本文件是输入源提取规则的索引，详细规则见子文件。

---

## 输入源分类

```
输入源
├── 文档类（需求 / 文本）
│   └── references/input-extraction-requirements.md
│       ├── Markdown / PRD 文档
│       ├── 纯文本 / Word 需求
│       ├── Linear Issue
│       └── 用户故事文本
│
└── 设计 / 实时页面类
    └── references/input-extraction-design-cdp.md
        ├── Figma MCP
        ├── Pencil MCP
        └── CDP baseline（Chrome DevTools Protocol）
```

---

## 输入源识别速查

| 输入特征 | 识别为 | 处理文件 |
|---------|--------|---------|
| `.md` / `.txt` 文件路径，或含标题/列表的粘贴内容 | PRD/Markdown | requirements |
| "作为…我希望…以便…" 格式 | 用户故事 | requirements |
| 编号列表、"应/须/需"规范语句 | 纯文本/Word | requirements |
| Figma URL 或节点 ID（Figma MCP 可用） | Figma 设计稿 | design-cdp |
| Pencil 项目文件路径（Pencil MCP 可用） | Pencil 原型 | design-cdp |
| `cdp-baseline-{slug}.json` 或目标 URL + Chrome 运行中 | CDP baseline | design-cdp |
| Linear Issue 编号（Issue-XXX / #XXX） | Linear Issue | requirements |
| 同时提供文档 **和** 设计工具 | Alignment Mode | requirements + design-cdp |
| 以上任意组合（排除设计稿混合） | 混合输入 | 分别处理后合并 |

---

## Alignment Mode 触发条件

同时满足以下两条时，进入 Alignment Mode：
1. 提供了 Markdown / PRD 文档
2. 提供了 Figma URL **或** Pencil 文件路径

Alignment Mode 必须先执行交叉对比再生成用例，详见 SKILL.md 中的"Alignment Mode"章节。
