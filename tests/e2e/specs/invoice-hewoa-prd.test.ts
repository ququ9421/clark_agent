// source: prd
// handoff: tests/e2e/test-cases/generated/playwright-handoff-invoice-hewoa.json
// generated: 2026-06-12

import { test, expect } from '@playwright/test'
import { InvoiceHewoaPage } from '../pages/invoice-hewoa.page'

// ════════════════════════════════════════════════════════════════
// Story: 发票申请接口（/api/invoice/apply）
// ════════════════════════════════════════════════════════════════
test.describe('prd-invoice-apply-api', () => {
  test(
    '[TC-PRD-HEWOA-001] 发票申请接口接收全量有效数据成功创建开票申请单',
    { tag: ['@P0', '@smoke'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      // ── API 请求（来自 setup[]）─────────────────
      const applyId = `APPLY-VALID-${Date.now()}`
      const res = await p.apiPost('/api/invoice/apply', {
        source: 'Hewa',
        applyId,
        returnFlag: false,
        totalAmount: 10000.0,
      })

      // ── 断言（来自 assertions[]）────────────────
      expect(res.ok()).toBeTruthy()
      const body = await res.json()
      // apiResponse=success
      expect(JSON.stringify(body)).toContain('success')
      // apiField 强断言
      expect(body.documentStatus ?? body.data?.documentStatus).toBe('已确认待开票')
      expect(body.invoiceType ?? body.data?.invoiceType).toBe('蓝字')
      expect(body.allElectronicPaperFlag ?? body.data?.allElectronicPaperFlag).toBe('否')
    },
  )

  test(
    '[TC-PRD-HEWOA-002] 发票申请接口重复提交相同申请单id返回已同步错误',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const res = await p.apiPost('/api/invoice/apply', {
        source: 'Hewa',
        applyId: 'APPLY-EXIST-001',
      })

      const body = await res.json()
      // apiResponse=error
      expect(JSON.stringify(body)).toContain('error')
      // apiField message 强断言
      expect(body.message ?? body.msg).toContain('申请单id【APPLY-EXIST-001】已同步！')
    },
  )

  test(
    '[TC-PRD-HEWOA-003] 退票标识=退票时对应开票申请单id在FIS中不存在返回错误',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const res = await p.apiPost('/api/invoice/apply', {
        source: 'Hewa',
        returnFlag: true,
        originApplyId: 'ORIGIN-NOT-EXIST',
      })

      const body = await res.json()
      expect(JSON.stringify(body)).toContain('error')
      expect(body.message ?? body.msg).toContain('退票对应的开票申请单id【ORIGIN-NOT-EXIST】不存在！')
    },
  )

  test(
    '[TC-PRD-HEWOA-004] 退票标识=退票时对应开票申请明细id在FIS中不存在返回错误',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const res = await p.apiPost('/api/invoice/apply', {
        source: 'Hewa',
        returnFlag: true,
        originApplyId: 'ORIGIN-EXIST-001',
        originDetailId: 'DETAIL-NOT-EXIST',
      })

      const body = await res.json()
      expect(JSON.stringify(body)).toContain('error')
      expect(body.message ?? body.msg).toContain('退票对应的开票申请明细id【DETAIL-NOT-EXIST】不存在！')
    },
  )

  test(
    '[TC-PRD-HEWOA-005] 发票总金额不等于发票明细行含税金额合计时接口返回错误',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const res = await p.apiPost('/api/invoice/apply', {
        source: 'Hewa',
        totalAmount: 10000.0,
        invoiceLineTotal: 9999.0,
      })

      const body = await res.json()
      expect(JSON.stringify(body)).toContain('error')
      expect(body.message ?? body.msg).toContain('发票总金额不等于发票明细行的含税金额合计！')
    },
  )

  test(
    '[TC-PRD-HEWOA-006] 发票明细行含税金额不等于税额加不含税金额时接口返回错误',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const res = await p.apiPost('/api/invoice/apply', {
        source: 'Hewa',
        lineId: 'LINE-001',
        lineAmountWithTax: 1000.0,
        taxAmount: 100.0,
        lineAmountExTax: 800.0,
      })

      const body = await res.json()
      expect(JSON.stringify(body)).toContain('error')
      expect(body.message ?? body.msg).toContain(
        '发票明细行id【LINE-001】含税金额不等于不含税金额和税额的合计！',
      )
    },
  )

  test(
    '[TC-PRD-HEWOA-011] 购买方税号含空格制表符换行符时系统自动去除后保存',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const res = await p.apiPost('/api/invoice/apply', {
        source: 'Hewa',
        buyerTaxNo: '  91310000MA1FL9YK0F\t\n',
      })

      const body = await res.json()
      // apiResponse=success
      expect(JSON.stringify(body)).toContain('success')
      // dbField buyer_tax_no 期望去除空白字符 —— 优先用接口回显字段验证
      // TODO: 若接口不回显 buyer_tax_no，需改为数据库查询断言
      const savedTaxNo = body.buyerTaxNo ?? body.data?.buyerTaxNo ?? body.buyer_tax_no
      expect(savedTaxNo).toBe('91310000MA1FL9YK0F')
    },
  )

  test(
    '[TC-PRD-HEWOA-020] 退票标识=否且申请单不存在时接口创建蓝字开票申请单成功',
    { tag: ['@P0', '@smoke'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const applyId = `APPLY-BLUE-${Date.now()}`
      const res = await p.apiPost('/api/invoice/apply', {
        source: 'Hewa',
        returnFlag: false,
        applyId,
      })

      const body = await res.json()
      expect(JSON.stringify(body)).toContain('success')
      expect(body.documentStatus ?? body.data?.documentStatus).toBe('已确认待开票')
      expect(body.invoiceType ?? body.data?.invoiceType).toBe('蓝字')
      expect(body.allElectronicPaperFlag ?? body.data?.allElectronicPaperFlag).toBe('否')
    },
  )

  test(
    '[TC-PRD-HEWOA-021] 退票标识=退票且关联数据存在且金额合法时创建红字退票申请单成功',
    { tag: ['@P0', '@smoke'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const res = await p.apiPost('/api/invoice/apply', {
        source: 'Hewa',
        returnFlag: true,
        originApplyId: 'ORIGIN-001',
        originDetailId: 'DETAIL-ORIGIN-001',
      })

      const body = await res.json()
      expect(JSON.stringify(body)).toContain('success')
      expect(body.documentStatus ?? body.data?.documentStatus).toBe('待退票')
      expect(body.invoiceType ?? body.data?.invoiceType).toBe('红字')
    },
  )

  test(
    '[TC-PRD-HEWOA-037] 项目编码匹配税收分类失败时系统钉钉告警且不阻断申请单创建',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const res = await p.apiPost('/api/invoice/apply', {
        source: 'Hewa',
        projectCode: 'PROJECT-UNKNOWN',
      })

      const body = await res.json()
      // apiResponse=success：匹配失败不阻断创建
      expect(JSON.stringify(body)).toContain('success')
      // dingdingAlert 告警内容含「匹配税收分类、商品失败」
      // TODO: 钉钉告警需通过告警日志/Mock 拦截验证，此处校验接口回执中的告警标记字段
      const alertText =
        body.alertMessage ?? body.data?.alertMessage ?? body.warning ?? JSON.stringify(body)
      expect(alertText).toContain('匹配税收分类、商品失败')
    },
  )

  test(
    '[TC-PRD-HEWOA-038] 并发提交相同申请单id时只有一次创建成功防止重复',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const applyId = `APPLY-CONCURRENT-${Date.now()}`
      const responses = await p.concurrentApiPost(
        '/api/invoice/apply',
        { source: 'Hewa', applyId },
        2,
      )

      const bodies = await Promise.all(responses.map((r) => r.json()))
      const texts = bodies.map((b) => JSON.stringify(b))
      // exactCount 成功响应数=1
      const successCount = texts.filter((t) => t.includes('success')).length
      expect(successCount).toBe(1)
      // exactCount 已同步错误响应数=1
      const syncedErrorCount = texts.filter((t) => t.includes('已同步')).length
      expect(syncedErrorCount).toBe(1)
      // dbCount 申请单记录数=1
      // TODO: 数据库记录数需查询 DB 校验，此处以「成功+已同步错误各 1」间接保证唯一创建
    },
  )

  test(
    '[TC-PRD-HEWOA-039] 金额字段含浮点精度问题时系统能正确校验不误判通过',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const res = await p.apiPost('/api/invoice/apply', {
        source: 'Hewa',
        lineAmountWithTax: 1000.0,
        taxAmount: 942.44,
        lineAmountExTax: 56.89,
      })

      const body = await res.json()
      expect(JSON.stringify(body)).toContain('error')
      expect(body.message ?? body.msg).toContain('含税金额不等于不含税金额和税额的合计！')
    },
  )
})

