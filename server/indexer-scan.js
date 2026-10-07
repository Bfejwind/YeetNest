// Events are committed before cursors. Replays after a crash are deduplicated by the store.
export async function scanPage({ connection, program, state, processSignature, limit = 20, backfill = false }) {
  const before = backfill ? state.backfillBefore : state.catchupBefore;
  if (backfill && state.backfillComplete) return state;
  const rows = await connection.getSignaturesForAddress(program, { limit, ...(before ? { before } : {}) }, 'finalized');
  const next = { ...state };
  if (backfill) {
    for (const row of [...rows].reverse()) if (!row.err) await processSignature(row);
    next.backfillBefore = rows.at(-1)?.signature || before;
    next.backfillComplete = rows.length === 0;
    return next;
  }
  if (!rows.length) return { ...next, head: next.pendingHead || next.head, catchupBefore: null, pendingHead: null };
  next.pendingHead ||= rows[0].signature;
  const stop = rows.findIndex(row => row.signature === state.head);
  const unseen = stop >= 0 ? rows.slice(0, stop) : rows;
  for (const row of [...unseen].reverse()) if (!row.err) await processSignature(row);
  if (!state.head || stop >= 0 || rows.length < limit) {
    next.head = next.pendingHead;
    next.pendingHead = null;
    next.catchupBefore = null;
    next.backfillBefore ||= rows.at(-1).signature;
  } else next.catchupBefore = rows.at(-1).signature;
  return next;
}
