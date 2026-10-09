import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { databaseConfig } from './database-config.js';

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
    following: async (wallet, { offset = 0, limit = 50 } = {}) => (await read()).follows?.filter(row => row.wallet === wallet).sort((a, b) => b.created - a.created || a.following.localeCompare(b.following)).slice(offset, offset + limit) || [],
    follow: (wallet, following, enabled) => mutate(data => {
      data.follows ||= [];
      data.follows = data.follows.filter(row => row.wallet !== wallet || row.following !== following);
      if (enabled) {
        if (data.follows.length >= 20000) throw fail('Pilot follow capacity reached.', 503);
        data.follows.push({ wallet, following, created: Date.now() });
      }
    }),
    deleteAccount: wallet => mutate(data => {
      delete data.profiles[wallet];
      data.follows = (data.follows || []).filter(row => row.wallet !== wallet && row.following !== wallet);
      for (const post of data.posts) if (post.wallet === wallet) { post.deleted = true; post.body = ''; }
    }),
    getProfile: async wallet => (await read()).profiles[wallet] || { wallet, name: authorName(wallet), bio: '' },
    saveProfile: (wallet, profile) => mutate(data => {
      if (!data.profiles[wallet] && Object.keys(data.profiles).length >= 5000) throw fail('Pilot profile capacity reached.', 503);
      return data.profiles[wallet] = { wallet, ...profile, updated: Date.now() };
    }),
    listPosts: async (mint, { offset = 0, limit = 50 } = {}) => {
      const data = await read();
      return data.posts.filter(p => p.mint === mint && !p.deleted).reverse().slice(offset, offset + limit).map(p => ({ ...p, author: data.profiles[p.wallet]?.name || authorName(p.wallet) }));
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
    listReports: async () => {
      const data = await read();
      return data.reports.filter(r => r.status === 'pending').slice(0, 100).map(r => ({ ...r, comment: data.posts.find(p => p.id === r.post) }));
    },
    moderationHistory: async ({ offset = 0, limit = 50 } = {}) => {
      const data = await read();
      return data.reports.filter(r => r.status !== 'pending').sort((a, b) => b.moderated_at - a.moderated_at || a.post.localeCompare(b.post) || a.wallet.localeCompare(b.wallet)).slice(offset, offset + limit).map(r => ({ ...r, comment: data.posts.find(p => p.id === r.post) }));
    },
    moderatePost: (id, moderator, action) => mutate(data => {
      const pending = data.reports.filter(r => r.post === id && r.status === 'pending');
      if (!pending.length) throw fail('Pending report not found.', 404);
      const post = data.posts.find(p => p.id === id);
      if (action === 'hide' && post) post.deleted = true;
      for (const report of pending) Object.assign(report, { status: action === 'hide' ? 'resolved' : 'dismissed', moderated_by: moderator, moderated_at: Date.now() });
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
  const pool = new pg.Pool({ ...databaseConfig(connectionString), max: 10, idleTimeoutMillis: 30000 });
  pool.on('error', () => { console.error('Community database connection error.'); });
  const post = row => ({ ...row, created: Number(row.created), author: row.author || authorName(row.wallet) });
  return {
    kind: 'postgres',
    ready: async () => { await pool.query('SELECT wallet FROM community_profiles LIMIT 0'); await pool.query('SELECT id FROM community_posts LIMIT 0'); await pool.query('SELECT post_id,moderated_at FROM community_reports LIMIT 0'); await pool.query('SELECT wallet FROM community_follows LIMIT 0'); },
    close: () => pool.end(),
    following: async (wallet, { offset = 0, limit = 50 } = {}) => (await pool.query('SELECT wallet,following,created FROM community_follows WHERE wallet=$1 ORDER BY created DESC,following LIMIT $2 OFFSET $3', [wallet, limit, offset])).rows,
    follow: async (wallet, following, enabled) => {
      if (enabled) await pool.query('INSERT INTO community_follows(wallet,following,created) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [wallet, following, Date.now()]);
      else await pool.query('DELETE FROM community_follows WHERE wallet=$1 AND following=$2', [wallet, following]);
    },
    deleteAccount: async wallet => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM community_profiles WHERE wallet=$1', [wallet]);
        await client.query("UPDATE community_posts SET body='',deleted=true WHERE wallet=$1", [wallet]);
        await client.query('DELETE FROM community_follows WHERE wallet=$1 OR following=$1', [wallet]);
        await client.query('DELETE FROM wallet_watchlists WHERE wallet=$1', [wallet]);
        await client.query('DELETE FROM upload_references WHERE wallet=$1', [wallet]);
        await client.query("UPDATE app_records SET value=COALESCE((SELECT jsonb_agg(entry) FROM jsonb_array_elements(value) AS items(entry) WHERE entry->1->>'wallet' IS DISTINCT FROM $1),'[]'::jsonb) WHERE key='upload-references'", [wallet]);
        await client.query("DELETE FROM app_records WHERE key=$1", [`watchlist:${wallet}`]);
        await client.query("DELETE FROM security_records WHERE value->>'wallet'=$1", [wallet]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    getProfile: async wallet => {
      const result = await pool.query('SELECT wallet, name, bio, updated FROM community_profiles WHERE wallet=$1', [wallet]);
      return result.rows[0] ? { ...result.rows[0], updated: Number(result.rows[0].updated) } : { wallet, name: authorName(wallet), bio: '' };
    },
    saveProfile: async (wallet, profile) => {
      const result = await pool.query('INSERT INTO community_profiles(wallet,name,bio,updated) VALUES($1,$2,$3,$4) ON CONFLICT(wallet) DO UPDATE SET name=EXCLUDED.name,bio=EXCLUDED.bio,updated=EXCLUDED.updated RETURNING wallet,name,bio,updated', [wallet, profile.name, profile.bio, Date.now()]);
      return { ...result.rows[0], updated: Number(result.rows[0].updated) };
    },
    listPosts: async (mint, { offset = 0, limit = 50 } = {}) => {
      const result = await pool.query('SELECT p.id,p.mint,p.wallet,p.body,p.created,u.name AS author FROM community_posts p LEFT JOIN community_profiles u ON u.wallet=p.wallet WHERE p.mint=$1 AND NOT p.deleted ORDER BY p.created DESC,p.id DESC LIMIT $2 OFFSET $3', [mint, limit, offset]);
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
    listReports: async () => (await pool.query(`SELECT r.post_id AS post,r.wallet,r.reason,r.created,r.status,
      json_build_object('id',p.id,'mint',p.mint,'wallet',p.wallet,'body',p.body,'deleted',p.deleted) AS comment
      FROM community_reports r JOIN community_posts p ON p.id=r.post_id WHERE r.status='pending' ORDER BY r.created,r.post_id LIMIT 100`)).rows,
    moderationHistory: async ({ offset = 0, limit = 50 } = {}) => (await pool.query(`SELECT r.post_id AS post,r.wallet,r.reason,r.created,r.status,r.moderated_by,r.moderated_at,
      json_build_object('id',p.id,'mint',p.mint,'wallet',p.wallet,'body',p.body,'deleted',p.deleted) AS comment
      FROM community_reports r JOIN community_posts p ON p.id=r.post_id WHERE r.status<>'pending'
      ORDER BY r.moderated_at DESC,r.post_id,r.wallet LIMIT $1 OFFSET $2`, [limit, offset])).rows,
    moderatePost: async (id, moderator, action) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query("UPDATE community_reports SET status=$2,moderated_by=$3,moderated_at=$4 WHERE post_id=$1 AND status='pending' RETURNING post_id", [id, action === 'hide' ? 'resolved' : 'dismissed', moderator, Date.now()]);
        if (!result.rowCount) throw fail('Pending report not found.', 404);
        if (action === 'hide') await client.query('UPDATE community_posts SET deleted=true WHERE id=$1', [id]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    reportPost: async (id, wallet, reason) => {
      const result = await pool.query('INSERT INTO community_reports(post_id,wallet,reason,created) SELECT id,$2,$3,$4 FROM community_posts WHERE id=$1 AND NOT deleted ON CONFLICT(post_id,wallet) DO UPDATE SET reason=community_reports.reason RETURNING post_id', [id, wallet, reason, Date.now()]);
      if (!result.rowCount) throw fail('Comment not found.', 404);
    },
  };
}
