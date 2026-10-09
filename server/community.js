export function installCommunity(app, { store, auth, security, address, text, route, fail, moderators = [], catalogue }) {
  const uuid = value => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw fail('Invalid comment ID.');
    return value;
  };
  const writeIdentity = async req => {
    const wallet = await auth(req);
    if (await security.rate('community-rate', wallet, 60000) > 10) throw fail('Too many community changes. Try again in one minute.', 429);
    return wallet;
  };
  app.get('/api/community/profiles/:wallet', route(async (req, res) => res.json(await store.getProfile(address(req.params.wallet)))));
  app.get('/api/community/following', route(async (req, res) => {
    const wallet = await auth(req), offset = Number(req.query.offset || 0), limit = Number(req.query.limit || 50);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('Invalid following page.');
    const rows = await store.following(wallet, { offset, limit: limit + 1 });
    res.json({ follows: rows.slice(0, limit), hasMore: rows.length > limit });
  }));
  app.put('/api/community/following/:wallet', route(async (req, res) => {
    const wallet = await writeIdentity(req), following = address(req.params.wallet);
    if (wallet === following || typeof req.body.follow !== 'boolean') throw fail('Choose a different wallet and a follow setting.');
    await store.follow(wallet, following, req.body.follow);
    res.json({ following, follow: req.body.follow });
  }));
  app.post('/api/community/account/delete', route(async (req, res) => {
    const wallet = await writeIdentity(req);
    if (req.body.confirm !== wallet) throw fail('Confirm your connected wallet address to delete app data.');
    await store.deleteAccount(wallet);
    if (store.kind !== 'postgres') await catalogue.setWatchlist(wallet, []);
    res.json({ deleted: true, retained: ['public blockchain and coin listings', 'published IPFS metadata and artwork', 'moderation reports', 'provider backups until retention expiry'] });
  }));
  app.post('/api/community/profile', route(async (req, res) => {
    const wallet = await writeIdentity(req);
    const name = text(req.body.name, 24);
    const bio = text(req.body.bio || '', 240);
    if (!name) throw fail('Enter a display name.');
    res.json(await store.saveProfile(wallet, { name, bio }));
  }));
  app.get('/api/community/coins/:mint/comments', route(async (req, res) => {
    const offset = Number(req.query.offset || 0), limit = Number(req.query.limit || 50);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('Invalid discussion page.');
    res.json(await store.listPosts(address(req.params.mint), { offset, limit }));
  }));
  const moderator = async req => {
    const wallet = await auth(req);
    if (!moderators.includes(wallet)) throw fail('Moderator access required.', 403);
    return wallet;
  };
  app.get('/api/moderation/reports', route(async (req, res) => {
    await moderator(req);
    res.json(await store.listReports());
  }));
  app.get('/api/moderation/history', route(async (req, res) => {
    await moderator(req);
    const offset = Number(req.query.offset || 0), limit = Number(req.query.limit || 50);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('Invalid moderation history page.');
    const rows = await store.moderationHistory({ offset, limit: limit + 1 });
    res.json({ reports: rows.slice(0, limit), hasMore: rows.length > limit });
  }));
  app.post('/api/moderation/comments/:id', route(async (req, res) => {
    const wallet = await moderator(req);
    if (!['hide', 'dismiss'].includes(req.body.action)) throw fail('Choose hide or dismiss.');
    if (await security.rate('moderation-rate', wallet, 60000) > 30) throw fail('Too many moderation changes.', 429);
    await store.moderatePost(uuid(req.params.id), wallet, req.body.action);
    res.json({ moderated: true });
  }));
  app.post('/api/community/coins/:mint/comments', route(async (req, res) => {
    const wallet = await writeIdentity(req);
    const mint = address(req.params.mint);
    const body = text(req.body.body, 500);
    if (!body) throw fail('Enter a comment.');
    res.status(201).json(await store.addPost(mint, wallet, body));
  }));
  app.delete('/api/community/comments/:id', route(async (req, res) => {
    await store.deletePost(uuid(req.params.id), await writeIdentity(req));
    res.json({ deleted: true });
  }));
  app.post('/api/community/comments/:id/report', route(async (req, res) => {
    const wallet = await writeIdentity(req);
    const reason = text(req.body.reason, 200);
    if (!reason) throw fail('Choose a report reason.');
    await store.reportPost(uuid(req.params.id), wallet, reason);
    res.json({ recorded: true, status: 'pending', moderationService: moderators.length > 0 });
  }));
}
