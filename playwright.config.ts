import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a production build (`next build` first).
 * The global setup recreates the e2e database and seeds the invented demo org.
 * Tests run serially because the golden path closes the day at Demo Pune.
 */
// E2E_PORT lets two checkouts run their suites side by side without fighting over a port.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const DB = process.env.DATABASE_URL_E2E ?? 'postgresql://postgres@localhost:5432/chairside_e2e';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    // E2E_SERVER_LOG=1 shows the app's own output, including the [action] timing lines (T17).
    stdout: process.env.E2E_SERVER_LOG ? 'pipe' : 'ignore',
    timeout: 60_000,
    env: { DATABASE_URL: DB, INSECURE_COOKIES: '1', NODE_ENV: 'production' },
  },
});
