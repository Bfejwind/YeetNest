import { test, expect } from '@playwright/test';

test('claim and sell accept bounded fee changes but reject economic changes before broadcast', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const chain = await import('/src/chain.js');
    const { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, TransactionInstruction } = await import('/node_modules/.vite/deps/@solana_web3__js.js');
    const owner = Keypair.generate(), recipient = Keypair.generate().publicKey;
    let alterAmount = false, broadcasts = 0;
    window.phantom = { solana: { connect: async () => ({ publicKey: owner.publicKey }), on: () => {}, signTransaction: async transaction => {
      const message = TransactionMessage.decompile(transaction.message);
      const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 400 }), SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: recipient, lamports: alterAmount ? 2 : 1 })];
      instructions.push(new TransactionInstruction({ programId: new PublicKey('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'), data: Buffer.from('06040300e348580a000000000403000001000000000000000000', 'hex'), keys: [{ pubkey: owner.publicKey, isSigner: true, isWritable: true }] }));
      const signed = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: message.recentBlockhash, instructions }).compileToV0Message());
      signed.sign([owner]); return signed;
    } } };
    await chain.connectWallet('Phantom');
    chain.connection.getGenesisHash = async () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
    chain.connection.isBlockhashValid = async () => ({ value: true });
    chain.connection.getFeeForMessage = async () => ({ value: 5160 });
    chain.connection.simulateTransaction = async transaction => {
      const instructions = TransactionMessage.decompile(transaction.message).instructions;
      if (instructions.at(-1).programId.toBase58() !== 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95') throw new Error('Security guard was removed');
      return { value: { err: null } };
    };
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

test('manual launch refreshes after mainnet check and broadcasts only after signed validation', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const chain = await import('/src/chain.js');
    const { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } = await import('/node_modules/.vite/deps/@solana_web3__js.js');
    const owner = Keypair.generate(), mint = Keypair.generate();
    const events = [], freshHash = Keypair.generate().publicKey.toBase58();
    let rejectSimulation = false;
    window.phantom = { solana: { connect: async () => ({ publicKey: owner.publicKey }), on: () => {}, signTransaction: async transaction => {
      events.push('wallet');
      if (transaction.message.recentBlockhash !== freshHash) throw Error('stale blockhash');
      transaction.sign([owner]); return transaction;
    } } };
    await chain.connectWallet('Phantom');
    chain.connection.getGenesisHash = async () => { events.push('mainnet'); return '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'; };
    chain.connection.simulateTransaction = async (transaction, options) => {
      events.push('signed-validation');
      if (!options.sigVerify || options.replaceRecentBlockhash) throw Error('invalid signature validation');
      return { context: { slot: 1234 }, value: { err: rejectSimulation ? 'controlled failure' : null } };
    };
    let sentOptions;
    chain.connection.sendRawTransaction = async (bytes, options) => {
      events.push('broadcast'); sentOptions = options;
      const bs58 = (await import('/node_modules/.vite/deps/bs58.js')).default;
      return bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0]);
    };
    chain.connection.getSignatureStatuses = async () => ({ value: [{ err: null, confirmationStatus: 'confirmed' }] });
    const build = hash => {
      const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: hash, instructions: [SystemProgram.createAccount({ fromPubkey: owner.publicKey, newAccountPubkey: mint.publicKey, lamports: 1, space: 0, programId: SystemProgram.programId })] }).compileToV0Message());
      transaction.sign([mint]); return transaction;
    };
    await chain.submitAndConfirm(build(Keypair.generate().publicKey.toBase58()), { operation: 'launch', prepareForSigning: async () => {
      events.push('refresh'); return { transaction: build(freshHash), blockhash: freshHash, lastValidBlockHeight: 999 };
    } });
    const firstEvents = [...events]; rejectSimulation = true; let validationRejected = false;
    try { await chain.submitAndConfirm(build(freshHash), { operation: 'launch' }); } catch(error) { validationRejected = /failed simulation/.test(error.message); }
    return { events: firstEvents, skipPreflight: sentOptions.skipPreflight, minContextSlot: sentOptions.minContextSlot, validationRejected, broadcasts: events.filter(event=>event === 'broadcast').length };
  });
  expect(result).toEqual({ events: ['mainnet', 'refresh', 'wallet', 'signed-validation', 'broadcast'], skipPreflight: true, minContextSlot: 1234, validationRejected: true, broadcasts: 1 });
});
