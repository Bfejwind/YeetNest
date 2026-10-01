import { test, expect } from '@playwright/test';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

test('live candles render and creator studio is usable on desktop and mobile', async ({ page }) => {
  const mint = Keypair.generate().publicKey.toBase58();
  await page.route('**/api/tokens*', r => r.fulfill({ json: [{ id: mint, name: 'Live Yeet', symbol: 'YEET', decimals: 9, usdPrice: 1 }] }));
  await page.route('**/api/launches', r => r.fulfill({ json: [] }));
  await page.route('**/api/market/*', r => r.fulfill({ json: { pair: { pairAddress: mint, priceUsd: '1', dexId: 'raydium', liquidity: { usd: 25000 }, txns: { h24: { buys: 3, sells: 2 } } }, candles: Array.from({ length: 20 }, (_, i) => [1700000000 + i * 3600, 1 + i / 100, 1.1 + i / 100, .9 + i / 100, 1.02 + i / 100, 100]) } }));
  await page.goto('/');
  await page.locator('[data-mode="live"]').click();
  await page.locator('.coin').first().click();
  await expect(page.locator('#token-chart canvas').first()).toBeVisible();
  expect(await page.locator('#token-chart canvas').first().evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 === 3 && value > 0);
  })).toBe(true);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator('#token-chart').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `yeetnest-chart-${width}.png` });
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Creator Studio', exact: true }).click();
  await expect(page.locator('.content')).toContainText('CREATOR STUDIO');
  await expect(page.locator('.studio-coin')).toHaveCount(0);
});

test('creator artwork persists, can be changed, and demo funds are accounted for', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page).toHaveTitle(/YeetNest/);
  await expect(page.locator('.coin')).toHaveCount(8);
  await page.locator('#wallet').click(); await page.locator('#demo').click();
  await page.locator('[data-launch]').first().click();
  const picture = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const ctx = c.getContext('2d'); ctx.fillStyle = '#ed5943'; ctx.fillRect(0,0,64,64); return c.toDataURL('image/png').split(',')[1]; });
  await page.locator('#coin-image').setInputFiles({ name: 'creator.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await expect(page.locator('#upload-preview img')).toBeVisible();
  await page.locator('[name=name]').fill('My Yeet Coin'); await page.locator('[name=ticker]').fill('YEET');
  await page.locator('[name=description]').fill('<b>A creator-owned image</b>');
  await page.locator('#launch-form [type=submit]').click();
  await expect(page.locator('.coin').first()).toContainText('My Yeet Coin');
  const uploaded = await page.locator('.coin').first().locator('img').getAttribute('src');
  expect(uploaded).toMatch(/^data:image\/png/);
  await page.reload(); await page.locator('[data-tab="New pairs"]').click();
  await expect(page.locator('.coin').first().locator('img')).toHaveAttribute('src', uploaded);
  await page.locator('.coin').first().click(); await expect(page.locator('.coin-description')).toHaveText('<b>A creator-owned image</b>');
  await page.locator('#edit-art').click();
  await page.locator('#coin-image').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await expect(page.locator('#upload-preview img')).toBeVisible(); await page.locator('#image-form [type=submit]').click();
  await page.locator('#wallet').click(); await page.locator('#demo').click();
  await page.locator('.coin').first().click(); await page.locator('[name=amount]').fill('11'); await page.locator('#trade-submit').click();
  await expect(page.locator('#form-error')).toContainText('Insufficient demo SOL');
  await page.locator('[name=amount]').fill('1'); await page.locator('#trade-submit').click();
  await expect(page.locator('#wallet')).toContainText('9.00 SOL');
  await page.locator('[data-page="Portfolio"]').click(); await expect(page.locator('.coin')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('responsive views, provider failure, and parity disclosure', async ({ page }) => {
  await page.route('**/api/tokens*', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Provider unavailable for test' }) }));
  await page.goto('/');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: 'yeetnest-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'yeetnest-mobile.png', fullPage: true });
  await page.locator('[data-mode="live"]').click();
  await expect(page.locator('.notice.error')).toContainText('Provider unavailable for test');
  await expect(page.locator('.coin')).toHaveCount(0);
  await page.locator('#wallet').click(); await page.locator('[data-wallet="Phantom"]').click();
  await expect(page.locator('#form-error')).toContainText('not installed');
  await page.keyboard.press('Escape'); await page.locator('[data-page="Integrations"]').click();
  await expect(page.locator('.parity')).toContainText('Holder rewards');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'yeetnest-integrations-mobile.png', fullPage: true });
});

test('live wallet review requires explicit signing and reports provider failure accurately', async ({ page }) => {
  const wallet = Keypair.generate(), mint = Keypair.generate().publicKey.toBase58();
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message());
  await page.addInitScript(address => {
    window.__signatures = 0;
    window.phantom = { solana: { publicKey: { toString: () => address }, connect: async () => ({ publicKey: { toString: () => address } }), signTransaction: async transaction => { window.__signatures++; return transaction; }, on: () => {} } };
  }, wallet.publicKey.toBase58());
  await page.route('**/api/tokens*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: mint, name: 'Live Test Token', symbol: 'LIVE', decimals: 6, mcap: 12345, stats24h: { priceChange: 2, buyVolume: 30, sellVolume: 20 } }]) }));
  await page.route('**/api/rpc', async r => {
    const { method, id } = r.request().postDataJSON();
    const result = method === 'getGenesisHash' ? '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' : method === 'getBalance' ? { context: { slot: 1 }, value: 1000000000 } : { context: { slot: 1 }, value: [] };
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id, result }) });
  });
  await page.route('**/api/swap/order*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ requestId: 'test', transaction: Buffer.from(tx.serialize()).toString('base64'), outAmount: '1000000', router: 'metis', feeBps: 10 }) }));
  let executions = 0;
  await page.route('**/api/swap/execute', r => { executions++; return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'Failed', error: 'Test transaction rejected' }) }); });
  await page.goto('/'); await page.locator('[data-mode="live"]').click();
  await expect(page.locator('.coin')).toHaveCount(1);
  await page.locator('#wallet').click(); await page.locator('[data-wallet="Phantom"]').click();
  await expect(page.locator('#wallet')).toContainText(wallet.publicKey.toBase58().slice(0, 4));
  await page.locator('.coin').click(); await page.locator('[name=amount]').fill('0.1'); await page.locator('#trade-submit').click();
  await expect(page.locator('.trade-review')).toContainText('1 LIVE');
  expect(executions).toBe(0); expect(await page.evaluate(() => window.__signatures)).toBe(0);
  await page.locator('#sign-trade').click();
  await expect(page.locator('#form-error')).toContainText('Test transaction rejected');
  expect(executions).toBe(1); expect(await page.evaluate(() => window.__signatures)).toBe(1);
  await expect(page.locator('#sign-trade')).toBeDisabled();
  await expect(page.locator('.success-mark')).toHaveCount(0);
});
