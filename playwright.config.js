import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5174', channel: 'msedge', headless: true },
});
