export function installCommunity(app, { store, auth, address, text, route, fail }) {
  const rates = new Map();
  const uuid = value => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw fail('Invalid comment ID.');
    return value;
  };
  const writeIdentity = req => {
    const wallet = auth(req);
    const now = Date.now();
    for (const [key, value] of rates) if (value.expires < now) rates.delete(key);
    const rate = rates.get(wallet) || { count: 0, expires: now + 60000 };
    if (rates.size >= 5000 && !rates.has(wallet)) throw fail('Community service is busy.', 503);
    if (++rate.count > 10) throw fail('Too many community changes. Try again in one minute.', 429);
    rates.set(wallet, rate);
    return wallet;
  };
  app.get('/api/community/profiles/:wallet', route(async (req, res) => res.json(await store.getProfile(address(req.params.wallet)))));
  app.post('/api/community/profile', route(async (req, res) => {
    const wallet = writeIdentity(req);
    const name = text(req.body.name, 24);
    const bio = text(req.body.bio || '', 240);
    if (!name) throw fail('Enter a display name.');
    res.json(await store.saveProfile(wallet, { name, bio }));
  }));
  app.get('/api/community/coins/:mint/comments', route(async (req, res) => res.json(await store.listPosts(address(req.params.mint)))));
  app.post('/api/community/coins/:mint/comments', route(async (req, res) => {
    const wallet = writeIdentity(req);
    const mint = address(req.params.mint);
    const body = text(req.body.body, 500);
    if (!body) throw fail('Enter a comment.');
    res.status(201).json(await store.addPost(mint, wallet, body));
  }));
  app.delete('/api/community/comments/:id', route(async (req, res) => {
    await store.deletePost(uuid(req.params.id), writeIdentity(req));
    res.json({ deleted: true });
  }));
  app.post('/api/community/comments/:id/report', route(async (req, res) => {
    const wallet = writeIdentity(req);
    const reason = text(req.body.reason, 200);
    if (!reason) throw fail('Choose a report reason.');
    await store.reportPost(uuid(req.params.id), wallet, reason);
    res.json({ recorded: true, status: 'pending', moderationService: false });
  }));
}
