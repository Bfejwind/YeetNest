import test from 'node:test';
import assert from 'node:assert/strict';
import { indexerErrorCode } from '../server/indexer-error.js';

test('indexer diagnostics classify provider errors without exposing messages or credentials', () => {
  assert.equal(indexerErrorCode(new Error('429 Too Many Requests https://rpc.example/?api-key=secret')), 'RPC_RATE_LIMIT');
  assert.equal(indexerErrorCode(new Error('403 Forbidden secret')), 'RPC_AUTH_ERROR');
  assert.equal(indexerErrorCode(new Error('fetch failed')), 'RPC_NETWORK_ERROR');
  assert.equal(indexerErrorCode(new Error('Finalized transaction not available')), 'RPC_HISTORY_UNAVAILABLE');
  assert.equal(indexerErrorCode({ code: -32015 }), -32015);
  assert.equal(indexerErrorCode({ code: -32005 }), 'RPC_RATE_LIMIT');
  assert.equal(indexerErrorCode(new Error('Indexed Pump curve ownership is invalid.')), 'INDEX_VALIDATION_FAILED');
  assert.equal(indexerErrorCode(new Error('anything secret')), 'PROCESSING_ERROR');
});