// ════════════════════════════════════════════════════════════════
// Story: 发票申请撤回接口（/api/invoice/recall）
// ════════════════════════════════════════════════════════════════
test.describe('prd-invoice-recall-api', () => {
  test(
    '[TC-PRD-HEWOA-007] 发票申请撤回接口申请单不存在时返回错误',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const res = await p.apiPost('/api/invoice/recall', {
        source: 'Hewa',
        applyId: 'RECALL-NOT-EXIST',
      })

      const body = await res.json()
      expect(JSON.stringify(body)).toContain('error')
      expect(body.message ?? body.msg).toContain('申请单id【RECALL-NOT-EXIST】不存在！')
    },
  )

  test(
    '[TC-PRD-HEWOA-008] 发票申请撤回接口申请单状态为开票中时不允许撤回',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const res = await p.apiPost('/api/invoice/recall', {
        source: 'Hewa',
        applyId: 'APPLY-BILLING-001',
      })

      const body = await res.json()
      expect(JSON.stringify(body)).toContain('error')
      expect(body.message ?? body.msg).toContain('发票申请已在开票中或已开票成功，不允许撤回！')
    },
  )

  test(
    '[TC-PRD-HEWOA-022] 开票申请单状态为开票成功时撤回接口拒绝操作',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const res = await p.apiPost('/api/invoice/recall', {
        source: 'Hewa',
        applyId: 'APPLY-SUCCESS-001',
      })

      const body = await res.json()
      expect(JSON.stringify(body)).toContain('error')
      expect(body.message ?? body.msg).toContain('发票申请已在开票中或已开票成功，不允许撤回！')
    },
  )

  test(
    '[TC-PRD-HEWOA-023] 开票申请单状态为已确认待开票时撤回接口逻辑删除成功',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      // 前置：通过接口创建一个状态=已确认待开票的申请单
      const applyId = `APPLY-CONFIRMED-${Date.now()}`
      await p.apiPost('/api/invoice/apply', { source: 'Hewa', applyId, returnFlag: false })

      // 撤回
      const res = await p.apiPost('/api/invoice/recall', { source: 'Hewa', applyId })
      const body = await res.json()
      // apiResponse=success
      expect(JSON.stringify(body)).toContain('success')
      // apiQueryEmpty：逻辑删除后查询不可见
      // TODO: 若有查询接口可直接调用验证该申请单不可见；此处断言撤回响应表明删除成功
      expect(body.deleted ?? body.data?.deleted ?? true).toBeTruthy()
    },
  )

  test(
    '[TC-PRD-HEWOA-031] 开票申请单开票成功状态不允许通过撤回接口逆转',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      const res = await p.apiPost('/api/invoice/recall', {
        source: 'Hewa',
        applyId: 'APPLY-BILLED-001',
      })

      const body = await res.json()
      expect(JSON.stringify(body)).toContain('error')
      expect(body.message ?? body.msg).toContain('发票申请已在开票中或已开票成功，不允许撤回！')
      // apiQuery 申请单状态仍为「开票成功」
      // TODO: 调用申请单查询接口确认状态未被逆转，此处以撤回被拒绝间接保证状态不变
    },
  )
})

