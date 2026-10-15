import { defineConfig, devices } from '@playwright/test';
import process from 'node:process';

const bdw_port = Number(process.env.E2E_WEB_PORT || 5174);
const bd_port = Number(process.env.E2E_API_PORT || 3001);

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.js',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: `http://127.0.0.1:${bdw_port}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `node e2e/support/start-server.js --flavour bdw --port ${bdw_port}`,
      url: `http://127.0.0.1:${bdw_port}/`,
      reuseExistingServer: false
    },
    {
      command: `node e2e/support/start-server.js --flavour bd --port ${bd_port}`,
      url: `http://127.0.0.1:${bd_port}/`,
      reuseExistingServer: false
    }
  ]
});
