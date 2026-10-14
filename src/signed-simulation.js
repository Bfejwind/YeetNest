export async function simulateSignedFresh(connection, transaction, { minContextSlot = 0, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let result;
    try {
      result = await connection.simulateTransaction(transaction, {
        sigVerify: true, replaceRecentBlockhash: false, commitment: 'confirmed',
        ...(minContextSlot > 0 ? { minContextSlot } : {}),
      });
    } catch (error) {
      if (attempt < 2 && /minimum context slot|blockhash not found/i.test(error.message || '')) { await sleep(500); continue; }
      throw error;
    }
    if (result.value.err !== 'BlockhashNotFound') return result;
    minContextSlot = Math.max(minContextSlot, result.context?.slot || 0);
    const valid = await connection.isBlockhashValid(transaction.message.recentBlockhash, { commitment: 'confirmed', ...(minContextSlot > 0 ? { minContextSlot } : {}) });
    if (!valid.value) throw new Error('Signed transaction blockhash is unavailable or expired. Nothing was broadcast. Request a fresh quote or claim and approve again.');
    minContextSlot = Math.max(minContextSlot, valid.context?.slot || 0);
    if (attempt < 2) await sleep(500);
  }
  throw new Error('RPC nodes could not simulate the signed blockhash consistently. Nothing was broadcast. Request a fresh quote and retry.');
}