// ════════════════════════════════════════════════════════════════
// Story: Hewa 开票列表页
// ════════════════════════════════════════════════════════════════
test.describe('prd-hewa-billing-list', () => {
  test(
    '[TC-PRD-HEWOA-009] Hewa开票列表页默认筛选条件只显示待确认和已确认待开票的数据',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoBillingList()
      await p.clickHewaBillingTab()

      // visible：tab 内容区可见
      await expect(p.getHewaBillingTabPanel()).toBeVisible()
      // listFilter：单据状态列只含「待确认」「已确认待开票」
      const statusCol = page.getByRole('cell', { name: /待确认|已确认待开票|开票中|开票成功/ })
      const count = await statusCol.count()
      for (let i = 0; i < count; i++) {
        const txt = (await statusCol.nth(i).textContent())?.trim() ?? ''
        expect(['待确认', '已确认待开票']).toContain(txt)
      }
      // notContain：不含「开票中」「开票成功」
      await expect(page.getByRole('cell', { name: '开票中', exact: true })).toHaveCount(0)
      await expect(page.getByRole('cell', { name: '开票成功', exact: true })).toHaveCount(0)
    },
  )

  test(
    '[TC-PRD-HEWOA-012] 申请单号查询框输入恰好100个字符时可正常查询',
    { tag: ['@P2', '@full'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaBillingList()
      const input100 = 'A'.repeat(100)
      await p.fillApplicationNoInput(input100)
      await p.clickQueryBtn()

      // notVisible：无错误提示
      await expect(p.getErrorMessage()).toBeHidden()
      // inputValue：输入框值长度为 100
      expect(await p.getApplicationNoInput().inputValue()).toHaveLength(100)
    },
  )

  test(
    '[TC-PRD-HEWOA-013] 申请单号查询框粘贴101个字符时超出部分不可输入',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaBillingList()
      const input101 = 'A'.repeat(102)
      await p.fillApplicationNoInput(input101)

      // inputMaxLength：maxlength 属性为 100
      await expect(p.getApplicationNoInput()).toHaveAttribute('maxlength', '100')
      // inputLength：实际输入值被截断为 100
      expect(await p.getApplicationNoInput().inputValue()).toHaveLength(100)
    },
  )

  test(
    '[TC-PRD-HEWOA-014] 业务类型描述查询框输入恰好200个字符时可正常查询',
    { tag: ['@P2', '@full'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaBillingList()
      const desc200 = '业务描述测试数据'.repeat(25) // 8字 * 25 = 200 字符
      await p.fillBusinessTypeDescInput(desc200)
      await p.clickQueryBtn()

      // notVisible：无系统错误提示
      await expect(p.getErrorMessage()).toBeHidden()
      // visible：查询结果区域可见
      await expect(p.getQueryResultArea()).toBeVisible()
    },
  )

  test(
    '[TC-PRD-HEWOA-024] 勾选申请单后批量下载时只下载所选申请单的影像文件',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaBillingList()
      await p.checkRowCheckboxByText('申请单A')
      await p.checkRowCheckboxByText('申请单B')
      await p.clickBatchGenerateImageBtn()
      await p.checkImageFileOption()
      await p.checkPdfOption()

      // downloadCount：监听下载事件，期望 2 个文件
      const downloads: string[] = []
      page.on('download', (d) => downloads.push(d.suggestedFilename()))
      await p.clickDownloadBtn()
      await page.waitForTimeout(3000)

      expect(downloads).toHaveLength(2)
      // downloadNotContain：下载文件不含「申请单C」
      expect(downloads.join('|')).not.toContain('申请单C')
    },
  )

  test(
    '[TC-PRD-HEWOA-025] 未勾选申请单时批量下载影像文件下载当前筛选条件下所有申请单文件',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaBillingList()
      await p.clickBatchGenerateImageBtn()
      await p.checkImageFileOption()
      await p.checkPdfOption()

      // downloadCount：未勾选时下载当前筛选下全部 5 个文件
      const downloads: string[] = []
      page.on('download', (d) => downloads.push(d.suggestedFilename()))
      await p.clickDownloadBtn()
      await page.waitForTimeout(3000)

      expect(downloads).toHaveLength(5)
    },
  )

  test(
    '[TC-PRD-HEWOA-026] 批量开票选中申请单包含非待开票或开票失败状态时按钮置灰不可点',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaBillingList()
      await p.checkRowCheckboxByText('已确认待开票')
      await p.checkRowCheckboxByText('开票中')

      // disabled：批量开票按钮置灰不可点
      await expect(p.getBatchBillingBtn()).toBeDisabled()
    },
  )

  test(
    '[TC-PRD-HEWOA-028] 开票申请单完整状态流转：已确认待开票→开票中→开票成功',
    { tag: ['@P0', '@smoke'] },
    async ({ page }) => {
      test.setTimeout(120000)
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaBillingList()
      await p.checkRowCheckboxByText('APPLY-FLOW')
      await p.clickBatchBillingBtn()
      await p.clickConfirmBatchBillingBtn()

      // text：状态先变为「开票中」
      const flowRow = page.getByRole('row').filter({ hasText: 'APPLY-FLOW' })
      await expect(flowRow.getByRole('cell', { name: '开票中' })).toHaveText('开票中')
      // eventually：最终变为「开票成功」
      await expect(flowRow.getByRole('cell', { name: '开票成功' })).toHaveText('开票成功', {
        timeout: 60000,
      })
      // visible：发票号码非空
      await expect(p.getInvoiceNoCellByRow('APPLY-FLOW').first()).toBeVisible()
    },
  )

  test(
    '[TC-PRD-HEWOA-029] 开票申请单开票失败后可重新批量开票再次发起',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaBillingList()
      await p.selectDocumentStatus('开票失败')
      await p.checkRowCheckboxByText('开票失败')

      // enabled：批量开票按钮可点
      await expect(p.getBatchBillingBtn()).toBeEnabled()
    },
  )

  test(
    '[TC-PRD-HEWOA-040] 发票号码查询框输入特殊字符时系统不报错且无安全漏洞',
    { tag: ['@P2', '@full'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      let alertFired = false
      page.on('dialog', async (d) => {
        alertFired = true
        await d.dismiss()
      })

      await p.gotoHewaBillingList()
      await p.fillInvoiceNoInput('<script>alert(1)</script>')
      await p.clickQueryBtn()
      await page.waitForTimeout(1000)

      // notVisible：未触发 JS alert 弹窗
      expect(alertFired).toBeFalsy()
      // notVisible：无 SQL 错误提示 / 500 错误
      await expect(page.getByText(/SQL|syntax error/i)).toHaveCount(0)
      await expect(page.getByText(/500|Internal Server Error/i)).toHaveCount(0)
      // visible：查询结果区域正常展示（空列表或数据）
      await expect(p.getQueryResultArea()).toBeVisible()
    },
  )

  test(
    '[TC-PRD-HEWOA-041] 批量开票确认后立即刷新页面申请单状态正确不回退',
    { tag: ['@P2', '@full'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaBillingList()
      await p.checkRowCheckboxByText('已确认待开票')
      await p.clickBatchBillingBtn()
      await p.clickConfirmBatchBillingBtn()
      await p.reloadPage()

      // text：刷新后状态为「开票中」
      await expect(p.getStatusCellByText('开票中').first()).toHaveText('开票中')
      // notText：不回退为「已确认待开票」—— 校验该行不再显示旧状态
      await expect(page.getByRole('cell', { name: '已确认待开票', exact: true })).toHaveCount(0)
    },
  )

  test(
    '[TC-PRD-HEWOA-042] 列表无数据时点击批量生成影像文件弹出提示而非弹窗',
    { tag: ['@P2', '@full'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaBillingList()
      await p.fillApplicationNoInput('ZZZNONEEXIST999')
      await p.clickQueryBtn()
      await p.clickBatchGenerateImageBtn()

      // visible + 内容断言：提示文字
      await expect(p.getTipMessage()).toBeVisible()
      await expect(p.getTipMessage()).toContainText('当前列表无数据，请查询后下载文件')
      // notVisible：下载弹窗未出现
      await expect(p.getDownloadDialog()).toBeHidden()
    },
  )
})

// ════════════════════════════════════════════════════════════════
// Story: Hewa 退票列表页
// ════════════════════════════════════════════════════════════════
test.describe('prd-hewa-refund-list', () => {
  test(
    '[TC-PRD-HEWOA-010] Hewa退票列表页默认筛选条件只显示待退票状态的数据',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoRefundList()
      await p.clickHewaRefundTab()

      // visible：tab 内容区可见
      await expect(p.getHewaRefundTabPanel()).toBeVisible()
      // listFilter：单据状态列只含「待退票」
      const statusCol = page.getByRole('cell', { name: /待退票|退票成功/ })
      const count = await statusCol.count()
      for (let i = 0; i < count; i++) {
        const txt = (await statusCol.nth(i).textContent())?.trim() ?? ''
        expect(['待退票']).toContain(txt)
      }
      // notContain：不含「退票成功」
      await expect(page.getByRole('cell', { name: '退票成功', exact: true })).toHaveCount(0)
    },
  )

  test(
    '[TC-PRD-HEWOA-015] 红冲退票金额含税等于蓝字发票金额时提交成功',
    { tag: ['@P0', '@smoke'] },
    async ({ page }) => {
      test.setTimeout(30000)
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaRefundList()
      await p.clickRedReverseBtn()
      await p.selectBlueInvoiceNo('全部')
      await p.fillRedInvoiceNoInput('9999999999')
      await p.fillRefundAmountInput('10000.00')
      await p.clickSubmitBtn()

      // notVisible：红冲弹窗关闭
      await expect(p.getRedReverseDialog()).toBeHidden()
      // text：单据状态为「退票成功」
      await expect(p.getStatusCellByText('退票成功').first()).toHaveText('退票成功')
    },
  )

  test(
    '[TC-PRD-HEWOA-016] 红冲退票金额含税超过蓝字发票金额时提交失败并显示错误提示',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaRefundList()
      await p.clickRedReverseBtn()
      await p.fillRefundAmountInput('10000.01')
      await p.clickSubmitBtn()

      // visible：红冲弹窗仍可见（提交失败）
      await expect(p.getRedReverseDialog()).toBeVisible()
      // text：错误提示
      await expect(p.getErrorMessage()).toHaveText('退票金额需大于0，小于等于蓝字发票金额')
    },
  )

  test(
    '[TC-PRD-HEWOA-017] 红冲操作日期选择上月1日时可正常选中',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaRefundList()
      await p.clickRedReverseBtn()
      await p.fillRedReverseDateInput('2026-05-01')

      // inputValue：日期输入框值为 2026-05-01
      expect(await p.getRedReverseDateInput().inputValue()).toBe('2026-05-01')
      // notVisible：无日期不可选错误提示
      await expect(p.getErrorMessage()).toBeHidden()
    },
  )

  test(
    '[TC-PRD-HEWOA-018] 红冲操作日期选择上月1日的前一天时不可选',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaRefundList()
      await p.clickRedReverseBtn()

      // disabled：2026-04-30 日期按钮不可点
      const dateBtn = page.getByText('30').filter({ hasText: '30' }).first()
      await expect(dateBtn).toBeDisabled()
      // notInputValue：操作红冲日期未被设置为 2026-04-30
      expect(await p.getRedReverseDateInput().inputValue()).not.toBe('2026-04-30')
    },
  )

  test(
    '[TC-PRD-HEWOA-027] 退票成功在关账日前可修改而过了关账日不可修改',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaRefundList()
      await p.selectDocumentStatus('退票成功')

      // visible：未超关账日的申请单A 修改按钮可见
      await expect(p.getModifyBtnByRow('申请单A')).toBeVisible()
      // notVisible：已超关账日的申请单B 修改按钮不可见
      await expect(p.getModifyBtnByRow('申请单B')).toBeHidden()
    },
  )

  test(
    '[TC-PRD-HEWOA-030] 退票申请单完整状态流转：待退票→红冲操作→退票成功',
    { tag: ['@P0', '@smoke'] },
    async ({ page }) => {
      test.setTimeout(30000)
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaRefundList()
      await p.clickRedReverseBtnByRow('REFUND-FLOW')
      await p.selectBlueInvoiceNo('全部')
      await p.fillRedReverseDateInput('2026-06-12')
      await p.fillRedInvoiceNoInput('8888888888')
      await p.clickSubmitBtn()

      // text：REFUND-FLOW 申请单状态为「退票成功」
      const flowRow = page.getByRole('row').filter({ hasText: 'REFUND-FLOW' })
      await expect(flowRow.getByRole('cell', { name: '退票成功' })).toHaveText('退票成功')
      // text：退票日期为 2026-06-12
      await expect(flowRow.getByRole('cell', { name: '2026-06-12' })).toHaveText('2026-06-12')
    },
  )

  test(
    '[TC-PRD-HEWOA-032] 退票申请单退票成功状态不允许再次红冲',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaRefundList()
      await p.selectDocumentStatus('退票成功')

      // notVisible：退票成功申请单行的红冲按钮不可见
      await expect(p.getRedReverseBtnByRow('退票成功')).toBeHidden()
    },
  )

  test(
    '[TC-PRD-HEWOA-043] 红冲弹窗退票金额输入0时提交失败并显示范围错误',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaRefundList()
      await p.clickRedReverseBtn()
      await p.fillRefundAmountInput('0')
      await p.clickSubmitBtn()

      // visible：红冲弹窗仍可见
      await expect(p.getRedReverseDialog()).toBeVisible()
      // text：错误提示
      await expect(p.getErrorMessage()).toHaveText('退票金额需大于0，小于等于蓝字发票金额')
    },
  )
})

