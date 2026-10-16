import { withTimeout } from './async-timeout.js';

export class TransactionOutcomeError extends Error {
  constructor(signature, state, message) {
    super(`${message} Signature: ${signature}. Recheck its status before creating another transaction.`);
    this.signature = signature;
    this.state = state;
  }
}

export async function pollTransaction(connection, signature, { attempts = 45, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onState = () => {}, onMissing = async () => {}, recovery } = {}) {
  const deadline = Date.now() + 100000;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (Date.now() >= deadline) break;
    let status;
    try { status = (await withTimeout(() => connection.getSignatureStatuses([signature], { searchTransactionHistory: true }), 10000, 'RPC status check timed out.')).value[0]; }
    catch { /* A temporary RPC outage cannot prove failure. */ }
    if (status?.err) {
      onState('failed');
      throw new TransactionOutcomeError(signature, 'failed', `Transaction failed: ${JSON.stringify(status.err)}.`);
    }
    if (['confirmed', 'finalized'].includes(status?.confirmationStatus)) {
      onState(status.confirmationStatus);
      return signature;
    }
    onState('submitted');
    // Resend only when the RPC successfully reports no status; outages cannot prove absence.
    if (status === null && attempt % 5 === 0 && attempt < attempts - 1) {
      try { await withTimeout(onMissing, 5000, 'Transaction resend timed out.'); }
      catch { /* Keep reconciling the original signature when a resend fails. */ }
    }
    if (attempt < attempts - 1) await sleep(2000);
  }
  if (recovery) {
    let checked;
    try { checked = await withTimeout(() => reconcileTransaction(connection, { ...recovery, signature }), 15000, 'Final confirmation check timed out.'); }
    catch { /* Missing RPC evidence keeps the result unknown. */ }
    if (['confirmed', 'finalized'].includes(checked?.state)) { onState(checked.state); return signature; }
    if (['failed', 'expired'].includes(checked?.state)) {
      onState(checked.state);
      throw new TransactionOutcomeError(signature, checked.state, checked.state === 'expired' ? 'Transaction expired without confirmation. This attempt can no longer land.' : 'Transaction failed on-chain.');
    }
  }
  onState('unknown');
  throw new TransactionOutcomeError(signature, 'unknown', 'Confirmation is unknown.');
}

export function readTransactions() {
  try { return JSON.parse(localStorage.getItem('yn-transactions') || '[]'); }
  catch { return []; }
}

export function recordTransaction(entry) {
  const records = readTransactions();
  const prior = records.findIndex(row => row.signature === entry.signature);
  if (prior >= 0) records[prior] = { ...records[prior], ...entry, updated: Date.now() };
  else records.unshift({ ...entry, created: Date.now(), updated: Date.now() });
  localStorage.setItem('yn-transactions', JSON.stringify(records.slice(0, 100)));
}


// A missing status alone never proves failure. Require finalized blockhash expiry,
// then check historical status and the transaction again before allowing a retry.
export async function reconcileTransaction(connection, record) {
  const readStatus = async () => {
    const result = await connection.getSignatureStatuses([record.signature], { searchTransactionHistory: true });
    if (!Array.isArray(result.value) || result.value.length !== 1 || result.value[0] === undefined) throw new Error('RPC returned an incomplete transaction status.');
    return result.value[0];
  };
  const stateFor = status => status?.err ? 'failed' : ['confirmed', 'finalized'].includes(status?.confirmationStatus) ? status.confirmationStatus : status ? 'submitted' : null;
  const status = await readStatus();
  const state = stateFor(status);
  if (state) return { ...record, state };
  if (['confirmed', 'finalized'].includes(record.state)) return record;
  if (record.blockhash && Number.isSafeInteger(record.lastValidBlockHeight)) {
    const height = await connection.getBlockHeight('finalized');
    if (height > record.lastValidBlockHeight) {
      const transaction = await connection.getTransaction(record.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (transaction) return { ...record, state: transaction.meta?.err ? 'failed' : 'confirmed' };
      const finalStatus = await readStatus();
      return { ...record, state: stateFor(finalStatus) || 'expired' };
    }
  }
  return { ...record, state: 'unknown' };
}
