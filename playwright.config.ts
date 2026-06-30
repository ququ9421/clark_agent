import { defineConfig } from '@playwright/test'
import dotenv from 'dotenv'
dotenv.config()

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './tests/e2e/specs',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  forbidOnly: isCI,
  reporter: [
    ['json', { outputFile: 'tests/reports/playwright-results.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? process.env.APP_URL ?? 'https://fistest.ciwork.cn',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  projects: process.env.E2E_TEST_EMAIL
    ? [
        // 登录 setup：执行两段式 SSO 登录并缓存 storageState
        { name: 'setup', testMatch: /auth\.setup\.ts/ },
        {
          name: 'e2e',
          testIgnore: /auth\.setup\.ts/,
          dependencies: ['setup'],
          use: { storageState: 'playwright/.auth/user.json' },
        },
      ]
    : [{ name: 'e2e', testIgnore: /auth\.setup\.ts/ }],
})
