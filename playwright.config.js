// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * 読み取り専用の公開画面（GitHub Pages）を対象にしたテスト設定。
 * 運営ログインや書き込みを伴うテストは含まない。
 */
module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'https://konkora780-ux.github.io/taikai-base/',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
