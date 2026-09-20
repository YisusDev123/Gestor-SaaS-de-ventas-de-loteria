import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chromiumLaunchOptions = existsSync(chrome) ? { executablePath: chrome } : undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:3000/login',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: 'chromium-escritorio', use: { browserName: 'chromium', launchOptions: chromiumLaunchOptions, viewport: { width: 1440, height: 1000 } } },
    { name: 'chromium-android', use: { browserName: 'chromium', launchOptions: chromiumLaunchOptions, viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
    { name: 'firefox-smoke', use: { browserName: 'firefox', viewport: { width: 1280, height: 900 } } },
  ],
});
