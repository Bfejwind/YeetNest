import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCandles } from '../src/chart-candles.js';
test('chart aggregates OHLC and volume chronologically without filling gaps', () => {
  assert.deepEqual(aggregateCandles([[900, 3, 5, 2, 4, 7], [600, 1, 3, 1, 3, 2], [3600, 4, 6, 4, 5, 1], [4000, 8, 1, 2, 3]], 1800), [
    { time: 0, open: 1, high: 5, low: 1, close: 4, volume: 9 },
    { time: 3600, open: 4, high: 6, low: 4, close: 5, volume: 1 },
  ]);
});
