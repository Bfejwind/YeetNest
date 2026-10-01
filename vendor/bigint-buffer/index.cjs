const { Buffer } = require('buffer');

// Avoid bigint-buffer's vulnerable native addon; only bounded JavaScript conversion is needed.
function toBigIntBE(value) {
  const hex = Buffer.from(value).toString('hex');
  return hex ? BigInt(`0x${hex}`) : 0n;
}
function toBigIntLE(value) { return toBigIntBE(Buffer.from(value).reverse()); }
function toBufferBE(value, width) {
  if (!Number.isSafeInteger(width) || width < 0 || width > 1048576) throw new RangeError('Invalid buffer width');
  const number = BigInt(value);
  if (number < 0n || number >= (1n << BigInt(width * 8))) throw new RangeError('Integer does not fit in buffer');
  return width ? Buffer.from(number.toString(16).padStart(width * 2, '0'), 'hex') : Buffer.alloc(0);
}
function toBufferLE(value, width) { return toBufferBE(value, width).reverse(); }
module.exports = { toBigIntBE, toBigIntLE, toBufferBE, toBufferLE };
