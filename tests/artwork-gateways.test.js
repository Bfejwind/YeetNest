import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkGateways } from '../src/artwork-gateways.js';

test('gateway retries preserve the exact IPFS content and path', () => {
  assert.deepEqual(artworkGateways('https://ipfs.io/ipfs/QmExample/logo.png'), [
    'https://gateway.pinata.cloud/ipfs/QmExample/logo.png', 'https://dweb.link/ipfs/QmExample/logo.png',
  ]);
  assert.equal(artworkGateways('ipfs://QmExample/logo.png')[0], 'https://gateway.pinata.cloud/ipfs/QmExample/logo.png');
  assert.equal(artworkGateways('https://bafkexample.ipfs.w3s.link/logo.png')[0], 'https://gateway.pinata.cloud/ipfs/bafkexample/logo.png');
  assert.deepEqual(artworkGateways('https://official.example/logo.png'), []);
});
