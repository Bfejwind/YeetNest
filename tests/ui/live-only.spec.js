import { test, expect } from '@playwright/test';
import { Keypair } from '@solana/web3.js';

test('rate limited market lookup does not block opening a token chart', async ({ page }) => {
  const mint = Keypair.generate().publicKey.toBase58();
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [{ id: mint, name: 'Rate Test', symbol: 'RATE', decimals: 6, usdPrice: 1 }] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.route('**/api/market/*', route => route.fulfill({ status: 429, json: { error: 'Chart provider rate limit reached.' } }));
  await page.route('https://www.geckoterminal.com/**', route => route.fulfill({ contentType: 'text/html', body: '<body>Token chart fallback fixture</body>' }));
  await page.goto('/'); await page.locator('.coin').first().click();
  await expect(page.locator('.external-token-chart')).toBeVisible();
  await expect(page.locator('.external-token-chart')).toHaveAttribute('src', new RegExp(`/solana/pools/${mint}\\?embed=1`));
  await expect(page.locator('#live-market .pool-metrics')).toHaveCount(0);
});

test('external pools use an embedded chart with fallback links and stable responsive sizing', async ({ page }) => {
  const mint = Keypair.generate().publicKey.toBase58();
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [{ id: mint, name: 'External Test', symbol: 'EXT', decimals: 6, usdPrice: 1 }] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.route('**/api/market/*', route => {
    expect(new URL(route.request().url()).searchParams.get('chart')).toBe('embed');
    return route.fulfill({ json: { chartProvider: 'geckoterminal-embed', pair: { pairAddress: mint, priceUsd: '1', dexId: 'meteora' }, candles: [] } });
  });
  await page.route('https://www.geckoterminal.com/**', route => route.fulfill({ contentType: 'text/html', body: '<body style="background:#1c1f26;color:white">Provider chart fixture</body>' }));
  await page.goto('/');
  await page.locator('.coin').first().click();
  const frame = page.locator('.external-token-chart');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('src', /chart_type=price&resolution=5m/);
  await expect(page.getByRole('link', { name: 'Open on GeckoTerminal' })).toBeVisible();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await frame.boundingBox()).height).toBe(460);
    await page.screenshot({ path: `memepop-embed-${width}.png` });
  }
});

test('Pump chart uses local candles after graduation with USD, FDV and range controls', async ({ page }) => {
  const mint = Keypair.generate().publicKey.toBase58();
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [{ id: mint, mint, poolId: mint, name: 'Local Pump', ticker: 'LOCAL', protocol: 'pump', launchStatus: 'Graduated', progress: 100, source: 'MemePop', decimals: 6 }] }));
  await page.route('**/api/holders/*', route => route.fulfill({ json: { accounts: [] } }));
  await page.route('**/api/trades/*', route => route.fulfill({ json: { trades: [] } }));
  let requests = 0;
  await page.route('**/api/candles/*', route => {
    requests++;
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: { available: true, currency: query.get('currency'), metric: query.get('metric'), candles: Array.from({ length: 24 }, (_, index) => [1700002800 + index * 60, .001, .002, .0005, .0015, 2]) } });
  });
  await page.route('**/api/market/*', route => { throw new Error('Pump chart requested external history'); });
  await page.goto('/');
  await page.locator('.coin').first().click();
  await page.getByLabel('Chart currency').selectOption('USD');
  await expect(page.locator('.chart-header')).toContainText('Price / USD');
  await page.getByLabel('Chart metric').selectOption('fdv');
  await expect(page.locator('.chart-header')).toContainText('FDV / USD');
  await page.getByLabel('Chart history').selectOption('7');
  await expect(page.getByRole('button', { name: '15m', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const before = requests;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('memepop-market', { detail: {} })));
  await expect.poll(() => requests, { timeout: 10000 }).toBeGreaterThan(before);
  await expect(page.getByLabel('Chart currency')).toHaveValue('USD');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `memepop-indexed-chart-${width}.png` });
  }
});

test('token candlesticks render with volume and working timeframe controls', async ({ page }) => {
  const mint = Keypair.generate().publicKey.toBase58();
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [{ id: mint, name: 'Chart Test', symbol: 'CHART', decimals: 6, usdPrice: 1 }] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.route('**/api/market/*', route => route.fulfill({ json: { pair: { pairAddress: mint, priceUsd: '1', dexId: 'pump', liquidity: { usd: 1000 }, txns: { h24: { buys: 1, sells: 1 } } }, candles: Array.from({ length: 24 }, (_, index) => [1700002800 + index * 3600, 1, 1.2, .8, 1 + index / 100, 50 + index]) } }));
  await page.goto('/');
  await page.locator('.coin').first().click();
  await expect(page.locator('.candle-readout')).toContainText('Volume');
  await page.getByRole('button', { name: '4h', exact: true }).click();
  await expect(page.getByRole('button', { name: '4h', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Fit chart', exact: true }).click();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator('#token-chart canvas').first().evaluate(canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return data.some((value, index) => index % 4 === 3 && value > 0);
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `memepop-candles-${width}.png` });
  }
});

test('starts live-only and ignores stored demo coins and balances across mobile and desktop', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('yn-coins', JSON.stringify([{ id: 'old-demo', name: 'Old simulated coin', ticker: 'FAKE' }]));
    localStorage.setItem('yn-balance', '999');
    localStorage.setItem('yn-watchlist', '["old-demo"]');
  });
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta', uploads: true } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page.locator('.live-environment')).toHaveText('Solana mainnet');
  await expect(page.getByRole('button', { name: 'Demo', exact: true })).toHaveCount(0);
  await expect(page.locator('.coin')).toHaveCount(0);
  await expect(page.locator('.content')).not.toContainText('Old simulated coin');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const slogan = await page.locator('.market-slogan').boundingBox();
    const controls = await page.locator('.header-right').boundingBox();
    expect(slogan.x + slogan.width).toBeLessThanOrEqual(controls.x);
    expect(Math.abs(slogan.y + slogan.height / 2 - controls.y - controls.height / 2)).toBeLessThan(3);
    await page.screenshot({ path: `memepop-live-only-${width}.png` });
  }
  await page.locator('#wallet').click();
  await expect(page.locator('[data-wallet="Phantom"]')).toBeVisible();
  await expect(page.locator('#demo')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('[data-launch]').first().click();
  await expect(page.getByRole('button', { name: 'Prepare live launch', exact: true })).toBeVisible();
  await expect(page.getByLabel('Initial buy (SOL)', { exact: true })).toBeVisible();
});
