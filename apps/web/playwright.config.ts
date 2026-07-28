import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
    {
      name: 'tablet',
      use: { ...devices['iPad Mini'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_ALLOW_TEST_CONTRACTS: 'true',
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001',
      NEXT_PUBLIC_MOCK_KRW_ADDRESS: '0x1000000000000000000000000000000000000001',
      NEXT_PUBLIC_MOCK_USDC_ADDRESS: '0x2000000000000000000000000000000000000002',
      NEXT_PUBLIC_MOCK_ALT_ADDRESS: '0x3000000000000000000000000000000000000003',
    },
  },
});
