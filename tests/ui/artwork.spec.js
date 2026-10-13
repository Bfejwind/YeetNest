import { test, expect } from '@playwright/test';
import { Keypair } from '@solana/web3.js';

test('metadata artwork retries direct delivery before abandoning an available image', async ({ page }) => {
  const mint = Keypair.generate().publicKey.toBase58();
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [{ id: mint, name: 'Direct Art', symbol: 'DIRECT', decimals: 6, usdPrice: 1 }] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.route(`**/api/metadata/${mint}/artwork*`, route => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.has('provider')).toBe(false);
    return query.get('direct') === '1' ? route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=', 'base64') }) : route.fulfill({ status: 502, body: '' });
  });
  await page.goto('/');
  const img = page.locator('.coin img').first();
  await expect(img).toHaveAttribute('src', `/api/metadata/${mint}/artwork?direct=1`, { timeout: 15000 });
  await expect.poll(() => img.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
});

test('failed provider artwork is recovered by mint without generating a fake coin image', async ({ page }) => {
  const mint = Keypair.generate().publicKey.toBase58();
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [{ id: mint, name: 'Artwork Test', symbol: 'ART', decimals: 6, usdPrice: 1, icon: 'https://static.jup.ag/broken.png' }] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.route('**/api/artwork?*', route => route.fulfill({ status: 502, body: '' }));
  await page.route('https://static.jup.ag/broken.png', route => route.fulfill({ status: 404, body: '' }));
  await page.route(`**/api/metadata/${mint}/artwork*`, route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=', 'base64') }));
  await page.goto('/');
  const img = page.locator('.coin img').first();
  await expect(img).toHaveAttribute('src', `/api/metadata/${mint}/artwork?exclude=${encodeURIComponent('https://static.jup.ag/broken.png')}`, { timeout: 15000 });
  await expect.poll(() => img.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
  await expect(page.locator('.coin .missing-coin-art')).toHaveCount(0);
});

test('failed metadata images retry the internet artwork source', async ({ page }) => {
  const mint = Keypair.generate().publicKey.toBase58();
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [{ id: mint, name: 'Internet Art', symbol: 'WEB', decimals: 6, usdPrice: 1 }] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.route(`**/api/metadata/${mint}/artwork*`, route => {
    if (new URL(route.request().url()).searchParams.get('provider') !== 'internet') return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=', 'base64') });
  });
  await page.goto('/');
  const img = page.locator('.coin img').first();
  await expect(img).toHaveAttribute('src', `/api/metadata/${mint}/artwork?provider=internet`, { timeout: 15000 });
  await expect.poll(() => img.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
});
