import test from 'node:test';
import assert from 'node:assert/strict';
import { walletBrowseLink } from '../src/wallet-links.js';
import { databaseConfig } from '../server/database-config.js';

test('Render external databases require verified TLS without changing explicit provider settings', () => {
  assert.deepEqual(databaseConfig('postgresql://user:password@db.oregon-postgres.render.com/app').ssl, { rejectUnauthorized: true });
  assert.equal(databaseConfig('postgresql://user:password@dpg-internal/app').ssl, undefined);
  assert.equal(databaseConfig('postgresql://user:password@db.render.com/app?sslmode=verify-full').ssl, undefined);
});

test('phone wallet links use official origins and omit sensitive URL parameters', () => {
  for (const name of ['Phantom', 'Solflare']) {
    const link = new URL(walletBrowseLink(name, 'https://yeetnest.example/coins?token=secret#private'));
    assert.equal(link.hostname, name === 'Phantom' ? 'phantom.com' : 'solflare.com');
    assert.equal(decodeURIComponent(link.pathname.slice('/ul/v1/browse/'.length)), 'https://yeetnest.example/coins');
    assert.equal(link.searchParams.get('ref'), 'https://yeetnest.example');
    assert.ok(!link.href.includes('secret'));
    assert.ok(!link.href.includes('private'));
  }
  assert.throws(() => walletBrowseLink('Other', 'https://yeetnest.example'));
  assert.throws(() => walletBrowseLink('Phantom', 'http://localhost:5174'));
  assert.throws(() => walletBrowseLink('Phantom', 'https://user:password@yeetnest.example'));
});
