const COMPUTE = 'ComputeBudget111111111111111111111111111111';

export function validateComputeBudget(instructions, keys, maxFee = 1000000n) {
  let limit = 200000n, price = 0n;
  const seen = new Set();
  for (const instruction of instructions) {
    if (keys.get(instruction.programIdIndex)?.toBase58() !== COMPUTE) continue;
    const data = instruction.data;
    if (seen.has(data[0]) || instruction.accountKeyIndexes.length) throw new Error('Invalid compute budget instructions.');
    seen.add(data[0]);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data[0] === 2 && data.length === 5) {
      limit = BigInt(view.getUint32(1, true));
      if (limit < 1n || limit > 1400000n) throw new Error('Compute limit exceeds launch policy.');
    } else if (data[0] === 3 && data.length === 9) price = view.getBigUint64(1, true);
    else throw new Error('Unsupported compute budget instruction.');
  }
  // Reserve worst-case compute when no explicit limit is provided.
  if (!seen.has(2)) limit = 1400000n;
  if ((price * limit + 999999n) / 1000000n > maxFee) throw new Error('Priority fee exceeds the allowed cap.');
}

export function validateLaunchTransaction(transaction, keys, expected, { owner, mint, optionalAccounts = [] } = {}) {
  if (transaction.message.staticAccountKeys[0].toBase58() !== owner) throw new Error('Launch fee payer changed.');
  const signers = transaction.message.staticAccountKeys.slice(0, transaction.message.header.numRequiredSignatures).map(key => key.toBase58());
  if (signers.some(key => key !== owner && key !== mint)) throw new Error('Unexpected launch signer.');
  validateComputeBudget(transaction.message.compiledInstructions, keys);
  let creates = 0;
  for (const instruction of transaction.message.compiledInstructions) {
    const program = keys.get(instruction.programIdIndex)?.toBase58();
    if (program === COMPUTE) continue;
    if (program !== expected.programId.toBase58()) throw new Error('Unexpected program or transfer in launch transaction.');
    if (!Buffer.from(instruction.data).equals(expected.data)) throw new Error('Launch metadata, supply, curve, vesting or migration parameters changed.');
    const addresses = Array.from(instruction.accountKeyIndexes, index => keys.get(index)?.toBase58());
    const canonical = expected.keys.map(key => key.pubkey.toBase58());
    if (addresses.length < canonical.length || addresses.length > canonical.length + optionalAccounts.length) throw new Error('Launch account count changed.');
    if (canonical.some((key, index) => addresses[index] !== key)) throw new Error('Launch creator, configuration, vault or mint account changed.');
    if (addresses.slice(canonical.length).some((key, index) => key !== optionalAccounts[index])) throw new Error('Launch permission accounts changed.');
    for (let index = 0; index < expected.keys.length; index++) {
      const meta = expected.keys[index], account = instruction.accountKeyIndexes[index];
      if (meta.isSigner && !transaction.message.isAccountSigner(account)) throw new Error('Required launch signature is missing.');
      if (meta.isWritable && !transaction.message.isAccountWritable(account)) throw new Error('Required launch writable account changed.');
    }
    creates++;
  }
  if (creates !== 1) throw new Error('Launch must contain exactly one creation instruction.');
}
