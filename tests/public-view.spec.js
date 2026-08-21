// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 公開画面（ログイン不要）の読み取り専用テスト。
 * 本番データに依存しすぎないよう、内容の詳細ではなく
 * 「壊れずに表示される」ことだけを確認する。
 */

test('トップページが表示され、JSエラーが出ない', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');
  await expect(page).toHaveTitle(/大会ベース/);

  // アプリ本体は #app に描画される（空のままなら初期化失敗）
  const app = page.locator('#app');
  await expect(app).not.toBeEmpty({ timeout: 15000 });

  // Supabase読み込み失敗バナーが出ていないこと
  await expect(page.locator('.sb-fail-banner')).toHaveCount(0);

  expect(errors, `コンソールエラー: ${errors.join('\n')}`).toEqual([]);
});

test('Supabaseライブラリが読み込まれている', async ({ page }) => {
  await page.goto('/');
  const loaded = await page.evaluate(() => typeof window.supabase !== 'undefined');
  expect(loaded).toBe(true);
});
