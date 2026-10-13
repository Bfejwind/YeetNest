import { test, expect } from '@playwright/test';

test('claim and sell accept bounded fee changes but reject economic changes before broadcast', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const chain = await import('/src/chain.js');
    const { Keypair, SystemProgram, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = await import('/node_modules/.vite/deps/@solana_web3__js.js');
    const owner = Keypair.generate(), recipient = Keypair.generate().publicKey;
    let alterAmount = false, broadcasts = 0;
    window.phantom = { solana: { connect: async () => ({ publicKey: owner.publicKey }), on: () => {}, signTransaction: async transaction => {
      const message = TransactionMessage.decompile(transaction.message);
      const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 400 }), SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: recipient, lamports: alterAmount ? 2 : 1 })];
      const signed = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: message.recentBlockhash, instructions }).compileToV0Message());
      signed.sign([owner]); return signed;
    } } };
    await chain.connectWallet('Phantom');
    chain.connection.getGenesisHash = async () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
    chain.connection.isBlockhashValid = async () => ({ value: true });
    chain.connection.getFeeForMessage = async () => ({ value: 5160 });
    chain.connection.simulateTransaction = async () => ({ value: { err: null } });
    chain.connection.sendRawTransaction = async bytes => {
      broadcasts++;
      const bs58 = (await import('/node_modules/.vite/deps/bs58.js')).default;
      return bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0]);
    };
    chain.connection.getSignatureStatuses = async () => ({ value: [{ err: null, confirmationStatus: 'confirmed' }] });
    const tx = () => new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: recipient, lamports: 1 })] }).compileToV0Message());
    await chain.submitAndConfirm(tx(), { operation: 'creator-claim', protocol: 'pump' });
    await chain.submitAndConfirm(tx(), { operation: 'sell', protocol: 'pump' });
    alterAmount = true;
    let rejected = false;
    try { await chain.submitAndConfirm(tx(), { operation: 'sell', protocol: 'pump' }); } catch { rejected = true; }
    return { broadcasts, rejected };
  });
  expect(result).toEqual({ broadcasts: 2, rejected: true });
});
