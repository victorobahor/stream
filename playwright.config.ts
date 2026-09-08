import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'https://stream.vicktalk.online';

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/local/**',
  outputDir: 'test-results/live',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { outputFolder: 'playwright-report/live', open: 'never' }]] : [['list'], ['html', { outputFolder: 'playwright-report/live', open: 'never' }]],
  timeout: 180_000,
  expect: { timeout: 20_000 },
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL,
    navigationTimeout: 90_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
