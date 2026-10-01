import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  use: { baseURL: 'http://localhost:5174', channel: 'msedge', headless: true },
});
