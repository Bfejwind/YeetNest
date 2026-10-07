import { test, expect } from '@playwright/test';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { PNG } from 'pngjs';

async function openLiveLaunch(page, pendingSignIn = false) {
  const wallet = Keypair.generate().publicKey.toBase58();
  await page.addInitScript(({ wallet, pendingSignIn }) => {
    window.phantom = { solana: {
      connect: async () => ({ publicKey: { toString: () => wallet } }),
      signMessage: () => pendingSignIn ? new Promise(resolve => { window.__lateSignIn = resolve; }) : Promise.resolve({ signature: new Uint8Array(64) }),
      on: () => {},
    } };
  }, { wallet, pendingSignIn });
  await page.route('**/api/status', r => r.fulfill({ json: { network: 'mainnet-beta', uploads: true } }));
  await page.route('**/api/tokens*', r => r.fulfill({ json: [] }));
  await page.route('**/api/launches*', r => r.fulfill({ json: [] }));
  await page.route('**/api/auth/challenge', r => r.fulfill({ json: { nonce: 'controlled', message: 'Controlled sign-in' } }));
  await page.route('**/api/auth/verify', r => r.fulfill({ json: { token: 'controlled-session' } }));
  await page.goto('/');
  await page.locator('[data-mode="live"]').click();
  await page.locator('#wallet').click();
  await page.locator('[data-wallet="Phantom"]').click();
  await page.locator('header').getByRole('button', { name: /Connect wallet/ }).waitFor({ state: 'hidden' });
  await page.locator('[data-launch]').first().click();
  await page.getByLabel('Coin name').fill('Timeout Test');
  await page.getByLabel('Ticker', { exact: true }).fill('TIME');
  await page.locator('#coin-image').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: PNG.sync.write({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) }) });
  await expect(page.locator('#upload-preview img')).toBeVisible();
}

test('live launch identifies stalled sign-in and restores preparation without uploading', async ({ page }) => {
  let uploads = 0;
  await page.route('**/api/metadata', r => { uploads++; return r.fulfill({ json: {} }); });
  await page.route('**/api/rpc', r => r.fulfill({ json: { jsonrpc: '2.0', id: r.request().postDataJSON().id, result: { context: { slot: 1 }, value: [] } } }));
  await openLiveLaunch(page, true);
  await page.clock.install();
  await page.getByRole('button', { name: 'Prepare live launch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Waiting for wallet sign-in...' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__lateSignIn)).toBe('function');
  await page.clock.fastForward(61000);
  await expect(page.locator('#form-error')).toContainText('Wallet sign-in timed out');
  await expect(page.getByRole('button', { name: 'Prepare live launch', exact: true })).toBeEnabled();
  expect(uploads).toBe(0);
  await page.evaluate(() => window.__lateSignIn({ signature: new Uint8Array(64) }));
  expect(uploads).toBe(0);
  await expect(page.locator('#sign-launch')).toHaveCount(0);
});

