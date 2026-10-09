import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenMetadata, metadataUrl } from '../server/token-metadata.js';

test('metadata uses approved HTTPS gateways and bounds JSON and artwork URLs', async () => {
  assert.equal(metadataUrl('ipfs://QmTest/image.png'), 'https://gateway.pinata.cloud/ipfs/QmTest/image.png');
  for (const url of ['http://ipfs.io/ipfs/test', 'https://localhost/x', 'https://127.0.0.1/', 'https://ipfs.io@example.com/ipfs/x', 'https://ipfs.io:999/ipfs/x', 'https://ipfs.io/api/v0/x']) assert.throws(() => metadataUrl(url));
  let calls = 0;
  const fetcher = async (_, options) => { calls++; assert.equal(options.redirect, 'error'); return new Response(JSON.stringify({ description: '<script>' + 'a'.repeat(800), image: 'ipfs://Test/image.png' })); };
  const read = createTokenMetadata({ fetcher });
  const [a, b] = await Promise.all([read('ipfs://Test/metadata.json'), read('ipfs://Test/metadata.json')]);
  assert.equal(a.description.length, 500); assert.deepEqual(a, b); assert.equal(calls, 1);
  await read('ipfs://Test/metadata.json'); assert.equal(calls, 1);
  await assert.rejects(createTokenMetadata({ fetcher: async () => new Response('a'.repeat(65537)) })('ipfs://Test/large'), /64 KB/);
  await assert.rejects(createTokenMetadata({ fetcher: async () => new Response('null') })('ipfs://Test/bad'), /Invalid/);
  const unsafe = await createTokenMetadata({ fetcher: async () => Response.json({ image: 'https://localhost/private' }) })('ipfs://Test/unsafe');
  assert.equal(unsafe.image, null);
});

test('metadata cache eviction, expiration, failures and concurrency are bounded', async () => {
  let time = 0, calls = 0;
  const read = createTokenMetadata({ now: () => time, capacity: 1, fetcher: async () => { calls++; return Response.json({}); } });
  await read('ipfs://A'); await read('ipfs://B'); await read('ipfs://A'); assert.equal(calls, 3);
  time += 900001; await read('ipfs://A'); assert.equal(calls, 4);
  let release;
  const limited = createTokenMetadata({ concurrency: 1, fetcher: () => new Promise(resolve => { release = resolve; }) });
  const first = limited('ipfs://A');
  await assert.rejects(limited('ipfs://B'), { status: 503 });
  release(Response.json({})); await first;
  const failed = createTokenMetadata({ fetcher: async () => { throw new Error('secret'); } });
  await assert.rejects(failed('ipfs://A'), { message: 'Metadata provider is unavailable.', status: 502 });
});
