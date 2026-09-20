import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: [
    {
      command: 'npm run dev:api',
      url: 'http://localhost:3002/api/health',
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: 'npm run dev:web -- --port 5174',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
