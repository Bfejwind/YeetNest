import { SystemInstruction, TransactionInstruction } from '@solana/web3.js';

export function validateCurveInstruction(transaction, keys, expected) {
  const allowed = new Set([expected.program, '11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'ComputeBudget111111111111111111111111111111']);
  if (transaction.message.compiledInstructions.filter(ix => keys.get(ix.programIdIndex)?.toBase58() === expected.program).length !== 1) throw new Error('Unexpected number of curve instructions.');
  for (const ix of transaction.message.compiledInstructions) {
    const program = keys.get(ix.programIdIndex)?.toBase58();
    if (!allowed.has(program)) throw new Error('Unexpected instruction program in curve transaction.');
    if (program === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && ![1, 9, 17].includes(ix.data[0])) throw new Error('Unexpected token transfer or authority instruction.');
  }
  const instruction = transaction.message.compiledInstructions.find(ix => keys.get(ix.programIdIndex)?.toBase58() === expected.program);
  if (!instruction || instruction.data.length !== 32) throw new Error('Curve transaction instruction is missing or invalid.');
  const discriminator = expected.side === 'Buy' ? [250, 234, 13, 123, 213, 156, 19, 236] : [149, 39, 222, 155, 211, 124, 152, 26];
  if (!discriminator.every((value, i) => instruction.data[i] === value)) throw new Error('Curve trade instruction does not match the reviewed side.');
  const view = new DataView(instruction.data.buffer, instruction.data.byteOffset, instruction.data.byteLength);
  if (view.getBigUint64(8, true).toString() !== expected.input || view.getBigUint64(16, true).toString() !== expected.minimum || view.getBigUint64(24, true) !== 0n) throw new Error('Curve amounts, slippage limit or sharing fee changed.');
  for (const [index, address] of [[0, expected.owner], [4, expected.pool], [5, expected.userA], [7, expected.vaultA], [8, expected.vaultB], [9, expected.mintA], [10, expected.mintB]]) {
    if (keys.get(instruction.accountKeyIndexes[index])?.toBase58() !== address) throw new Error('Curve transaction destination accounts changed.');
  }
  const userB = keys.get(instruction.accountKeyIndexes[6])?.toBase58();
  let systemDebit = 0n;
  for (const ix of transaction.message.compiledInstructions) {
    const program = keys.get(ix.programIdIndex)?.toBase58();
    const addresses = Array.from(ix.accountKeyIndexes, index => keys.get(index));
    if (program === '11111111111111111111111111111111') {
      const decoded = new TransactionInstruction({ programId: keys.get(ix.programIdIndex), keys: addresses.map(pubkey => ({ pubkey, isSigner: false, isWritable: true })), data: Buffer.from(ix.data) });
      const type = SystemInstruction.decodeInstructionType(decoded);
      const value = type === 'Transfer' ? SystemInstruction.decodeTransfer(decoded)
        : type === 'CreateWithSeed' ? SystemInstruction.decodeCreateWithSeed(decoded)
        : type === 'Create' ? SystemInstruction.decodeCreateAccount(decoded) : null;
      if (!value || value.fromPubkey.toBase58() !== expected.owner || (value.toPubkey || value.newAccountPubkey).toBase58() !== userB) throw new Error('Unexpected SOL transfer destination.');
      if (value.programId && value.programId.toBase58() !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') throw new Error('Unexpected wrapped SOL account owner.');
      systemDebit += BigInt(value.lamports);
    }
    if (program === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && ix.data[0] === 9
      && (addresses[0]?.toBase58() !== userB || addresses[1]?.toBase58() !== expected.owner || addresses[2]?.toBase58() !== expected.owner)) throw new Error('Unexpected wrapped SOL refund destination.');
  }
  if (systemDebit > BigInt(expected.maxSystemLamports || '0')) throw new Error('SOL funding exceeds the reviewed amount and account rent.');
  if (userB !== expected.userB) {
    const initialized = transaction.message.compiledInstructions.some(ix => keys.get(ix.programIdIndex)?.toBase58() === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
      && ix.data.length === 1 && ix.data[0] === 1
      && keys.get(ix.accountKeyIndexes[0])?.toBase58() === userB
      && keys.get(ix.accountKeyIndexes[1])?.toBase58() === expected.mintB
      && keys.get(ix.accountKeyIndexes[2])?.toBase58() === expected.owner);
    if (!initialized) throw new Error('Wrapped SOL destination is not a reviewed wallet-owned account.');
  }
  if (transaction.message.staticAccountKeys[0].toBase58() !== expected.owner) throw new Error('Unexpected transaction fee payer.');
}
