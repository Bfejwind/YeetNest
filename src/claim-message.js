import { VersionedMessage, TransactionMessage, ComputeBudgetProgram } from '@solana/web3.js';
import { Buffer } from 'buffer';
export const LIGHTHOUSE_PROGRAM = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';

function guardedInstructions(before, after) {
  const original = before.instructions.filter(ix => !ix.programId.equals(ComputeBudgetProgram.programId));
  const returned = after.instructions.filter(ix => !ix.programId.equals(ComputeBudgetProgram.programId));
  const extras = returned.slice(original.length);
  const allowedAccounts = new Map(before.instructions.flatMap(ix => ix.keys.map(key => [key.pubkey.toBase58(), key])));
  if (extras.length > 8) return null;
  for (const ix of extras) {
    const data = Buffer.from(ix.data);
    // Only assertion variants; memory writes/closes can move lamports and are forbidden.
    if (ix.programId.toBase58() !== LIGHTHOUSE_PROGRAM || ![6, 9, 10].includes(data[0]) || data.length < 3 || data.length > 1024 || ix.keys.length !== 1) return null;
    const key = ix.keys[0], old = allowedAccounts.get(key.pubkey.toBase58());
    if (!old || key.isSigner !== old.isSigner || key.isWritable !== old.isWritable) return null;
  }
  return { original, returned: returned.slice(0, original.length) };
}

export function claimBlockhashOnlyChange(original, signedMessage) {
  const reviewed = VersionedMessage.deserialize(original);
  if (reviewed.recentBlockhash === signedMessage.recentBlockhash) return false;
  reviewed.recentBlockhash = signedMessage.recentBlockhash;
  return Buffer.from(reviewed.serialize()).equals(Buffer.from(signedMessage.serialize()));
}

export function walletMessageSummary(original, signed, addressLookupTableAccounts = []) {
  try {
    const reviewed = VersionedMessage.deserialize(original);
    const decode = message => TransactionMessage.decompile(message, { addressLookupTableAccounts }).instructions;
    const a = decode(reviewed), b = decode(signed);
    const budget = instructions => instructions.filter(ix => ix.programId.equals(ComputeBudgetProgram.programId)).map(ix => {
      const data = Buffer.from(ix.data);
      return data[0] === 2 && data.length === 5 ? `units=${data.readUInt32LE(1)}` : data[0] === 3 && data.length === 9 ? `price=${data.readBigUInt64LE(1)}` : `tag=${data[0]}`;
    }).join(',');
    const economic = instructions => instructions.filter(ix => !ix.programId.equals(ComputeBudgetProgram.programId));
    const first = economic(a), second = economic(b);
    const identical = first.length === second.length && first.every((ix, i) => ix.programId.equals(second[i].programId) && Buffer.from(ix.data).equals(Buffer.from(second[i].data)) && ix.keys.length === second[i].keys.length && ix.keys.every((key, j) => key.pubkey.equals(second[i].keys[j].pubkey) && key.isSigner === second[i].keys[j].isSigner && key.isWritable === second[i].keys[j].isWritable));
    const differences = [];
    if (first.length !== second.length) differences.push(`instruction count ${first.length}->${second.length}`);
    for (let i = 0; i < Math.max(first.length, second.length); i++) {
      const x = first[i], y = second[i];
      if (!x || !y) { differences.push(`instruction ${i + 1} ${x ? 'removed' : 'added'} program ${(x || y).programId.toBase58()}`); continue; }
      if (!x.programId.equals(y.programId)) differences.push(`instruction ${i + 1} program ${x.programId.toBase58()}->${y.programId.toBase58()}`);
      if (!Buffer.from(x.data).equals(Buffer.from(y.data))) differences.push(`instruction ${i + 1} data changed (${x.data.length}->${y.data.length} bytes)`);
      if (x.keys.length !== y.keys.length) differences.push(`instruction ${i + 1} account count ${x.keys.length}->${y.keys.length}`);
      for (let j = 0; j < Math.min(x.keys.length, y.keys.length); j++) {
        const k = x.keys[j], l = y.keys[j];
        if (!k.pubkey.equals(l.pubkey)) differences.push(`instruction ${i + 1} account ${j + 1} address changed`);
        else if (k.isSigner !== l.isSigner || k.isWritable !== l.isWritable) differences.push(`instruction ${i + 1} account ${j + 1} permissions signer ${k.isSigner}->${l.isSigner}, writable ${k.isWritable}->${l.isWritable}`);
      }
    }
    return `version ${reviewed.version}->${signed.version}; claim/trade instructions ${identical ? 'unchanged' : 'changed'}; ${differences.slice(0, 6).join('; ')}; budget [${budget(a)}]->[${budget(b)}]`;
  } catch { return 'message could not be safely decoded'; }
}

export function walletMessageReport(original, signed, addressLookupTableAccounts = []) {
  const describe = message => ({
    version: message.version,
    requiredSignatures: message.header.numRequiredSignatures,
    instructions: TransactionMessage.decompile(message, { addressLookupTableAccounts }).instructions.map(instruction => ({
      program: instruction.programId.toBase58(),
      dataHex: Buffer.from(instruction.data).toString('hex').slice(0, 1024),
      dataBytes: instruction.data.length,
      accounts: instruction.keys.map(key => ({ address: key.pubkey.toBase58(), signer: key.isSigner, writable: key.isWritable })),
    })),
  });
  return { summary: walletMessageSummary(original, signed, addressLookupTableAccounts), reviewed: describe(VersionedMessage.deserialize(original)), returned: describe(signed) };
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
    if ([...b].some(([key, flags]) => !a.has(key) && (![budgetKey, LIGHTHOUSE_PROGRAM].includes(key) || flags !== 'false:false'))) return false;
    const guarded = guardedInstructions(before, after);
    if (!guarded) return false;
    const first = guarded.original, second = guarded.returned;
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
