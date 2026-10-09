export function createMarketFeed(store, { interval = 2000, maxClients = 100 } = {}) {
  const clients = new Set();
  let cursor = null, polling = false, closed = false;
  const send = (client, event, id, payload) => {
    if (client.res.destroyed || client.res.writableLength > 65536) { client.res.end(); clients.delete(client); return; }
    client.res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const poll = async () => {
    if (closed || polling || !clients.size) return;
    polling = true;
    try {
      if (cursor === null) cursor = await store.latestEvent();
      const events = await store.eventsAfter(cursor);
      if ([...clients].some(client => !client.ready)) return;
      for (const row of events) {
        cursor = Number(row.id);
        for (const client of clients) if (client.ready && cursor > client.last) { send(client, 'market', cursor, { mint: row.mint }); client.last = cursor; }
      }
      for (const client of clients) if (client.ready) {
        if (client.res.writableLength > 65536) { client.res.end(); clients.delete(client); }
        else client.res.write(': heartbeat\n\n');
      }
    } catch {
      for (const client of clients) { client.res.end(); clients.delete(client); }
    } finally { polling = false; }
  };
  const timer = setInterval(poll, interval); timer.unref();
  return {
    poll,
    attach: async (req, res) => {
      if (closed || clients.size >= maxClients || [...clients].filter(client => client.ip === req.ip).length >= 5) return res.status(503).json({ error: 'Market stream connection limit reached.' });
      const value = req.headers['last-event-id'];
      if (value !== undefined && (!/^\d{1,15}$/.test(value) || !Number.isSafeInteger(Number(value)))) return res.status(400).json({ error: 'Invalid market event cursor.' });
      const client = { res, ip: req.ip, ready: false, last: 0 };
      clients.add(client);
      res.on('close', () => clients.delete(client));
      try {
        const head = await store.latestEvent();
        if (closed || res.destroyed) { clients.delete(client); return; }
        res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        res.write('retry: 5000\n\n');
        const last = value === undefined ? head : Number(value);
        const replay = last < head ? await store.eventsAfter(last) : [];
        if (replay.length && replay.length < 100 && Number(replay[0].id) === last + 1) {
          for (const row of replay) send(client, 'market', row.id, { mint: row.mint });
          client.last = Number(replay.at(-1).id);
        } else { send(client, 'reset', head, { refresh: true }); client.last = head; }
        if (cursor === null) cursor = client.last;
        client.ready = true;
        await poll();
      } catch { clients.delete(client); res.end(); }
    },
    close: () => { closed = true; clearInterval(timer); for (const client of clients) client.res.end(); clients.clear(); },
  };
}
