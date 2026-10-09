import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMarketFeed } from '../server/market-feed.js';

class Response extends EventEmitter {
  output = '';
  writableLength = 0;
  destroyed = false;
  status(value) { this.code = value; return this; }
  set() { return this; }
  flushHeaders() {}
  write(value) { this.output += value; }
  json(value) { this.body = value; return this; }
  end() { this.destroyed = true; this.emit('close'); }
}

test('market stream replays cursors and new clients cannot skip updates for existing clients', async () => {
  const rows = [{ id: 1, mint: 'first' }];
  const store = { latestEvent: async () => rows.at(-1)?.id || 0, eventsAfter: async id => rows.filter(row => row.id > id).slice(0, 100) };
  const feed = createMarketFeed(store, { interval: 60000 });
  const first = new Response(), second = new Response();
  try {
    await feed.attach({ ip: 'first', headers: {} }, first);
    assert.match(first.output, /event: reset/);
    rows.push({ id: 2, mint: 'second' });
    await feed.attach({ ip: 'second', headers: {} }, second);
    assert.match(first.output, /"mint":"second"/);
    const reconnect = new Response();
    await feed.attach({ ip: 'third', headers: { 'last-event-id': '1' } }, reconnect);
    assert.match(reconnect.output, /id: 2\nevent: market/);
    reconnect.end();
    first.writableLength = 65537;
    rows.push({ id: 3, mint: 'third' });
    await feed.poll();
    assert.equal(first.destroyed, true);
    assert.match(second.output, /"mint":"third"/);
  } finally { feed.close(); }
  assert.equal(second.destroyed, true);
});

test('market stream bounds clients, validates cursors and resets when retained history has a gap', async () => {
  const store = { latestEvent: async () => 100, eventsAfter: async () => [{ id: 100, mint: 'retained' }] };
  const feed = createMarketFeed(store, { maxClients: 1, interval: 60000 });
  try {
    const invalid = new Response();
    await feed.attach({ ip: 'one', headers: { 'last-event-id': 'not-a-number' } }, invalid);
    assert.equal(invalid.code, 400);
    const first = new Response();
    await feed.attach({ ip: 'one', headers: { 'last-event-id': '1' } }, first);
    assert.match(first.output, /id: 100\nevent: reset/);
    const excess = new Response();
    await feed.attach({ ip: 'two', headers: {} }, excess);
    assert.equal(excess.code, 503);
  } finally { feed.close(); }
});
