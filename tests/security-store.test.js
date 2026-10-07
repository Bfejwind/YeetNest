import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppStore } from '../server/app-store.js';
import { createSecurityStore } from '../server/security-store.js';

test('authorization persists, hashes keys, expires and consumes once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yeetnest-security-'));
  let time = 100;
  const store = createAppStore({ directory });
  try {
    const security = createSecurityStore(store, () => time);
    await security.put('session', 'secret-bearer', { wallet: 'wallet', expires: 200 });
    assert.equal(JSON.stringify(await store.get('security-records')).includes('secret-bearer'), false);
    const reopened = createSecurityStore(createAppStore({ directory }), () => time);
    assert.equal((await reopened.get('session', 'secret-bearer')).wallet, 'wallet');
    await security.put('nonce', 'nonce', { expires: 200 });
    const results = await Promise.all(Array.from({ length: 8 }, () => security.take('nonce', 'nonce')));
    assert.equal(results.filter(Boolean).length, 1);
    assert.deepEqual(await Promise.all(Array.from({ length: 4 }, () => security.rate('rate', 'wallet', 50))), [1, 2, 3, 4]);
    time = 201;
    assert.equal(await reopened.get('session', 'secret-bearer'), undefined);
    assert.equal(await security.rate('rate', 'wallet', 50), 1);
    assert.equal(await security.take('session', 'secret-bearer'), undefined);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
