export class TransactionOutcomeError extends Error {
  constructor(signature, state, message) {
    super(`${message} Signature: ${signature}. Recheck its status before creating another transaction.`);
    this.signature = signature;
    this.state = state;
  }
}

export async function pollTransaction(connection, signature, { attempts = 45, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onState = () => {} } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    let status;
    try { status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]; }
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
    if (attempt < attempts - 1) await sleep(2000);
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
