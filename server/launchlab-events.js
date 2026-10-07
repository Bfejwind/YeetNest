import { readFileSync } from 'node:fs';
import * as borsh from '@coral-xyz/borsh';
import bs58 from 'bs58';

// Raydium IDL pinned to e7e0c96fe77bcf6a020b84a44c47a722aac8e359.
const idl = JSON.parse(readFileSync(new URL('./launchlab-idl.json', import.meta.url)));
export const LAUNCHLAB_PROGRAM = idl.address;
const definitions = new Map(idl.types.map(type => [type.name, type.type]));
function layout(type, name) {
  if (typeof type === 'string') {
    if (type === 'pubkey') return borsh.publicKey(name);
    if (type === 'string') return borsh.str(name);
    if (typeof borsh[type] !== 'function') throw new Error(`Unsupported IDL primitive: ${type}`);
    return borsh[type](name);
  }
  if (type.defined) return definition(type.defined.name, name);
  if (type.array) return borsh.array(layout(type.array[0]), type.array[1], name);
  throw new Error('Unsupported IDL type.');
}
function definition(typeName, name) {
  const type = definitions.get(typeName);
  if (type.kind === 'struct') return borsh.struct(type.fields.map(field => layout(field.type, field.name)), name);
  if (type.kind === 'enum') {
    const result = borsh.rustEnum(type.variants.map(variant => borsh.struct((variant.fields || []).map(field => layout(field.type, field.name)), variant.name)));
    return name ? result.replicate(name) : result;
  }
  throw new Error('Unsupported IDL definition.');
}
const events = idl.events.map(event => ({ name: event.name, prefix: Buffer.from(event.discriminator), layout: definition(event.name) }));
const cpiPrefix = Buffer.from([228, 69, 165, 46, 81, 203, 154, 29]);
const serializable = value => {
  if (value?.toBase58) return value.toBase58();
  if (value?.constructor?.name === 'BN') return value.toString();
  if (Array.isArray(value)) return value.map(serializable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializable(item)]));
  return value;
};
function decode(bytes, index) {
  const event = events.find(event => bytes.subarray(0, 8).equals(event.prefix));
  if (!event) return null;
  return { index, name: event.name, data: serializable(event.layout.decode(bytes.subarray(8))) };
}
export function decodeLaunchlabEvents(transaction) {
  if (!transaction?.meta || transaction.meta.err) return [];
  const message = transaction.transaction.message;
  const keys = [...(message.staticAccountKeys || message.accountKeys), ...(transaction.meta.loadedAddresses?.writable || []), ...(transaction.meta.loadedAddresses?.readonly || [])].map(key => key.toBase58 ? key.toBase58() : String(key));
  const cpi = [];
  for (const group of transaction.meta.innerInstructions || []) {
    for (let i = 0; i < group.instructions.length; i++) {
      const instruction = group.instructions[i];
      if (keys[instruction.programIdIndex] !== LAUNCHLAB_PROGRAM || !instruction.data) continue;
      const bytes = Buffer.from(bs58.decode(instruction.data));
      if (!bytes.subarray(0, 8).equals(cpiPrefix)) continue;
      const event = decode(bytes.subarray(8), `cpi:${group.index}:${i}`);
      if (event) cpi.push(event);
    }
  }
  if (cpi.length) return cpi;
  const stack = [], result = [];
  for (const [index, line] of (transaction.meta.logMessages || []).entries()) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) { stack.push(invoke[1]); continue; }
    if (/^Program \w+ (success|failed:)/.test(line)) { stack.pop(); continue; }
    if (stack.at(-1) !== LAUNCHLAB_PROGRAM || !line.startsWith('Program data: ')) continue;
    const event = decode(Buffer.from(line.slice(14), 'base64'), `log:${index}`);
    if (event) result.push(event);
  }
  return result;
}

export function tradeAmounts(data) {
  const buy = Object.hasOwn(data.trade_direction, 'Buy');
  const beforeBase = BigInt(data.real_base_before), afterBase = BigInt(data.real_base_after);
  const beforeQuote = BigInt(data.real_quote_before), afterQuote = BigInt(data.real_quote_after);
  const base = buy ? afterBase - beforeBase : beforeBase - afterBase;
  const quote = buy ? afterQuote - beforeQuote : beforeQuote - afterQuote;
  if (base <= 0n || quote <= 0n) throw new Error('Invalid curve reserve deltas.');
  return { side: buy ? 'buy' : 'sell', base: base.toString(), quote: quote.toString(), fees: ['protocol_fee', 'platform_fee', 'creator_fee', 'share_fee'].reduce((sum, key) => sum + BigInt(data[key]), 0n).toString() };
}
