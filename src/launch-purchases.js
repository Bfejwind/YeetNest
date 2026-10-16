import { reconcileTransaction } from './transaction-state.js';

const key = 'yn-launch-purchases';

export function purchaseStore(storage = localStorage, now = Date.now) {
  const read = () => {
    const rows = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(rows)) throw new Error('Initial purchase journal is invalid.');
    return rows;
  };
  const save = entry => {
    const rows = read();
    const index = rows.findIndex(row => row.wallet === entry.wallet && row.mint === entry.mint);
    const next = { ...(index >= 0 ? rows[index] : {}), ...entry, updated: now() };
    if (index >= 0) rows[index] = next;
    else {
      if (rows.length >= 100) throw new Error('Initial purchase journal is full.');
      rows.push(next);
    }
    storage.setItem(key, JSON.stringify(rows));
    return next;
  };
  return { read, save };
}

export async function reviewablePurchase(intent, connection, { action = 'prepare' } = {}) {
  if (!intent.signature) return intent;
  const checked = await reconcileTransaction(connection, intent);
  if (['failed', 'expired'].includes(checked.state)) return checked;
  if (['confirmed', 'finalized'].includes(checked.state)) return { ...checked, state: 'confirmed' };
  if (action === 'cancel') throw new Error(`This initial buy already has a signed transaction whose outcome is pending or unknown. Skip cannot cancel a transaction that may already have reached the network. Signature: ${intent.signature}. Close this dialog and recheck the purchase later; its record has been kept.`);
  const details = intent.blockhash && Number.isSafeInteger(intent.lastValidBlockHeight)
    ? 'Its expiry can be checked by Recover transactions in Creator Studio.'
    : 'This saved attempt has no complete expiry metadata. Repeated quote requests cannot establish that it expired; inspect its signature in Transaction recovery.';
  throw new Error(`The previous initial buy is pending or unknown. Signature: ${intent.signature}. ${details}`);
}


export function purchaseWithRecovery(intent, transactions) {
  const record = transactions.find(row => row.signature === intent.signature && row.wallet === intent.wallet && row.mint === intent.mint);
  if (!intent.signature || !record) return intent;
  return { ...intent, blockhash: intent.blockhash || record.blockhash,
    lastValidBlockHeight: intent.lastValidBlockHeight ?? record.lastValidBlockHeight,
    signedTransaction: intent.signedTransaction || record.signedTransaction };
}
