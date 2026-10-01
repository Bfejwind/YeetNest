import test from 'node:test';
import assert from 'node:assert/strict';
import converter from '../vendor/bigint-buffer/index.cjs';

test('bounded bigint conversion preserves unsigned integer byte order', () => {
  for (const value of [0n, 1n, 255n, 256n, 18446744073709551615n]) {
    assert.equal(converter.toBigIntBE(converter.toBufferBE(value, 8)), value);
    assert.equal(converter.toBigIntLE(converter.toBufferLE(value, 8)), value);
  }
  assert.equal(converter.toBigIntBE(Buffer.alloc(0)), 0n);
  assert.equal(converter.toBufferBE(0n, 0).length, 0);
  assert.throws(() => converter.toBufferBE(256n, 1));
  assert.throws(() => converter.toBufferLE(-1n, 8));
  assert.throws(() => converter.toBufferBE(0n, 100000000));
});
