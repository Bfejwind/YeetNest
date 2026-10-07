import { test, expect } from '@playwright/test';
import { Keypair } from '@solana/web3.js';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
});

test('extension-free web wallet loads the official Solflare connection surface', async ({ page }) => {
  await page.route('https://connect.solflare.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Controlled provider page</body></html>' }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await page.locator('[data-mode="live"]').click();
  await page.locator('#wallet').click();
  await page.locator('[data-wallet="Solflare Web"]').click();
  await expect(page.locator('iframe[src^="https://connect.solflare.com/"]')).toBeAttached();
  expect(await page.evaluate(async () => (await import('/src/chain.js')).publicKey)).toBeNull();
});

test('phone QR opens a wallet-browser session without claiming desktop pairing', async ({ page }) => {
  await page.route('https://wallet-test.example/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `http://localhost:5174${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  await page.route('**/api/tokens*', route => route.fulfill({ json: [] }));
  await page.goto('https://wallet-test.example/');
  await page.locator('[data-mode="live"]').click();
  await page.locator('#wallet').click();
  await page.locator('[data-phone-wallet="Phantom"]').click();
  await expect(page.locator('.wallet-qr')).toBeVisible();
  await expect(page.locator('#phone-wallet')).toContainText('Phone session');
  await expect(page.getByRole('link', { name: 'Open Phantom' })).toHaveAttribute('href', /https:\/\/phantom.com\/ul\/v1\/browse\//);
  expect(await page.evaluate(async () => (await import('/src/chain.js')).publicKey)).toBeNull();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.wallet-qr')).toBeVisible();
  }
  await page.screenshot({ path: 'yeetnest-phone-wallet.png', fullPage: true });
});

test('wallet picker offers the official download instead of a dead end', async ({ page }) => {
  await page.route('**/api/tokens*', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await page.locator('[data-mode="live"]').click();
  await page.locator('#wallet').click();
  await page.locator('[data-wallet="Phantom"]').click();
  await expect(page.locator('#form-error')).toContainText('site access');
  await expect(page.getByRole('link', { name: 'Get Phantom' })).toHaveAttribute('href', 'https://phantom.com/download');
  await expect(page.locator('[data-wallet="Phantom"]')).toBeEnabled();
  await page.locator('[data-wallet="Solflare"]').click();
  await expect(page.getByRole('link', { name: 'Get Solflare' })).toHaveAttribute('href', 'https://solflare.com/download');
});

test('late injection and Solflare legacy namespace are detected', async ({ page }) => {
  const address = Keypair.generate().publicKey.toBase58();
  await page.goto('/');
  const connected = await page.evaluate(async address => {
    const chain = await import('/src/chain.js');
    setTimeout(() => {
      window.solana = { isSolflare: true, connect: async () => ({ publicKey: { toString: () => address } }) };
    }, 300);
    const result = await chain.connectWallet('Solflare');
    await chain.disconnectWallet();
    return result;
  }, address);
  expect(connected).toBe(address);
});

for (const name of ['Phantom', 'Solflare']) {
  test(`${name} works through Wallet Standard without injected globals`, async ({ page }) => {
    const address = Keypair.generate().publicKey.toBase58();
    await page.addInitScript(({ name, address }) => {
      let accounts = [];
      const listeners = new Set();
      const account = { address, publicKey: new Uint8Array(32), chains: ['solana:mainnet'], features: ['solana:signTransaction', 'solana:signMessage'] };
      const wallet = {
        version: '1.0.0', name, icon: 'data:image/png;base64,', chains: ['solana:mainnet'],
        get accounts() { return accounts; },
        features: {
          'standard:connect': { version: '1.0.0', connect: async () => { accounts = [account]; return { accounts }; } },
          'standard:disconnect': { version: '1.0.0', disconnect: async () => { accounts = []; } },
          'standard:events': { version: '1.0.0', on: (event, listener) => { listeners.add(listener); return () => listeners.delete(listener); } },
          'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy', 0], signTransaction: async input => [{ signedTransaction: input.transaction }] },
          'solana:signMessage': { version: '1.0.0', signMessage: async () => [{ signature: new Uint8Array(64), signedMessage: new Uint8Array(), account }] },
        },
      };
      window.addEventListener('wallet-standard:app-ready', event => event.detail.register(wallet));
      window.__walletListenerCount = () => listeners.size;
    }, { name, address });
    await page.goto('/');
    const result = await page.evaluate(async name => {
      const chain = await import('/src/chain.js');
      const address = await chain.connectWallet(name);
      const signature = await chain.provider.signMessage(new Uint8Array([1]));
      const subscribed = window.__walletListenerCount();
      await chain.disconnectWallet();
      return { address, signatureLength: signature.length, subscribed, remaining: window.__walletListenerCount(), disconnected: chain.publicKey === null };
    }, name);
    expect(result).toEqual({ address, signatureLength: 64, subscribed: 1, remaining: 0, disconnected: true });
  });
}
