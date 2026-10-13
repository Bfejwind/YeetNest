import { test, expect } from '@playwright/test';
import { Keypair } from '@solana/web3.js';

test('Sell Max fills the complete raw wallet balance without rounding or submitting', async ({ page }) => {
  const mint = Keypair.generate().publicKey.toBase58(), wallet = Keypair.generate().publicKey.toBase58();
  await page.addInitScript(address => {
    window.phantom = { solana: { connect: async () => ({ publicKey: { toString: () => address } }), on: () => {} } };
  }, wallet);
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [{ id: mint, name: 'Max Token', symbol: 'MAX', decimals: 6, usdPrice: 1 }] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.route('**/api/market/*', route => route.fulfill({ json: { pair: null, candles: [] } }));
  await page.route('**/api/holders/*', route => route.fulfill({ json: { accounts: [] } }));
  await page.route('**/api/trades/*', route => route.fulfill({ json: { trades: [] } }));
  await page.route('https://www.geckoterminal.com/**', route => route.fulfill({ contentType: 'text/html', body: 'Chart fixture' }));
  await page.goto('/');
  await page.evaluate(async mint => {
    const chain = await import('/src/chain.js');
    await chain.connectWallet('Phantom');
    chain.connection.getBalance = async () => 1000000000;
    chain.connection.getParsedTokenAccountsByOwner = async (owner, filter) => ({ value: filter.programId.toBase58().startsWith('Tokenkeg') ? ['12345678901234567', '1'].map(amount => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals: 6 } } } } } })) : [] });
  }, mint);
  await page.locator('.coin').first().click();
  await expect(page.getByRole('button', { name: 'Sell maximum token balance' })).toHaveCount(0);
  await page.locator('[data-side="Sell"]').click();
  await page.getByRole('button', { name: 'Sell maximum token balance' }).click();
  await expect(page.locator('#trade-form [name=amount]')).toHaveValue('12345678901.234568');
  await expect(page.getByRole('button', { name: 'Sign and submit' })).toHaveCount(0);
});
