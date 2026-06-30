import { type Page, type Locator, type APIResponse } from '@playwright/test'

// ── Hewa 发票开票/退票 Page Object ───────────────────────────────
// 由 playwright-script-generator 从 playwright-handoff-invoice-hewoa.json 生成
// 覆盖：发票申请 API、撤回 API、开票列表、退票列表、详情页、会计资料
export class InvoiceHewoaPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  // ── 导航 ──────────────────────────────────────────────────────
  /** 进入开票列表页（默认筛选） /invoice/billing */
  async gotoBillingList() {
    await this.page.goto('/invoice/billing')
  }

  /** 进入退票列表页（默认筛选） /invoice/refund */
  async gotoRefundList() {
    await this.page.goto('/invoice/refund')
  }

  /** 进入 Hewa 开票列表页 /invoice/billing/hewa */
  async gotoHewaBillingList() {
    await this.page.goto('/invoice/billing/hewa')
  }

  /** 进入 Hewa 退票列表页 /invoice/refund/hewa */
  async gotoHewaRefundList() {
    await this.page.goto('/invoice/refund/hewa')
  }

  /** 进入会计凭证/资料页 /accounting/voucher */
  async gotoAccountingVoucher() {
    await this.page.goto('/accounting/voucher')
  }

  // ── API 操作 ──────────────────────────────────────────────────
  /** 发送发票申请/撤回类 POST 请求 */
  async apiPost(endpoint: string, body: Record<string, unknown>): Promise<APIResponse> {
    return await this.page.request.post(endpoint, { data: body })
  }

  /** 并发发送相同 POST 请求（用于幂等/防重校验），返回所有响应 */
  async concurrentApiPost(
    endpoint: string,
    body: Record<string, unknown>,
    concurrency: number,
  ): Promise<APIResponse[]> {
    const tasks = Array.from({ length: concurrency }, () =>
      this.page.request.post(endpoint, { data: body }),
    )
    return await Promise.all(tasks)
  }

  // ── Tab 操作 ──────────────────────────────────────────────────
  /** 点击「Hewa开票」tab */
  async clickHewaBillingTab() {
    await this.page.getByRole('tab', { name: /Hewa开票/i }).click()
  }

  /** 点击「Hewa退票」tab */
  async clickHewaRefundTab() {
    await this.page.getByRole('tab', { name: /Hewa退票/i }).click()
  }

  // ── 查询区操作 ────────────────────────────────────────────────
  /** 填写申请单号查询框 */
  async fillApplicationNoInput(value: string) {
    await this.page.getByPlaceholder(/请输入申请单号/i).fill(value)
  }

  /** 填写业务类型描述查询框 */
  async fillBusinessTypeDescInput(value: string) {
    await this.page.getByPlaceholder(/请输入业务类型描述/i).fill(value)
  }

  /** 填写发票号码查询框 */
  async fillInvoiceNoInput(value: string) {
    await this.page.getByPlaceholder(/请输入发票号码/i).fill(value)
  }

  /** 点击「查询」按钮 */
  async clickQueryBtn() {
    await this.page.getByRole('button', { name: /查询/i }).click()
  }

  /** 选择「单据状态」下拉项 */
  async selectDocumentStatus(value: string) {
    await this.page.getByLabel(/单据状态/i).selectOption(value)
  }

  // ── 列表行选择 ────────────────────────────────────────────────
  /** 勾选指定文本所在行的复选框 */
  async checkRowCheckboxByText(rowText: string) {
    await this.page
      .getByRole('row')
      .filter({ hasText: rowText })
      .first()
      .getByRole('checkbox')
      .check()
  }

  /** 勾选「影像文件」复选框 */
  async checkImageFileOption() {
    await this.page.getByLabel(/影像文件/i).check()
  }

  /** 勾选「PDF」复选框 */
  async checkPdfOption() {
    await this.page.getByLabel('PDF').check()
  }

  // ── 列表/弹窗按钮 ─────────────────────────────────────────────
  /** 点击「批量生成影像文件」按钮 */
  async clickBatchGenerateImageBtn() {
    await this.page.getByRole('button', { name: /批量生成影像文件/i }).click()
  }

  /** 点击「下载」按钮 */
  async clickDownloadBtn() {
    await this.page.getByRole('button', { name: /下载/i }).click()
  }

  /** 点击「批量开票」按钮 */
  async clickBatchBillingBtn() {
    await this.page.getByRole('button', { name: /批量开票/i }).click()
  }

  /** 点击「确认批量开票」按钮 */
  async clickConfirmBatchBillingBtn() {
    await this.page.getByRole('button', { name: /确认批量开票/i }).click()
  }

  /** 点击行内「红冲」按钮（默认第一行） */
  async clickRedReverseBtn() {
    await this.page.getByRole('button', { name: /红冲/i }).first().click()
  }

  /** 点击指定文本所在行的「红冲」按钮 */
  async clickRedReverseBtnByRow(rowText: string) {
    await this.page
      .getByRole('row')
      .filter({ hasText: rowText })
      .getByRole('button', { name: /红冲/i })
      .click()
  }

  /** 点击「提交」按钮 */
  async clickSubmitBtn() {
    await this.page.getByRole('button', { name: /提交/i }).click()
  }

  /** 点击申请单号链接（详情入口，默认第一条以 APPLY 开头） */
  async clickApplicationNoLink() {
    await this.page
      .getByRole('link')
      .filter({ hasText: /^APPLY/ })
      .first()
      .click()
  }

  /** 点击指定文本的凭证/发票链接 */
  async clickVoucherLinkByText(text: string | RegExp) {
    await this.page.getByRole('link').filter({ hasText: text }).first().click()
  }

  // ── 红冲弹窗字段 ──────────────────────────────────────────────
  /** 选择「蓝字发票号码」下拉项 */
  async selectBlueInvoiceNo(value: string) {
    await this.page.getByLabel(/蓝字发票号码/i).selectOption(value)
  }

  /** 填写「红字发票号码」 */
  async fillRedInvoiceNoInput(value: string) {
    await this.page.getByLabel(/红字发票号码/i).fill(value)
  }

  /** 填写「退票金额」 */
  async fillRefundAmountInput(value: string) {
    await this.page.getByLabel(/退票金额/i).fill(value)
  }

  /** 填写「操作红冲日期」 */
  async fillRedReverseDateInput(value: string) {
    await this.page.getByLabel(/操作红冲日期/i).fill(value)
  }

  /** 刷新当前页面 */
  async reloadPage() {
    await this.page.reload()
  }

  // ── Getter（断言定位器）───────────────────────────────────────
  /** Hewa开票 tab 内容区 */
  getHewaBillingTabPanel(): Locator {
    return this.page.getByRole('tabpanel')
  }

  /** Hewa退票 tab 内容区 */
  getHewaRefundTabPanel(): Locator {
    return this.page.getByRole('tabpanel')
  }

  /** 单据状态列单元格集合 */
  getDocumentStatusCells(): Locator {
    return this.page.getByRole('cell', { name: /待确认|已确认待开票|开票中|开票成功|开票失败|待退票|退票成功/ })
  }

  /** 查询结果区域（表格） */
  getQueryResultArea(): Locator {
    return this.page.getByRole('table')
  }

  /** 申请单号输入框 */
  getApplicationNoInput(): Locator {
    return this.page.getByPlaceholder(/请输入申请单号/i)
  }

  /** 红冲弹窗 */
  getRedReverseDialog(): Locator {
    return this.page.getByRole('dialog')
  }

  /** 操作红冲日期输入框 */
  getRedReverseDateInput(): Locator {
    return this.page.getByLabel(/操作红冲日期/i)
  }

  /** 退票金额输入框 */
  getRefundAmountInput(): Locator {
    return this.page.getByLabel(/退票金额/i)
  }

  /** 通用错误提示（toast / 表单错误） */
  getErrorMessage(): Locator {
    return this.page.getByRole('alert')
  }

  /** 通用单据状态文本（按状态文本定位单元格） */
  getStatusCellByText(text: string): Locator {
    return this.page.getByRole('cell', { name: text, exact: false })
  }

  /** 批量开票按钮 */
  getBatchBillingBtn(): Locator {
    return this.page.getByRole('button', { name: /批量开票/i })
  }

  /** 行内修改按钮（按行文本定位） */
  getModifyBtnByRow(rowText: string): Locator {
    return this.page
      .getByRole('row')
      .filter({ hasText: rowText })
      .getByRole('button', { name: /修改/i })
  }

  /** 行内红冲按钮（按行文本定位） */
  getRedReverseBtnByRow(rowText: string): Locator {
    return this.page
      .getByRole('row')
      .filter({ hasText: rowText })
      .getByRole('button', { name: /红冲/i })
  }

  /** 发票号码列单元格（按行文本定位） */
  getInvoiceNoCellByRow(rowText: string): Locator {
    return this.page
      .getByRole('row')
      .filter({ hasText: rowText })
      .getByRole('cell')
      .filter({ hasText: /\d/ })
  }

  /** 下载弹窗 */
  getDownloadDialog(): Locator {
    return this.page.getByRole('dialog')
  }

  /** 提示文字（无数据等场景） */
  getTipMessage(): Locator {
    return this.page.getByRole('alert')
  }

  /** 详情页申请单号字段 */
  getDetailApplicationNo(): Locator {
    return this.page.getByText(/申请单号/i)
  }

  /** 详情页单据状态字段 */
  getDetailDocumentStatus(): Locator {
    return this.page.getByText(/单据状态/i)
  }

  /** 详情页发票总金额字段 */
  getDetailTotalAmount(): Locator {
    return this.page.getByText(/发票总金额/i)
  }

  /** 详情页账项明细表格 */
  getAccountDetailTable(): Locator {
    return this.page.getByRole('table').filter({ hasText: /账项明细/i })
  }

  /** 详情页分成明细表格 */
  getShareDetailTable(): Locator {
    return this.page.getByRole('table').filter({ hasText: /分成明细/i })
  }

  /** 详情页分成比例字段 */
  getShareRatio(): Locator {
    return this.page.getByText(/%/).first()
  }

  /** 会计资料状态字段 */
  getAccountingMaterialStatus(): Locator {
    return this.page.getByText(/资料齐全|资料缺失/).first()
  }
}
