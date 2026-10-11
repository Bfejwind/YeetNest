import test from 'node:test';
import assert from 'node:assert/strict';
import { isRealCoin, mergeCoin } from '../src/coin-catalogue.js';

const mint = 'So11111111111111111111111111111111111111112';
test('live catalogue rejects demo entries and invalid mint addresses', () => {
  assert.equal(isRealCoin({ mint, source: 'Jupiter' }), true);
  for (const coin of [{ mint: 'old-demo' }, { mint, demo: true }, { mint, simulated: true }, { mint, source: 'Sample market' }]) assert.equal(isRealCoin(coin), false);
});
test('merging indexed data preserves real provider artwork unless explicitly replaced', () => {
  const previous = { mint, image: 'https://example.com/token.png' };
  assert.equal(mergeCoin(previous, { mint, image: '' }).image, previous.image);
  assert.equal(mergeCoin(previous, { mint, image: 'https://example.com/creator.png' }).image, 'https://example.com/creator.png');
});
