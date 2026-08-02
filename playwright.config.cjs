const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  // I test di stampa, foto e multi-viewport condividono risorse browser
  // intensive: nello stesso file devono restare seriali per evitare timeout
  // dovuti alla saturazione, non a regressioni dell'app.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium-desktop',
      testIgnore: '**/pwa.spec.cjs',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'chromium-tablet',
      testIgnore: '**/pwa.spec.cjs',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        hasTouch: true
      }
    },
    {
      name: 'chromium-small-phone',
      testIgnore: '**/pwa.spec.cjs',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 320, height: 700 }
      }
    },
    {
      name: 'chromium-mobile',
      testIgnore: '**/pwa.spec.cjs',
      use: { ...devices['Pixel 7'] }
    },
    {
      name: 'chromium-pwa',
      testMatch: '**/pwa.spec.cjs',
      use: {
        ...devices['Desktop Chrome'],
        serviceWorkers: 'allow'
      }
    }
  ],
  webServer: {
    command: 'node tests/serve.cjs',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 15000
  }
});
