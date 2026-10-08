// Processing or durable enqueue must finish before a cursor can advance.
export async function scanPage({ connection, program, state, processSignature, enqueue, limit = 20, backfill = false }) {
  const before = backfill ? state.backfillBefore : state.catchupBefore;
  if (backfill && state.backfillComplete) return state;
  const rows = await connection.getSignaturesForAddress(program, { limit, ...(before ? { before } : {}) }, 'finalized');
  const next = { ...state };
  const commit = async rows => {
    const successful = [...rows].reverse().filter(row => !row.err);
    if (enqueue) await enqueue(successful);
    else for (const row of successful) await processSignature(row);
  };
  if (backfill) {
    await commit(rows);
    next.backfillBefore = rows.at(-1)?.signature || before;
    next.backfillComplete = rows.length === 0;
    return next;
  }
  if (!rows.length) return { ...next, head: next.pendingHead || next.head, catchupBefore: null, pendingHead: null };
  next.pendingHead ||= rows[0].signature;
  const stop = rows.findIndex(row => row.signature === state.head);
  const unseen = stop >= 0 ? rows.slice(0, stop) : rows;
  await commit(unseen);
  if (!state.head || stop >= 0 || rows.length < limit) {
    next.head = next.pendingHead;
    next.pendingHead = null;
    next.catchupBefore = null;
    next.backfillBefore ||= rows.at(-1).signature;
  } else next.catchupBefore = rows.at(-1).signature;
  return next;
}
