import { test, expect } from '@playwright/test';
import { Keypair } from '@solana/web3.js';

test('refresh restores trusted Phantom and explicit disconnect disables restoration', async ({ page }) => {
  const wallet = Keypair.generate().publicKey.toBase58();
  await page.addInitScript(address => {
    window.phantom = { solana: { on: () => {}, disconnect: async () => {}, connect: async options => {
      const key = options?.onlyIfTrusted ? 'silent-calls' : 'approval-calls';
      sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) || 0) + 1));
      return { publicKey: { toString: () => address } };
    } } };
  }, wallet);
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.route('**/api/rpc', route => route.fulfill({ json: { jsonrpc: '2.0', id: route.request().postDataJSON().id, result: { context: { slot: 1 }, value: route.request().postDataJSON().method === 'getBalance' ? 1000000000 : [] } } }));
  await page.goto('/');
  await page.evaluate(async () => { const chain = await import('/src/chain.js'); await chain.connectWallet('Phantom'); });
  await page.reload();
  await expect(page.locator('#wallet')).toContainText(wallet.slice(0, 4));
  expect(await page.evaluate(() => sessionStorage.getItem('approval-calls'))).toBe('1');
  expect(await page.evaluate(() => sessionStorage.getItem('silent-calls'))).toBe('1');
  await page.evaluate(async () => { const chain = await import('/src/chain.js'); await chain.disconnectWallet(); });
  await page.reload();
  await expect(page.locator('#wallet')).toContainText('Connect wallet');
  expect(await page.evaluate(() => sessionStorage.getItem('silent-calls'))).toBe('1');
});
