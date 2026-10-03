import { defineConfig } from '@playwright/test';
const viewerURL = process.env.VIEWER_URL;
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: viewerURL || 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 1000 },
    trace: 'off',
    screenshot: 'off',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
    },
  },
  webServer: viewerURL
    ? undefined
    : {
        command:
          process.env.VIEWER_DEV === '1'
            ? 'npm run dev -- --port 4173'
            : 'npm run build && npm run preview -- --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
