import { VersionedMessage, TransactionMessage, ComputeBudgetProgram } from '@solana/web3.js';
import { Buffer } from 'buffer';

export function claimBlockhashOnlyChange(original, signedMessage) {
  const reviewed = VersionedMessage.deserialize(original);
  if (reviewed.recentBlockhash === signedMessage.recentBlockhash) return false;
  reviewed.recentBlockhash = signedMessage.recentBlockhash;
  return Buffer.from(reviewed.serialize()).equals(Buffer.from(signedMessage.serialize()));
}

export function claimWalletAdjustment(original, signedMessage, { addressLookupTableAccounts = [], maxComputeUnits = 400000 } = {}) {
  try {
    const reviewed = VersionedMessage.deserialize(original);
    if (reviewed.version !== signedMessage.version) return false;
    const lookups = message => (message.addressTableLookups || []).map(table => ({ key: table.accountKey.toBase58(), writable: [...table.writableIndexes], readonly: [...table.readonlyIndexes] }));
    if (JSON.stringify(lookups(reviewed)) !== JSON.stringify(lookups(signedMessage))) return false;
    const before = TransactionMessage.decompile(reviewed, { addressLookupTableAccounts }), after = TransactionMessage.decompile(signedMessage, { addressLookupTableAccounts });
    if (!before.payerKey.equals(after.payerKey) || reviewed.header.numRequiredSignatures !== signedMessage.header.numRequiredSignatures) return false;
    const permissions = message => new Map(message.staticAccountKeys.map((key, i) => [key.toBase58(), `${message.isAccountSigner(i)}:${message.isAccountWritable(i)}`]));
    const a = permissions(reviewed), b = permissions(signedMessage);
    const budgetKey = ComputeBudgetProgram.programId.toBase58();
    if ([...a].some(([key, flags]) => b.get(key) !== flags)) return false;
    if ([...b].some(([key, flags]) => !a.has(key) && (key !== budgetKey || flags !== 'false:false'))) return false;
    const claims = message => message.instructions.filter(instruction => !instruction.programId.equals(ComputeBudgetProgram.programId));
    const first = claims(before), second = claims(after);
    if (first.length !== second.length || !first.length) return false;
    for (let i = 0; i < first.length; i++) {
      const x = first[i], y = second[i];
      if (!x.programId.equals(y.programId) || !Buffer.from(x.data).equals(Buffer.from(y.data)) || x.keys.length !== y.keys.length) return false;
      if (x.keys.some((key, n) => !key.pubkey.equals(y.keys[n].pubkey) || key.isSigner !== y.keys[n].isSigner || key.isWritable !== y.keys[n].isWritable)) return false;
    }
    let units = 0, price = 0n;
    const seen = new Set();
    for (const instruction of after.instructions.filter(instruction => instruction.programId.equals(ComputeBudgetProgram.programId))) {
      const data = Buffer.from(instruction.data), tag = data[0];
      if (instruction.keys.length || seen.has(tag)) return false;
      seen.add(tag);
      if (tag === 2 && data.length === 5) units = data.readUInt32LE(1);
      else if (tag === 3 && data.length === 9) price = data.readBigUInt64LE(1);
      else return false;
    }
    return units > 0 && units <= maxComputeUnits && (BigInt(units) * price + 999999n) / 1000000n <= 10000000n;
  } catch { return false; }
}
