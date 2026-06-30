// 登录认证 Setup — 缓存 storageState 供所有 e2e 测试复用
// 依赖 .env 中 E2E_TEST_EMAIL / E2E_TEST_PASSWORD / APP_URL

import { test as setup, expect } from '@playwright/test'
import path from 'path'

const authFile = path.resolve('playwright/.auth/user.json')

setup('登录 FIS 系统并缓存认证状态', async ({ page }) => {
  // 1. 导航到登录页
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: /欢迎登录FIS系统/i })).toBeVisible()

  // 2. 填写账号
  await page.getByPlaceholder('请输入账号').fill(process.env.E2E_TEST_EMAIL ?? '')

  // 3. 填写密码
  await page.getByPlaceholder('请输入密码').fill(process.env.E2E_TEST_PASSWORD ?? '')

  // 4. 点击登录
  await page.getByRole('button', { name: /登\s*录/i }).click()

  // 5. 等待登录完成（跳转离开 /login）
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

  // 6. 保存 storageState（cookies + localStorage）
  await page.context().storageState({ path: authFile })
})
