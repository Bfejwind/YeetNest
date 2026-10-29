import { createHmac } from 'node:crypto';
import { Keypair, PublicKey, ComputeBudgetProgram, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { DAILY_LAUNCH_COUNT, rotatingTemplate, singaporeDay } from '../src/daily-launch-plan.js';
import { validateLocalInstructions } from '../src/pump-validation.js';

export const DAILY_CAP = 30_000_000; // 0.03 SOL, including funding and creation fees/rent.
export const FUNDING_FEE_RESERVE = 100_000;
export const DAILY_ALLOWANCE = DAILY_CAP - FUNDING_FEE_RESERVE;
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export function stop(code) { return Object.assign(new Error(code), { automationCode: code }); }
export function readAutomationWallet(env) {
  if (env.AUTOLAUNCH_DAILY_BUDGET_SOL && env.AUTOLAUNCH_DAILY_BUDGET_SOL !== '0.03') throw stop('DAILY_BUDGET_MUST_BE_003_SOL');
  if (env.AUTOLAUNCH_INITIAL_BUY_SOL && !/^0+(\.0+)?$/.test(env.AUTOLAUNCH_INITIAL_BUY_SOL)) throw stop('TOKEN_PURCHASES_FORBIDDEN');
  try {
    const value = env.AUTOLAUNCH_SECRET_KEY || '';
    const bytes = value.startsWith('[') ? Uint8Array.from(JSON.parse(value)) : bs58.decode(value);
    if (bytes.length !== 64) throw new Error();
    const key = Keypair.fromSecretKey(bytes);
    if (key.publicKey.toBase58() !== env.AUTOLAUNCH_WALLET) throw new Error();
    return key;
  } catch { throw stop('AUTOMATION_WALLET_MISSING_OR_MISMATCHED'); }
}
export function dailyWallet(root, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw stop('INVALID_DATE');
  return Keypair.fromSeed(createHmac('sha256', root.secretKey).update('yeetnest-daily-launch-wallet-v1:' + day).digest());
}
function pack(transaction, validity, extra = {}) {
  return { ...extra, raw: Buffer.from(transaction.serialize()).toString('base64'), signature: bs58.encode(transaction.signatures[0]), blockhash: validity.blockhash, lastValidBlockHeight: validity.lastValidBlockHeight, state: 'signed' };
}
export async function buildFunding(connection, root, payer) {
  if (await connection.getBalance(payer.publicKey, 'confirmed') !== 0) throw stop('DAILY_WALLET_ALREADY_FUNDED');
  const history = await connection.getSignaturesForAddress(payer.publicKey, { limit: 1 }, 'confirmed');
  if (history.length) throw stop('DAILY_WALLET_HAS_PRIOR_HISTORY_RESTORE_JOURNAL');
  const validity = await connection.getLatestBlockhash('confirmed');
  const instructions = [SystemProgram.transfer({ fromPubkey: root.publicKey, toPubkey: payer.publicKey, lamports: DAILY_ALLOWANCE })];
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: root.publicKey, recentBlockhash: validity.blockhash, instructions }).compileToV0Message());
  const fee = (await connection.getFeeForMessage(transaction.message, 'confirmed')).value;
  if (!Number.isSafeInteger(fee) || fee < 0 || fee > FUNDING_FEE_RESERVE) throw stop('FUNDING_FEE_EXCEEDS_RESERVED_BUDGET');
  if (await connection.getBalance(root.publicKey, 'confirmed') < DAILY_ALLOWANCE + fee) throw stop('AUTOMATION_WALLET_INSUFFICIENT_SOL');
  transaction.sign([root]);
  const simulation = await connection.simulateTransaction(transaction, { sigVerify: true, commitment: 'confirmed' });
  if (simulation.value.err) throw stop('FUNDING_SIMULATION_FAILED');
  const fresh = await connection.getLatestBlockhash('confirmed');
  transaction.message.recentBlockhash = fresh.blockhash; transaction.sign([root]);
  return pack(transaction, fresh, { allowance: DAILY_ALLOWANCE, fee });
}
// Each authorized cap upgrade gets a separately journaled funding delta.
// The delta is journaled before broadcast and never reconstructed after ambiguity.
export async function buildAllowanceIncrease(connection, root, payer, journal) {
  const records = [journal.funding,...(journal.allowanceIncreases || (journal.allowanceIncrease ? [journal.allowanceIncrease] : []))];
  if (records.some(row=>row?.state !== 'confirmed' || !Number.isSafeInteger(row.allowance) || row.allowance <= 0 || !Number.isSafeInteger(row.fee) || row.fee < 0)) throw stop('INVALID_PREVIOUS_FUNDING');
  const previous = records.reduce((sum,row)=>({allowance:sum.allowance+row.allowance,fee:sum.fee+row.fee}),{allowance:0,fee:0});
  if (previous.allowance >= DAILY_ALLOWANCE || previous.fee > FUNDING_FEE_RESERVE) throw stop('INVALID_PREVIOUS_FUNDING');
  const balance = await connection.getBalance(root.publicKey,'confirmed');
  const minimum = await connection.getMinimumBalanceForRentExemption(0,'confirmed');
  // Preserve the source account's rent minimum and the remaining fee reserve.
  const allowance = Math.min(DAILY_ALLOWANCE - previous.allowance,balance - minimum - (FUNDING_FEE_RESERVE - previous.fee));
  if (!Number.isSafeInteger(allowance) || allowance <= 0) throw stop('AUTOMATION_WALLET_INSUFFICIENT_SOL');
  const validity = await connection.getLatestBlockhash('confirmed');
  const instructions = [SystemProgram.transfer({fromPubkey:root.publicKey,toPubkey:payer.publicKey,lamports:allowance})];
  const transaction = new VersionedTransaction(new TransactionMessage({payerKey:root.publicKey,recentBlockhash:validity.blockhash,instructions}).compileToV0Message());
  const fee = (await connection.getFeeForMessage(transaction.message,'confirmed')).value;
  if (!Number.isSafeInteger(fee) || fee < 0 || previous.fee + fee > FUNDING_FEE_RESERVE) throw stop('FUNDING_FEE_EXCEEDS_RESERVED_BUDGET');
  if (await connection.getBalance(root.publicKey,'confirmed') < allowance + fee) throw stop('AUTOMATION_WALLET_INSUFFICIENT_SOL');
  transaction.sign([root]);
  const simulation = await connection.simulateTransaction(transaction,{sigVerify:true,commitment:'confirmed'});
  if (simulation.value.err) throw stop('FUNDING_SIMULATION_FAILED');
  const fresh = await connection.getLatestBlockhash('confirmed');
  transaction.message.recentBlockhash = fresh.blockhash; transaction.sign([root]);
  return pack(transaction,fresh,{allowance,fee});
}
export async function buildCreation(connection, pump, payer, creator, metadata, remaining) {
  const mint = Keypair.generate();
  const globalAccount = await connection.getAccountInfo(pump.GLOBAL_PDA, 'confirmed');
  if (!globalAccount?.owner.equals(pump.PUMP_PROGRAM_ID)) throw stop('INVALID_PUMP_GLOBAL');
  const global = await pump.online.fetchGlobal();
  if (!global.createV2Enabled) throw stop('PUMP_CREATION_DISABLED');
  // Deliberately create only: there is no token buy, trade, or arbitrary instruction input.
  const creation = await pump.PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name: metadata.name, symbol: metadata.ticker, uri: metadata.uri, creator, user: payer.publicKey, mayhemMode: false, cashback: false, holderReward: false });
  const definition = pump.pumpIdl.instructions.find(ix => ix.name.replaceAll('_', '').toLowerCase() === 'createv2');
  if (!definition || !creation.programId.equals(pump.PUMP_PROGRAM_ID) || !creation.data.subarray(0, 8).equals(Buffer.from(definition.discriminator))) throw stop('ONLY_PUMP_CREATE_V2_ALLOWED');
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }), creation];
  const validity = await connection.getLatestBlockhash('confirmed');
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: validity.blockhash, instructions }).compileToV0Message());
  validateLocalInstructions(transaction, instructions, payer.publicKey.toBase58(), [mint.publicKey.toBase58()]);
  const fee = (await connection.getFeeForMessage(transaction.message, 'confirmed')).value;
  if (!Number.isSafeInteger(fee) || fee < 0 || fee > remaining) throw stop('CREATION_FEE_EXCEEDS_BUDGET');
  const before = await connection.getBalance(payer.publicKey, 'confirmed');
  transaction.sign([payer, mint]);
  const result = await connection.simulateTransaction(transaction, { sigVerify: true, commitment: 'confirmed', accounts: { addresses: [payer.publicKey.toBase58()], encoding: 'base64' } });
  if (result.value.err) throw stop('CREATION_SIMULATION_FAILED_OR_INSUFFICIENT_BUDGET');
  const after = result.value.accounts?.[0]?.lamports;
  if (!Number.isSafeInteger(after) || !Number.isSafeInteger(before) || after < 0 || after > before) throw stop('CREATION_COST_UNAVAILABLE');
  // Conservatively reserve the simulated full debit plus another network fee and a small margin.
  const reserve = before - after + fee + 20000;
  if (reserve > remaining || reserve > before) throw stop('DAILY_CREATION_BUDGET_EXHAUSTED');
  const fresh = await connection.getLatestBlockhash('confirmed');
  transaction.message.recentBlockhash = fresh.blockhash; transaction.sign([payer,mint]);
  return pack(transaction, fresh, { reserve, mint: mint.publicKey.toBase58(), poolId: pump.bondingCurvePda(mint.publicKey).toBase58(), metadata });
}
export async function reconcile(connection, record, { resend = false } = {}) {
  if (['confirmed', 'failed', 'expired'].includes(record.state)) return;
  if (record.state === 'signed' && resend) {
    // Submit freshly journaled bytes immediately; extra status RPCs can consume
    // the blockhash lifetime when the shared RPC budget is busy.
    try { await connection.sendRawTransaction(Buffer.from(record.raw,'base64'),{skipPreflight:false,maxRetries:0}); } catch { /* Reconcile the same signature next time. */ }
    record.state = 'pending'; return;
  }
  const status = (await connection.getSignatureStatuses([record.signature], { searchTransactionHistory: true })).value[0];
  if (status?.confirmationStatus === 'finalized') { record.state = status.err ? 'failed' : 'confirmed'; return; }
  // A processed/confirmed error is still held until finalized; never build a replacement.
  if (status) { record.state = 'pending'; return; }
  if (await connection.getBlockHeight('finalized') > record.lastValidBlockHeight) {
    const old = await connection.getTransaction(record.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    record.state = old ? (old.meta?.err ? 'failed' : 'confirmed') : 'expired'; return;
  }
  if (resend) {
    // Retry only identical persisted bytes. Even RPC submission errors remain unresolved.
    try { await connection.sendRawTransaction(Buffer.from(record.raw, 'base64'), { skipPreflight: false, maxRetries: 0 }); } catch { /* Check signature on next run. */ }
  }
  record.state = 'pending';
}
export async function runAutomationDay({ store, connection, root, pump, metadataFor, register, now = () => new Date() }) {
  const day = singaporeDay(now());
  if (!day.due) return 'not-due';
  if (await connection.getGenesisHash() !== MAINNET_GENESIS) throw stop('MAINNET_REQUIRED');
  const payer = dailyWallet(root, day.date);
  let journal = await store.get(day.date);
  if (!journal) {
    journal = { day: day.date, wallet: root.publicKey.toBase58(), payer: payer.publicKey.toBase58(), cap: DAILY_CAP, initialBuy: '0', slots: [] };
    await store.save(day.date, journal);
  }
  if (journal.wallet !== root.publicKey.toBase58() || journal.payer !== payer.publicKey.toBase58()) throw stop('JOURNAL_WALLET_OR_POLICY_MISMATCH');
  if ([10_000_000,20_000_000].includes(journal.cap)) {
    // Preserve all signed work and count every earlier funding delta.
    if (journal.funding) { journal.previousCap = journal.cap; journal.budgetIncreasePending = true; }
    journal.cap = DAILY_CAP;
    if (['DAILY_CREATION_BUDGET_EXHAUSTED','CREATION_SIMULATION_FAILED_OR_INSUFFICIENT_BUDGET'].includes(journal.blocked?.reason)) delete journal.blocked;
    await store.save(day.date,journal);
  }
  if (journal.cap !== DAILY_CAP) throw stop('JOURNAL_WALLET_OR_POLICY_MISMATCH');
  if (journal.blocked?.reason === 'DAILY_CREATION_BUDGET_EXHAUSTED' && journal.slots.some(row=>row?.state === 'expired')) {
    delete journal.blocked;
    await store.save(day.date,journal);
  }
  if (journal.blocked) return 'blocked';
  const currentDay = () => singaporeDay(now()).date === day.date && singaporeDay(now()).due;
  if (!currentDay()) return 'date-ended';
  if (!journal.funding) {
    journal.funding = await buildFunding(connection, root, payer);
    if (!currentDay()) return 'date-ended';
    await store.save(day.date, journal); // Must succeed BEFORE any broadcast.
  }
  await reconcile(connection, journal.funding, { resend: currentDay() });
  await store.save(day.date, journal);
  if (journal.funding.state !== 'confirmed') return ['failed','expired'].includes(journal.funding.state) ? 'funding-stopped' : 'pending';
  if (journal.allowanceIncrease) {
    (journal.allowanceIncreases ||= []).push(journal.allowanceIncrease);
    delete journal.allowanceIncrease;
    await store.save(day.date,journal);
  }
  for (const increase of journal.allowanceIncreases || []) {
    await reconcile(connection,increase,{resend:currentDay()});
    await store.save(day.date,journal);
    if (increase.state !== 'confirmed') return ['failed','expired'].includes(increase.state) ? 'funding-stopped' : 'pending';
  }
  if (journal.budgetIncreasePending) {
    const increase = await buildAllowanceIncrease(connection,root,payer,journal);
    if (!currentDay()) return 'date-ended';
    (journal.allowanceIncreases ||= []).push(increase);
    journal.budgetIncreasePending = false;
    await store.save(day.date,journal);
    await reconcile(connection,increase,{resend:currentDay()});
    await store.save(day.date,journal);
    if (increase.state !== 'confirmed') return ['failed','expired'].includes(increase.state) ? 'funding-stopped' : 'pending';
  }
  for (let slot = 0; slot < DAILY_LAUNCH_COUNT; slot++) {
    if (!currentDay()) return 'date-ended';
    let record = journal.slots[slot];
    if (record?.state === 'expired') {
      // Replace only after expiry, absent signature history and absent mint.
      if (await connection.getBlockHeight('finalized') <= record.lastValidBlockHeight) return 'pending';
      const status = (await connection.getSignatureStatuses([record.signature],{searchTransactionHistory:true})).value[0];
      const transaction = await connection.getTransaction(record.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
      const mint = await connection.getAccountInfo(new PublicKey(record.mint),'finalized');
      if (status || transaction || mint) throw stop('EXPIRED_CREATION_REQUIRES_RECONCILIATION');
      (journal.expiredAttempts ||= []).push({...record,slot});
      journal.slots[slot] = null;
      await store.save(day.date,journal);
      record = null;
    }
    if (!record) {
      const used = journal.slots.reduce((total, row) => total + (row?.reserve || 0), 0);
      const remaining = DAILY_ALLOWANCE - used;
      if (remaining <= 0) return 'budget-exhausted';
      const template = rotatingTemplate(slot, now());
      const metadata = await metadataFor(template, root.publicKey.toBase58());
      try { record = await buildCreation(connection, pump, payer, root.publicKey, metadata, remaining); }
      catch (error) {
        if (error.automationCode) { journal.blocked = { slot, reason: error.automationCode }; await store.save(day.date, journal); return 'blocked'; }
        throw error;
      }
      journal.slots[slot] = record;
      if (!currentDay()) return 'date-ended';
      await store.save(day.date, journal);
    }
    await reconcile(connection, record, { resend: currentDay() });
    await store.save(day.date, journal);
    // Recover an expired slot before reserving budget for any later slot.
    if (record.state === 'expired') return 'pending';
    if (!['confirmed','failed','expired'].includes(record.state)) return 'pending';
    if (record.state === 'confirmed' && !record.registered) {
      await register(record, root.publicKey.toBase58());
      record.registered = true; await store.save(day.date, journal);
    }
  }
  return 'done';
}

// Older days are status/listing recovery only. Never fund, replace or rebroadcast old work.
export async function recoverAutomationDays({ store, connection, root, register, now = () => new Date() }) {
  const today = singaporeDay(now()).date;
  for (const journal of await store.recent()) {
    if (journal.day >= today || journal.wallet !== root.publicKey.toBase58()) continue;
    if (journal.funding) await reconcile(connection, journal.funding);
    if (journal.allowanceIncrease) await reconcile(connection,journal.allowanceIncrease);
    for (const increase of journal.allowanceIncreases || []) await reconcile(connection,increase);
    for (const record of journal.slots) {
      if (!record) continue;
      await reconcile(connection, record);
      if (record.state === 'confirmed' && !record.registered) {
        await register(record, journal.wallet); record.registered = true;
      }
    }
    await store.save(journal.day, journal);
  }
}
