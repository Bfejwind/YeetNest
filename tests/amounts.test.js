import test from 'node:test';
import assert from 'node:assert/strict';
import { fromUnits, toUnits } from '../src/amounts.js';

test('exact raw token units avoid floating point rounding', () => {
  assert.equal(toUnits('0.000000001', 9), '1');
  assert.equal(toUnits('123456789.123456', 6), '123456789123456');
  assert.equal(fromUnits('123456789123456', 6), '123456789.123456');
  assert.equal(fromUnits('1000000000', 9), '1');
});
test('invalid or unsafe amounts are rejected', () => {
  for (const amount of ['-1', '0', 'NaN', '1e9', '.1', '0.0000000001', '18446744073709551616']) {
    assert.throws(() => toUnits(amount, 9));
  }
});
