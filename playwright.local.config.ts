import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/local',
  globalSetup: './e2e/local/setup.ts',
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/local',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/local', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3101',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'PORT=3101 npm start',
    url: 'http://127.0.0.1:3101',
    reuseExistingServer: false,
  },
});