test('launch preparation timeout keeps completed metadata and ignores late RPC completion', async ({ page }) => {
  let uploads = 0, heldRoute, genesisCalls = 0;
  await page.route('**/api/metadata', r => { uploads++; return r.fulfill({ json: { uri: 'https://gateway.pinata.cloud/ipfs/TestMetadata', image: 'https://gateway.pinata.cloud/ipfs/TestImage' } }); });
  await page.route('**/api/rpc', r => {
    const { method, id } = r.request().postDataJSON();
    if (method === 'getGenesisHash' && ++genesisCalls === 1) { heldRoute = r; return; }
    return r.fulfill({ json: { jsonrpc: '2.0', id, result: method === 'getGenesisHash' ? 'wrong-network' : { context: { slot: 1 }, value: method === 'getBalance' ? 1000000000 : [] } } });
  });
  await openLiveLaunch(page);
  await page.clock.install();
  await page.getByRole('button', { name: 'Prepare live launch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Checking Solana mainnet...' })).toBeVisible();
  await expect.poll(() => Boolean(heldRoute)).toBe(true);
  await page.clock.fastForward(91000);
  await expect(page.locator('#form-error')).toContainText('Launch preparation timed out');
  await expect(page.getByRole('button', { name: 'Prepare live launch', exact: true })).toBeEnabled();
  const id = heldRoute.request().postDataJSON().id;
  await heldRoute.fulfill({ json: { jsonrpc: '2.0', id, result: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' } });
  await page.getByRole('button', { name: 'Prepare live launch', exact: true }).click();
  await expect(page.locator('#form-error')).toContainText('not Solana mainnet');
  expect(uploads).toBe(1);
  await expect(page.locator('#sign-launch')).toHaveCount(0);
});

test('live candles render and creator studio is usable on desktop and mobile', async ({ page }) => {
  const mint = Keypair.generate().publicKey.toBase58();
  await page.route('**/api/tokens*', r => r.fulfill({ json: [{ id: mint, name: 'Live Yeet', symbol: 'YEET', decimals: 9, usdPrice: 1 }] }));
  await page.route('**/api/launches', r => r.fulfill({ json: [] }));
  await page.route('**/api/market/*', r => r.fulfill({ json: { pair: { pairAddress: mint, priceUsd: '1', dexId: 'raydium', liquidity: { usd: 25000 }, txns: { h24: { buys: 3, sells: 2 } } }, candles: Array.from({ length: 20 }, (_, i) => [1700000000 + i * 3600, 1 + i / 100, 1.1 + i / 100, .9 + i / 100, 1.02 + i / 100, 100]) } }));
  await page.goto('/');
  await page.locator('[data-mode="live"]').click();
  await page.locator('.coin').first().click();
  await expect(page.locator('#token-chart canvas').first()).toBeVisible();
  await expect.poll(() => page.locator('#token-chart canvas').first().evaluate(canvas => {
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

test('indexed curve chart and source filters do not mistake migration for graduation', async ({ page }) => {
  const mint = Keypair.generate().publicKey.toBase58();
  const migrated = Keypair.generate().publicKey.toBase58();
  await page.route('**/api/tokens*', route => route.fulfill({ json: [] }));
  await page.route('**/api/launches', route => route.fulfill({ json: [] }));
  await page.route('**/api/launches/indexed*', route => route.fulfill({ json: { coins: [
    { id: mint, mint, poolId: mint, name: 'Curve fixture', ticker: 'CURVE', pair: 'SOL', progress: 100, launchStatus: 'Migrating', source: 'External LaunchLab', decimals: 6 },
    { id: migrated, mint: migrated, poolId: migrated, name: 'Graduated fixture', ticker: 'DONE', pair: 'SOL', progress: 100, launchStatus: 'Graduated', source: 'External LaunchLab', decimals: 6 },
  ], hasMore: false } }));
  await page.route('**/api/curve/*', route => route.fulfill({ json: { candles: [[1700000000, .00001, .00002, .000005, .000015, 3]], available: true, currency: 'SOL' } }));
  await page.goto('/');
  await page.locator('[data-mode="live"]').click();
  await expect(page.locator('.coin')).toHaveCount(2);
  await page.locator('[data-category="YeetNest"]').click();
  await expect(page.locator('.coin')).toHaveCount(0);
  await page.locator('[data-category="LaunchLab"]').click();
  await expect(page.locator('.coin')).toHaveCount(2);
  await page.locator('[data-tab="Graduated"]').click();
  await expect(page.locator('.coin')).toHaveCount(1);
  await expect(page.locator('.coin')).toContainText('Graduated fixture');
  await page.locator('[data-tab="Trending"]').click();
  await page.locator(`[data-coin="${mint}"]`).click();
  await expect(page.locator('#live-market')).toContainText('Price / SOL');
  await expect(page.locator('#token-chart canvas').first()).toBeVisible();
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
    const result = method === 'getGenesisHash' ? '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' : method === 'getBalance' ? { context: { slot: 1 }, value: 1000000000 } : method === 'getAccountInfo' ? { context: { slot: 1 }, value: { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: { parsed: { type: 'mint', info: { decimals: 6 } }, program: 'spl-token', space: 82 }, executable: false, lamports: 1000000, rentEpoch: 0 } } : { context: { slot: 1 }, value: [] };
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
