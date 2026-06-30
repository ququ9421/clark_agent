#!/usr/bin/env node
/**
 * 将测试用例 Markdown 导出为 Excel (.xlsx)
 * 解析格式与 test-case-generator SKILL.md v1.1.0 的输出契约对齐
 * 用法：node generate-excel.js <md_path> [output_path]
 */

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// ── 参数解析 ──────────────────────────────────────────────
const mdPath = process.argv[2];
if (!mdPath) {
  console.error('用法：node generate-excel.js <md_path> [output_path]');
  process.exit(1);
}

const outputPath = process.argv[3] ||
  path.join(path.dirname(mdPath), path.basename(mdPath, '.md') + '.xlsx');

if (!fs.existsSync(mdPath)) {
  console.error(`文件不存在：${mdPath}`);
  process.exit(1);
}

const md = fs.readFileSync(mdPath, 'utf-8');

// ── 解析测试用例 ──────────────────────────────────────────
// 只从 ## Merged Test Case List section 解析，忽略各方法 section 中的草稿用例
function parseCases(text) {
  // 提取 Merged Test Case List section 的内容
  const mergedMatch = text.match(/## Merged Test Case List([\s\S]*?)(?=\n## |\n---\s*$|$)/);
  const scope = mergedMatch ? mergedMatch[1] : text;

  const cases = [];
  // TC ID 格式：TC-{SOURCE}-{FEATURE}-{NNN}，兼容旧格式 TC-{NNN}
  const blocks = scope.split(/(?=^\*\*TC-)/m).filter(b => b.trim().startsWith('**TC-'));

  for (const block of blocks) {
    const lines = block.split('\n');
    const firstLine = lines[0];

    // 解析 ID 和标题：**TC-PRD-LOGIN-001**: 标题文字
    const idTitleMatch = firstLine.match(/^\*\*(TC-[A-Z]+-[A-Z]+-\d+|TC-\d+)\*\*:\s*(.+)/);
    if (!idTitleMatch) continue;

    const id = idTitleMatch[1].trim();
    const title = idTitleMatch[2].trim();

    // 解析字段（支持中英文标签，空格不敏感）
    const getField = (...labels) => {
      for (const label of labels) {
        const re = new RegExp(`-\\s*\\*\\*${label}[：:]\\*\\*\\s*(.+)`);
        const m = block.match(re);
        if (m) return m[1].trim();
      }
      return '';
    };

    // 操作步骤可能是多行（"1. xxx 2. xxx"或换行列表）
    const getSteps = () => {
      const re = /- \*\*操作步骤[：:]\*\*([\s\S]*?)(?=\n- \*\*|\n\*\*TC-|$)/;
      const m = block.match(re);
      if (!m) return '';
      return m[1].split('\n')
        .map(l => l.replace(/^\s*[-\d.]\s*/, '').trim())
        .filter(Boolean)
        .join(' → ');
    };

    cases.push({
      id,
      title,
      method:         getField('测试类型', 'Test Type'),
      priority:       getField('优先级', 'Priority'),
      preconditions:  getField('前置条件', 'Preconditions'),
      steps:          getSteps(),
      expected:       getField('预期结果', 'Expected Result'),
      testData:       getField('测试数据', 'Test Data'),
    });
  }

  return cases;
}

const cases = parseCases(md);

if (cases.length === 0) {
  console.warn('⚠️  未在 "## Merged Test Case List" 中解析到用例');
  console.warn('   请确认：1) 存在该 section  2) TC 格式为 **TC-xxx-xxx-001**: 标题');
  process.exit(0);
}

// ── 生成 Excel ────────────────────────────────────────────
async function generate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QA Agent';
  workbook.created = new Date();

  const PRIORITY_COLOR = { P0: 'FFEB3B', P1: '90CAF9', P2: 'C8E6C9' };

  const HEADER_STYLE = {
    font: { bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } },
    alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
    border: {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' },
    },
  };

  const CELL_BORDER = {
    top: { style: 'thin' }, left: { style: 'thin' },
    bottom: { style: 'thin' }, right: { style: 'thin' },
  };

  function applyHeader(row) {
    row.eachCell(cell => Object.assign(cell, HEADER_STYLE));
    row.height = 22;
  }

  function styleDataRow(row, priority) {
    const color = PRIORITY_COLOR[priority] || 'FFFFFF';
    row.eachCell(cell => {
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = CELL_BORDER;
    });
    const pCell = row.getCell('priority');
    pCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } };
    pCell.font = { bold: true };
    pCell.alignment = { horizontal: 'center', vertical: 'middle' };
    row.height = 22;
  }

  // ── Sheet 1：用例列表（汇总）──────────────────────────
  const summary = workbook.addWorksheet('用例列表');
  summary.columns = [
    { header: '用例ID',   key: 'id',           width: 22 },
    { header: '标题',     key: 'title',         width: 40 },
    { header: '设计方法', key: 'method',        width: 16 },
    { header: '优先级',   key: 'priority',      width: 10 },
    { header: '前置条件', key: 'preconditions', width: 35 },
    { header: '预期结果', key: 'expected',      width: 45 },
  ];
  applyHeader(summary.getRow(1));

  for (const tc of cases) {
    const row = summary.addRow(tc);
    styleDataRow(row, tc.priority);
  }
  summary.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Sheet 2：详细用例 ─────────────────────────────────
  const detail = workbook.addWorksheet('详细用例');
  detail.columns = [
    { header: '用例ID',   key: 'id',           width: 22 },
    { header: '标题',     key: 'title',         width: 40 },
    { header: '优先级',   key: 'priority',      width: 10 },
    { header: '设计方法', key: 'method',        width: 16 },
    { header: '前置条件', key: 'preconditions', width: 35 },
    { header: '操作步骤', key: 'steps',         width: 55 },
    { header: '预期结果', key: 'expected',      width: 45 },
    { header: '测试数据', key: 'testData',      width: 30 },
  ];
  applyHeader(detail.getRow(1));

  for (const tc of cases) {
    const row = detail.addRow(tc);
    styleDataRow(row, tc.priority);
    row.height = 30;
  }
  detail.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Sheet 3：优先级统计 ───────────────────────────────
  const stats = workbook.addWorksheet('统计');
  const p0 = cases.filter(c => c.priority === 'P0').length;
  const p1 = cases.filter(c => c.priority === 'P1').length;
  const p2 = cases.filter(c => c.priority === 'P2').length;

  stats.columns = [
    { header: '维度', key: 'label', width: 20 },
    { header: '数量', key: 'count', width: 10 },
    { header: '占比', key: 'ratio', width: 10 },
  ];
  applyHeader(stats.getRow(1));

  const total = cases.length;
  const pct = n => `${Math.round(n / total * 100)}%`;

  [
    { label: '总计', count: total, ratio: '100%' },
    { label: 'P0（核心路径）', count: p0, ratio: pct(p0) },
    { label: 'P1（重要功能）', count: p1, ratio: pct(p1) },
    { label: 'P2（边缘场景）', count: p2, ratio: pct(p2) },
  ].forEach(r => {
    const row = stats.addRow(r);
    row.eachCell(cell => {
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = CELL_BORDER;
    });
    row.height = 20;
  });

  // ── 写入文件 ──────────────────────────────────────────
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  await workbook.xlsx.writeFile(outputPath);

  console.log(`✅ Excel 导出完成`);
  console.log(`📊 文件：${outputPath}`);
  console.log(`   总计：${total} 个用例`);
  console.log(`   P0：${p0} 个 | P1：${p1} 个 | P2：${p2} 个`);
  console.log(`   P0 占比：${pct(p0)}（建议 15-20%）`);
}

generate().catch(err => {
  console.error('导出失败：', err.message);
  process.exit(1);
});
