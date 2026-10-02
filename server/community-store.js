import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const fail = (message, status) => Object.assign(new Error(message), { status });
const authorName = wallet => `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;

export function createCommunityStore({ databaseUrl, directory }) {
  if (databaseUrl) return postgresStore(databaseUrl);
  const file = resolve(directory, 'community.json');
  let writing = Promise.resolve();
  async function read() {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch(error) { if (error.code === 'ENOENT') return { profiles: {}, posts: [], reports: [] }; throw error; }
  }
  function mutate(fn) {
    const task = writing.then(async () => {
      const data = await read();
      const result = await fn(data);
      await mkdir(directory, { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(data));
      await rename(`${file}.tmp`, file);
      return result;
    });
    writing = task.catch(() => {});
    return task;
  }
  return {
    kind: 'single-process-json',
    ready: async () => { await read(); },
    close: async () => { await writing; },
    getProfile: async wallet => (await read()).profiles[wallet] || { wallet, name: authorName(wallet), bio: '' },
    saveProfile: (wallet, profile) => mutate(data => {
      if (!data.profiles[wallet] && Object.keys(data.profiles).length >= 5000) throw fail('Pilot profile capacity reached.', 503);
      return data.profiles[wallet] = { wallet, ...profile, updated: Date.now() };
    }),
    listPosts: async mint => {
      const data = await read();
      return data.posts.filter(p => p.mint === mint && !p.deleted).slice(-50).reverse().map(p => ({ ...p, author: data.profiles[p.wallet]?.name || authorName(p.wallet) }));
    },
    addPost: (mint, wallet, body) => mutate(data => {
      if (data.posts.length >= 10000) throw fail('Pilot discussion capacity reached.', 503);
      const post = { id: randomUUID(), mint, wallet, body, created: Date.now(), deleted: false };
      data.posts.push(post);
      return { ...post, author: data.profiles[wallet]?.name || authorName(wallet) };
    }),
    deletePost: (id, wallet) => mutate(data => {
      const post = data.posts.find(p => p.id === id && p.wallet === wallet && !p.deleted);
      if (!post) throw fail('Comment not found or not owned by this wallet.', 404);
      post.deleted = true;
      post.body = '';
    }),
    reportPost: (id, wallet, reason) => mutate(data => {
      if (!data.posts.some(p => p.id === id && !p.deleted)) throw fail('Comment not found.', 404);
      if (data.reports.some(r => r.post === id && r.wallet === wallet)) return;
      if (data.reports.length >= 10000) throw fail('Pilot report capacity reached.', 503);
      data.reports.push({ post: id, wallet, reason, created: Date.now(), status: 'pending' });
    }),
  };
}

function postgresStore(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  pool.on('error', () => { console.error('Community database connection error.'); });
  const post = row => ({ ...row, created: Number(row.created), author: row.author || authorName(row.wallet) });
  return {
    kind: 'postgres',
    ready: async () => { await pool.query('SELECT wallet FROM community_profiles LIMIT 0'); await pool.query('SELECT id FROM community_posts LIMIT 0'); await pool.query('SELECT post_id FROM community_reports LIMIT 0'); },
    close: () => pool.end(),
    getProfile: async wallet => {
      const result = await pool.query('SELECT wallet, name, bio, updated FROM community_profiles WHERE wallet=$1', [wallet]);
      return result.rows[0] ? { ...result.rows[0], updated: Number(result.rows[0].updated) } : { wallet, name: authorName(wallet), bio: '' };
    },
    saveProfile: async (wallet, profile) => {
      const result = await pool.query('INSERT INTO community_profiles(wallet,name,bio,updated) VALUES($1,$2,$3,$4) ON CONFLICT(wallet) DO UPDATE SET name=EXCLUDED.name,bio=EXCLUDED.bio,updated=EXCLUDED.updated RETURNING wallet,name,bio,updated', [wallet, profile.name, profile.bio, Date.now()]);
      return { ...result.rows[0], updated: Number(result.rows[0].updated) };
    },
    listPosts: async mint => {
      const result = await pool.query('SELECT p.id,p.mint,p.wallet,p.body,p.created,u.name AS author FROM community_posts p LEFT JOIN community_profiles u ON u.wallet=p.wallet WHERE p.mint=$1 AND NOT p.deleted ORDER BY p.created DESC,p.id DESC LIMIT 50', [mint]);
      return result.rows.map(post);
    },
    addPost: async (mint, wallet, body) => {
      const result = await pool.query('INSERT INTO community_posts(id,mint,wallet,body,created) VALUES($1,$2,$3,$4,$5) RETURNING id,mint,wallet,body,created', [randomUUID(), mint, wallet, body, Date.now()]);
      const profile = await pool.query('SELECT name FROM community_profiles WHERE wallet=$1', [wallet]);
      return post({ ...result.rows[0], author: profile.rows[0]?.name });
    },
    deletePost: async (id, wallet) => {
      const result = await pool.query('UPDATE community_posts SET deleted=true,body=\'\' WHERE id=$1 AND wallet=$2 AND NOT deleted RETURNING id', [id, wallet]);
      if (!result.rowCount) throw fail('Comment not found or not owned by this wallet.', 404);
    },
    reportPost: async (id, wallet, reason) => {
      const result = await pool.query('INSERT INTO community_reports(post_id,wallet,reason,created) SELECT id,$2,$3,$4 FROM community_posts WHERE id=$1 AND NOT deleted ON CONFLICT(post_id,wallet) DO UPDATE SET reason=community_reports.reason RETURNING post_id', [id, wallet, reason, Date.now()]);
      if (!result.rowCount) throw fail('Comment not found.', 404);
    },
  };
}