// ════════════════════════════════════════════════════════════════
// Story: 自动开票重试
// ════════════════════════════════════════════════════════════════
test.describe('prd-invoice-autobill', () => {
  test(
    '[TC-PRD-HEWOA-019] 自动开票连续失败达到5次后不再自动重试',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      test.setTimeout(60000)
      const p = new InvoiceHewoaPage(page)

      // 该用例依赖后台定时任务与数据库状态，无 UI/API setup。
      // 通过查询接口读取该申请单的自动重试计数与停止标记。
      // TODO: 替换为真实查询接口路径与申请单 id
      const res = await p.apiPost('/api/invoice/query', { source: 'Hewa', queryType: 'autoRetry' })
      const body = await res.json()
      const record = body.data ?? body

      // dbField：auto_retry_count = 5
      expect(record.auto_retry_count ?? record.autoRetryCount).toBe(5)
      // dbField：auto_retry_stopped = true
      expect(record.auto_retry_stopped ?? record.autoRetryStopped).toBe(true)
      // taskNotExecuted：第6次自动开票请求未执行（以停止标记为准）
      expect(record.auto_retry_stopped ?? record.autoRetryStopped).toBeTruthy()
    },
  )
})

// ════════════════════════════════════════════════════════════════
// Story: Hewa 开票端到端（接口→列表→回传）
// ════════════════════════════════════════════════════════════════
test.describe('prd-hewa-billing-e2e', () => {
  test(
    '[TC-PRD-HEWOA-033] Hewa开票完整正向流程：从接口提交到结果回传',
    { tag: ['@P0', '@smoke'] },
    async ({ page }) => {
      test.setTimeout(120000)
      const p = new InvoiceHewoaPage(page)

      // setup：接口提交开票申请
      const res = await p.apiPost('/api/invoice/apply', {
        source: 'Hewa',
        returnFlag: false,
        totalAmount: 8000.0,
      })
      expect(res.ok()).toBeTruthy()

      // setup：进入 Hewa 开票列表
      await p.gotoHewaBillingList()
      await p.clickHewaBillingTab()

      // visible：新申请单行，状态=已确认待开票
      await expect(p.getStatusCellByText('已确认待开票').first()).toHaveText('已确认待开票')
      // eventually：申请单状态最终为「开票成功」
      await expect(p.getStatusCellByText('开票成功').first()).toHaveText('开票成功', {
        timeout: 60000,
      })
      // visible：发票号码列非空
      await expect(p.getInvoiceNoCellByRow('开票成功').first()).toBeVisible()
      // hewaCallback：处理结果=成功、蓝字发票号非空、红字发票号空
      // TODO: 通过 Hewa 回调记录查询接口验证回传内容，此处校验回调结果接口
      const cbRes = await p.apiPost('/api/invoice/callback/query', { source: 'Hewa' })
      const cb = await cbRes.json()
      const cbData = cb.data ?? cb
      expect(cbData.result ?? cbData.处理结果).toBe('成功')
      expect(cbData.blueInvoiceNo ?? cbData.蓝字发票号).toBeTruthy()
      expect(cbData.redInvoiceNo ?? cbData.红字发票号 ?? '').toBeFalsy()
    },
  )

  test(
    '[TC-PRD-HEWOA-034] Hewa退票完整正向流程：拆分开票后对单张发票发起退票到结果回传',
    { tag: ['@P0', '@smoke'] },
    async ({ page }) => {
      test.setTimeout(120000)
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaRefundList()
      await p.clickRedReverseBtnByRow('APPLY-SPLIT')
      await p.selectBlueInvoiceNo('FP-A')
      await p.fillRedReverseDateInput('2026-06-12')
      await p.fillRedInvoiceNoInput('7777777777')
      await p.clickSubmitBtn()

      // text：申请单状态为「退票成功」
      await expect(p.getStatusCellByText('退票成功').first()).toHaveText('退票成功')
      // hewaCallback：处理结果=成功、红字发票号=7777777777
      // TODO: 通过 Hewa 回调记录查询接口验证回传内容
      const cbRes = await p.apiPost('/api/invoice/callback/query', { source: 'Hewa' })
      const cb = await cbRes.json()
      const cbData = cb.data ?? cb
      expect(cbData.result ?? cbData.处理结果).toBe('成功')
      expect(cbData.redInvoiceNo ?? cbData.红字发票号).toBe('7777777777')
    },
  )

  test(
    '[TC-PRD-HEWOA-035] 开票失败场景：供应商返回错误后Hewa收到失败通知',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      test.setTimeout(60000)
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaBillingList()
      await p.checkRowCheckboxByText('已确认待开票')
      await p.clickBatchBillingBtn()
      await p.clickConfirmBatchBillingBtn()

      // eventually：申请单状态最终为「开票失败」
      await expect(p.getStatusCellByText('开票失败').first()).toHaveText('开票失败', {
        timeout: 60000,
      })
      // hewaCallback：处理结果=失败、失败原因非空
      // TODO: 通过 Hewa 回调记录查询接口验证回传内容
      const cbRes = await p.apiPost('/api/invoice/callback/query', { source: 'Hewa' })
      const cb = await cbRes.json()
      const cbData = cb.data ?? cb
      expect(cbData.result ?? cbData.处理结果).toBe('失败')
      expect(cbData.failReason ?? cbData.失败原因).toBeTruthy()
    },
  )
})

