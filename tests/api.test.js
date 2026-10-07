import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import nacl from 'tweetnacl';
import { Keypair, TransactionMessage, VersionedTransaction, SystemProgram } from '@solana/web3.js';
import { createApi } from '../server/api.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppStore } from '../server/app-store.js';
import { PNG } from 'pngjs';

async function withApi(fetcher, callback, config = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'yeetnest-test-'));
  const app = express(); app.use(createApi({ fetcher, config, storageDir: directory }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, headers = {}, method = 'POST', hostname = '127.0.0.1') => fetch(root.replace('127.0.0.1', hostname) + '/api' + path, body === undefined ? { headers } : { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try { await callback(request, directory); } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}
const ok = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('metadata upload decodes PNG and persists references using a controlled Pinata response', async () => {
  let uploads = 0;
  await withApi(async url => {
    assert.equal(url, 'https://uploads.pinata.cloud/v3/files');
    uploads++;
    return ok({ data: { cid: uploads === 1 ? 'TestImageCid' : 'TestMetadataCid' } });
  }, async (request, directory) => {
    const wallet = Keypair.generate();
    const challenge = await (await request('/auth/challenge', { wallet: wallet.publicKey.toBase58() })).json();
    const signature = Buffer.from(nacl.sign.detached(Buffer.from(challenge.message), wallet.secretKey)).toString('base64');
    const { token } = await (await request('/auth/verify', { nonce: challenge.nonce, signature })).json();
    const headers = { Authorization: `Bearer ${token}` };
    const png = PNG.sync.write({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) });
    const fields = { name: 'Upload Test', ticker: 'TEST', description: 'Controlled provider test' };
    const malformed = Buffer.from(png); malformed[malformed.length - 1] ^= 255;
    assert.equal((await request('/metadata', { ...fields, image: 'data:image/png;base64,' + malformed.toString('base64') }, headers)).status, 400);
    const response = await request('/metadata', { ...fields, image: 'data:image/png;base64,' + png.toString('base64') }, headers);
    assert.equal(response.status, 200);
    const uploaded = await response.json();
    assert.equal(uploads, 2);
    const reopened = createAppStore({ directory });
    const references = await reopened.get('upload-references');
    assert.equal(references[0][1].wallet, wallet.publicKey.toBase58());
    assert.equal(references[0][1].uri, uploaded.uri);
    await reopened.close();
  }, { PINATA_JWT: 'controlled-test-token' });
});

test('connection diagnostics include community storage and verify mainnet', async () => {
  const mainnet = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
  await withApi(async url => ok(url.includes('solana.com') ? { result: mainnet } : []), async request => {
    const { checks } = await (await request('/health')).json();
    assert.equal(checks.length, 4);
    assert.equal(checks.find(c => c.name === 'Solana RPC').ok, true);
    assert.equal(checks.find(c => c.name === 'Community storage').ok, true);
    assert.equal(checks.find(c => c.name === 'Public uploads').ok, false);
  });
});

test('shared community uses signed identity, owner deletion and private reports', async () => {
  await withApi(async () => ok({}), async request => {
    const login = async wallet => {
      const challenge = await (await request('/auth/challenge', { wallet: wallet.publicKey.toBase58() })).json();
      const signature = Buffer.from(nacl.sign.detached(Buffer.from(challenge.message), wallet.secretKey)).toString('base64');
      const { token } = await (await request('/auth/verify', { nonce: challenge.nonce, signature })).json();
      return { Authorization: `Bearer ${token}` };
    };
    const owner = Keypair.generate(), stranger = Keypair.generate();
    const a = await login(owner), b = await login(stranger);
    const mint = Keypair.generate().publicKey.toBase58();
    const endpoint = `/community/coins/${mint}/comments`;
    assert.equal((await request('/community/profile', { name: 'Fake' })).status, 401);
    const saved = await (await request('/community/profile', { name: 'Creator', bio: 'Hello', wallet: stranger.publicKey.toBase58() }, a)).json();
    assert.equal(saved.wallet, owner.publicKey.toBase58());
    assert.equal((await (await request(`/community/profiles/${saved.wallet}`)).json()).name, 'Creator');
    assert.equal((await request(endpoint, { body: 'No identity' })).status, 401);
    const post = await (await request(endpoint, { body: '<script>alert(1)</script>' }, a)).json();
    const posts = await (await request(endpoint)).json();
    assert.equal(posts[0].body, '<script>alert(1)</script>');
    assert.equal(posts[0].author, 'Creator');
    assert.equal((await request(`/community/comments/${post.id}`, {}, b, 'DELETE')).status, 404);
    assert.equal((await request(`/community/comments/${post.id}/report`, { reason: 'spam' })).status, 401);
    for (let i = 0; i < 2; i++) {
      const report = await (await request(`/community/comments/${post.id}/report`, { reason: 'spam' }, b)).json();
      assert.equal(report.recorded, true);
      assert.equal(report.moderationService, false);
    }
    assert.equal((await request(endpoint, { body: 'x'.repeat(501) }, a)).status, 400);
    assert.equal((await request('/community/coins/invalid/comments')).status, 400);
    assert.equal((await request(`/community/comments/${post.id}`, {}, a, 'DELETE')).status, 200);
    assert.deepEqual(await (await request(endpoint)).json(), []);
    assert.equal((await request('/watchlist')).status, 401);
    assert.equal((await request('/watchlist', { mints: [mint] }, a, 'PUT')).status, 200);
    assert.deepEqual(await (await request('/watchlist', undefined, a)).json(), [mint]);
    assert.deepEqual(await (await request('/watchlist', undefined, b)).json(), []);
    assert.equal((await request('/watchlist', { mints: ['invalid'] }, a, 'PUT')).status, 400);
    assert.equal((await request('/metadata', { name: 'Test', ticker: 'TEST', image: 'data:image/png;base64,AAAA' }, a)).status, 400);
  });
});

test('community JSON fallback persists and serializes concurrent writes', async () => {
  const { createCommunityStore } = await import('../server/community-store.js');
  const directory = await mkdtemp(join(tmpdir(), 'yeetnest-community-'));
  try {
    const store = createCommunityStore({ directory });
    await store.ready();
    await store.saveProfile('wallet', { name: 'Creator', bio: '' });
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.addPost('mint', 'wallet', `Comment ${i}`)));
    await store.close();
    const reopened = createCommunityStore({ directory });
    await reopened.ready();
    assert.equal((await reopened.listPosts('mint')).length, 20);
    assert.equal((await reopened.getProfile('wallet')).name, 'Creator');
    await reopened.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

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
    const other = await (await request('/auth/challenge', { wallet: wallet.publicKey.toBase58() })).json();
    const otherSignature = Buffer.from(nacl.sign.detached(Buffer.from(other.message), wallet.secretKey)).toString('base64');
    assert.equal((await request('/auth/verify', { nonce: other.nonce, signature: otherSignature }, {}, 'POST', 'localhost')).status, 401);
    const expired = await (await request('/auth/challenge', { wallet: wallet.publicKey.toBase58() })).json();
    const expiredSignature = Buffer.from(nacl.sign.detached(Buffer.from(expired.message), wallet.secretKey)).toString('base64');
    const now = Date.now;
    try {
      Date.now = () => now() + 300001;
      assert.equal((await request('/auth/verify', { nonce: expired.nonce, signature: expiredSignature })).status, 401);
    } finally { Date.now = now; }
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
