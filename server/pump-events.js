import { createRequire } from 'node:module';
import bs58 from 'bs58';
const { PUMP_SDK, PUMP_PROGRAM_ID, pumpIdl } = createRequire(import.meta.url)('@pump-fun/pump-sdk');
export const PUMP_PROGRAM = PUMP_PROGRAM_ID.toBase58();
const cpiPrefix = Buffer.from([228, 69, 165, 46, 81, 203, 154, 29]);
const decoders = { CreateEvent: bytes => PUMP_SDK.decodeCreateEventBc(bytes), TradeEvent: bytes => PUMP_SDK.decodeTradeEventBc(bytes), CompleteEvent: bytes => PUMP_SDK.decodeCompleteEventBc(bytes) };
const events = pumpIdl.events.filter(event => decoders[event.name]);
function decode(bytes, index) {
  const event = events.find(event => bytes.subarray(0, 8).equals(Buffer.from(event.discriminator)));
  return event ? { name: event.name, index, data: decoders[event.name](bytes.subarray(8)) } : null;
}

export function decodePumpEvents(transaction) {
  if (!transaction?.meta || transaction.meta.err) return [];
  const message = transaction.transaction.message;
  const keys = [...(message.staticAccountKeys || message.accountKeys), ...(transaction.meta.loadedAddresses?.writable || []), ...(transaction.meta.loadedAddresses?.readonly || [])].map(key => key.toBase58());
  const result = [];
  for (const group of transaction.meta.innerInstructions || []) for (const [i, instruction] of group.instructions.entries()) {
    if (keys[instruction.programIdIndex] !== PUMP_PROGRAM || !instruction.data) continue;
    const bytes = Buffer.from(bs58.decode(instruction.data));
    if (!bytes.subarray(0, 8).equals(cpiPrefix)) continue;
    const event = decode(bytes.subarray(8), `cpi:${group.index}:${i}`);
    if (event) result.push(event);
  }
  if (result.length) return result;
  const stack = [];
  for (const [i, line] of (transaction.meta.logMessages || []).entries()) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) { stack.push(invoke[1]); continue; }
    if (/^Program \w+ (success|failed:)/.test(line)) { stack.pop(); continue; }
    if (stack.at(-1) !== PUMP_PROGRAM || !line.startsWith('Program data: ')) continue;
    const event = decode(Buffer.from(line.slice(14), 'base64'), `log:${i}`);
    if (event) result.push(event);
  }
  return result;
}