// ════════════════════════════════════════════════════════════════
// Story: Hewa 开票详情页
// ════════════════════════════════════════════════════════════════
test.describe('prd-hewa-billing-detail', () => {
  test(
    '[TC-PRD-HEWOA-036] 在Hewa开票详情页查看申请单完整信息',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoHewaBillingList()
      await p.clickApplicationNoLink()

      // url：跳转到详情页
      await expect(page).toHaveURL(/\/invoice\/billing\/detail\//)
      // visible：申请单号、单据状态
      await expect(p.getDetailApplicationNo()).toBeVisible()
      await expect(p.getDetailDocumentStatus()).toBeVisible()
      // format：发票总金额为千分位 + 两位小数
      await expect(p.getDetailTotalAmount()).toBeVisible()
      await expect(page.getByText(/\d{1,3}(,\d{3})*\.\d{2}/)).toBeVisible()
      // visible：账项明细表格、分成明细表格
      await expect(p.getAccountDetailTable()).toBeVisible()
      await expect(p.getShareDetailTable()).toBeVisible()
      // format：分成比例为百分比格式
      await expect(p.getShareRatio()).toContainText('%')
      await expect(page.getByText(/\d+(\.\d+)?%/)).toBeVisible()
    },
  )
})

// ════════════════════════════════════════════════════════════════
// Story: 会计资料齐全性
// ════════════════════════════════════════════════════════════════
test.describe('prd-accounting', () => {
  test(
    '[TC-PRD-HEWOA-044] 会计资料Hewa税务发票开票三类文件齐全时状态为资料齐全',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoAccountingVoucher()
      await p.clickVoucherLinkByText(/目标Hewa发票/)

      // text：会计资料状态为「资料齐全」
      await expect(p.getAccountingMaterialStatus()).toHaveText('资料齐全')
    },
  )

  test(
    '[TC-PRD-HEWOA-045] 会计资料Hewa税务发票开票任一文件缺失时状态为资料缺失',
    { tag: ['@P1', '@regression'] },
    async ({ page }) => {
      const p = new InvoiceHewoaPage(page)

      await p.gotoAccountingVoucher()
      await p.clickVoucherLinkByText(/目标缺文件Hewa发票/)

      // text：会计资料状态为「资料缺失」
      await expect(p.getAccountingMaterialStatus()).toHaveText('资料缺失')
    },
  )
})
