import { defineConfig, devices } from '@playwright/test'
import path from 'path'

/**
 * Playwright Config for StyleSnap Extension Tests
 * Loads the extension from dist/ and runs tests in Chromium.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,   // Extensions need sequential execution
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,               // Single worker for extension tests
  reporter: [['list']],

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium-extension',
      use: {
        ...devices['Desktop Chrome'],
        headless: false,   // Extensions are easier to debug in headed mode
        launchOptions: {
          args: [
            `--load-extension=${path.join(__dirname, 'dist')}`,
            '--disable-extensions-except=' + path.join(__dirname, 'dist'),
          ],
        },
      },
    },
  ],
})
