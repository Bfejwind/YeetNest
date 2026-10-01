import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import nacl from 'tweetnacl';
import { Keypair, TransactionMessage, VersionedTransaction, SystemProgram } from '@solana/web3.js';
import { createApi } from '../server/api.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withApi(fetcher, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'yeetnest-test-'));
  const app = express(); app.use(createApi({ fetcher, config: {}, storageDir: directory }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, headers = {}) => fetch(root + '/api' + path, body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try { await callback(request); } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}
const ok = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('local setup protects writes, hides secrets and validates provider URLs', async () => {
  await withApi(async () => ok({}), async request => {
    const setup = await (await request('/setup')).json();
    assert.equal((await request('/setup', { PINATA_JWT: 'secret' })).status, 403);
    const headers = { 'x-setup-token': setup.token };
    assert.equal((await request('/setup', { SOLANA_RPC_URL: 'http://localhost:9000' }, headers)).status, 400);
    assert.equal((await request('/setup', { PINATA_JWT: 'private-test-secret', PUBLIC_BASE_URL: 'https://yeetnest.example' }, headers)).status, 200);
    const response = await (await request('/setup')).text();
    assert.ok(!response.includes('private-test-secret'));
    assert.equal(JSON.parse(response).configured.PINATA_JWT, true);
    assert.equal((await (await request('/status')).json()).uploadProvider, 'Pinata');
  });
});

test('market data never invents candles when a token has no indexed pool', async () => {
  await withApi(async () => ok([]), async request => {
    const response = await request('/market/' + Keypair.generate().publicKey.toBase58());
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).candles, []);
  });
});

test('wallet authentication verifies signatures and prevents challenge replay', async () => {
  await withApi(async () => ok({}), async request => {
    const wallet = Keypair.generate();
    const challenge = await (await request('/auth/challenge', { wallet: wallet.publicKey.toBase58() })).json();
    const signature = Buffer.from(nacl.sign.detached(Buffer.from(challenge.message), wallet.secretKey)).toString('base64');
    const response = await request('/auth/verify', { nonce: challenge.nonce, signature });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).token);
    assert.equal((await request('/auth/verify', { nonce: challenge.nonce, signature })).status, 401);
    assert.equal((await request('/metadata', {})).status, 401);
  });
});

test('RPC allowlist and cross-origin checks block unrelated requests', async () => {
  await withApi(async () => { throw new Error('Should not call upstream'); }, async request => {
    assert.equal((await request('/rpc', { method: 'getProgramAccounts', params: [] })).status, 400);
    assert.equal((await request('/status', undefined, { Origin: 'https://unrelated.example' })).status, 403);
  });
});

test('swap execution verifies the reviewed message and wallet signature', async () => {
  const wallet = Keypair.generate();
  const makeTx = lamports => new VersionedTransaction(new TransactionMessage({
    payerKey: wallet.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports })],
  }).compileToV0Message());
  const original = makeTx(1);
  let executions = 0;
  await withApi(async url => {
    if (url.includes('/order?')) return ok({ requestId: 'reviewed-order', transaction: Buffer.from(original.serialize()).toString('base64'), outAmount: '1' });
    executions++; return ok({ status: 'Success', signature: 'test-signature' });
  }, async request => {
    const params = new URLSearchParams({ inputMint: SystemProgram.programId.toBase58(), outputMint: Keypair.generate().publicKey.toBase58(), amount: '1', taker: wallet.publicKey.toBase58() });
    assert.equal((await request('/swap/order?' + params)).status, 200);
    const tampered = makeTx(1000); tampered.sign([wallet]);
    const send = tx => request('/swap/execute', { requestId: 'reviewed-order', signedTransaction: Buffer.from(tx.serialize()).toString('base64') });
    assert.equal((await send(tampered)).status, 403);
    assert.equal((await send(original)).status, 403);
    original.sign([wallet]);
    assert.equal((await send(original)).status, 200);
    assert.equal(executions, 1);
    assert.equal((await send(original)).status, 410);
  });
});

test('upstream failures are never reported as successful execution', async () => {
  await withApi(async () => new Response('{}', { status: 429 }), async request => {
    const response = await request('/tokens');
    assert.equal(response.status, 429);
    assert.ok((await response.json()).error);
  });
});
