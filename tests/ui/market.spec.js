import { test, expect } from '@playwright/test';
import { Keypair } from '@solana/web3.js';

test('live community signs in explicitly and uses shared endpoints', async ({ page }) => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(address => {
    window.__communitySignatures = 0;
    window.phantom = { solana: {
      connect: async () => ({ publicKey: { toString: () => address } }),
      signMessage: async () => { window.__communitySignatures++; return { signature: new Uint8Array(64) }; },
      on: () => {},
    } };
  }, wallet);
  const fulfill = (route, value) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
  await page.route('**/api/tokens*', route => fulfill(route, [{ id: mint, name: 'Shared Token', symbol: 'SHARED', decimals: 6 }]));
  await page.route('**/api/rpc', route => {
    const { method, id } = route.request().postDataJSON();
    const result = method === 'getGenesisHash' ? '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' : method === 'getBalance' ? { context: { slot: 1 }, value: 1000000000 } : { context: { slot: 1 }, value: [] };
    return fulfill(route, { jsonrpc: '2.0', id, result });
  });
  await page.route('**/api/auth/challenge', route => fulfill(route, { nonce: 'test', message: 'Test sign-in' }));
  await page.route('**/api/auth/verify', route => fulfill(route, { token: 'controlled-test-session' }));
  await page.route('**/api/community/profiles/*', route => fulfill(route, { wallet, name: 'Shared Creator', bio: 'Existing profile' }));
  let saved;
  await page.route('**/api/community/profile', route => {
    expect(route.request().headers().authorization).toBe('Bearer controlled-test-session');
    saved = route.request().postDataJSON();
    return fulfill(route, { wallet, ...saved });
  });
  let posts = [];
  await page.route('**/api/community/coins/*/comments', route => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers().authorization).toBe('Bearer controlled-test-session');
      posts = [{ id: '11111111-1111-4111-8111-111111111111', wallet, author: saved.name, body: route.request().postDataJSON().body, created: Date.now() }];
      return fulfill(route, posts[0]);
    }
    return fulfill(route, posts);
  });
  await page.route('**/api/community/comments/*', route => { posts = []; return fulfill(route, { deleted: true }); });
  await page.goto('/');
  await page.locator('[data-mode="live"]').click();
  await page.locator('#wallet').click();
  await page.locator('[data-wallet="Phantom"]').click();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Display name')).toHaveValue('Shared Creator');
  expect(await page.evaluate(() => window.__communitySignatures)).toBe(0);
  await page.getByLabel('Display name').fill('Updated Creator');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.locator('#toast')).toContainText('Profile saved.');
  expect(saved.name).toBe('Updated Creator');
  expect(await page.evaluate(() => window.__communitySignatures)).toBe(1);
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await page.locator('.coin').first().click();
  await page.getByLabel('Comment', { exact: true }).fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.locator('.discussion-post p')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.discussion-post img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete your comment' }).click();
  await expect(page.locator('.discussion-post')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('market board, leaderboard, profile and local discussion work without pretending shared state', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.locator('.terminal-column')).toHaveCount(3);
  await expect(page.locator('.terminal-coin')).toHaveCount(8);
  await page.getByLabel('Search terminal').fill('Corporate Cat');
  await expect(page.locator('.terminal-coin')).toHaveCount(1);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: 'yeetnest-terminal-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  await expect(page.locator('.ranking-row')).toHaveCount(8);
  await page.getByLabel('Rank tokens').selectOption('cap');
  await expect(page.locator('.ranking-row').first()).toContainText('Corporate Cat');
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByLabel('Display name').fill('Yeet Tester');
  await page.getByLabel('Bio').fill('<script>not HTML</script>');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Display name')).toHaveValue('Yeet Tester');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await page.locator('.coin').first().click();
  await expect(page.locator('.discussion')).toContainText('Browser-local demo');
  await page.getByLabel('Comment', { exact: true }).fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.locator('.discussion-post p')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.discussion-post strong')).toHaveText('Yeet Tester');
  await expect(page.locator('.discussion-post img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Report comment', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('No moderation service');
  await page.getByRole('button', { name: 'Delete local comment', exact: true }).click();
  await expect(page.locator('.discussion-post')).toHaveCount(0);
  expect(errors).toEqual([]);
});
