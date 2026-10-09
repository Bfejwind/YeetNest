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

export async function reviewablePurchase(intent, connection) {
  if (!intent.signature) return intent;
  const { value } = await connection.getSignatureStatuses([intent.signature], { searchTransactionHistory: true });
  const status = value[0];
  if (status?.err) return { ...intent, state: 'failed' };
  if (['confirmed', 'finalized'].includes(status?.confirmationStatus)) return { ...intent, state: 'confirmed' };
  throw new Error('The previous initial buy is pending or unknown. Recheck it before preparing another purchase.');
}
