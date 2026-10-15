import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './e2e', testMatch: '**/*.pw.ts', webServer: {
  command: 'pnpm dev', port: 5173, reuseExistingServer: !process.env.CI,
}, use: {
  baseURL: 'http://127.0.0.1:5173', browserName: 'chromium',
  launchOptions: process.env.ALEXANDRIA_CHROME ? { executablePath: process.env.ALEXANDRIA_CHROME } : {},
} });
