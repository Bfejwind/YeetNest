import pg from 'pg';
import { databaseConfig } from './database-config.js';

const denied = () => Object.assign(new Error('Only the launch creator can change this image.'), { status: 403 });

export function createCatalogueStore({ databaseUrl, fallback }) {
  if (!databaseUrl) return {
    ready: async () => {}, close: async () => {},
    list: async ({ offset = 0, limit = 100 } = {}) => (await fallback.get('coins')).slice(offset, offset + limit),
    find: async mints => (await fallback.get('coins')).filter(coin => mints.includes(coin.mint)),
    insert: coin => fallback.mutate('coins', coins => { if (!coins.some(row => row.mint === coin.mint)) coins.unshift(coin); }),
    image: (mint, creator, image) => fallback.mutate('coins', coins => {
      const coin = coins.find(row => row.mint === mint && row.creator === creator);
      if (!coin) throw denied(); coin.image = image; return coin;
    }),
    stream: (mint, creator, streamUrl) => fallback.mutate('coins', coins => {
      const coin = coins.find(row => row.mint === mint && row.creator === creator);
      if (!coin) throw denied(); coin.streamUrl = streamUrl; return coin;
    }),
    upload: (value, { overwrite = true } = {}) => fallback.mutate('upload-references', rows => {
      const key = `${value.wallet}:${value.uri}`, prior = rows.findIndex(row => row[0] === key);
      if (prior < 0) rows.push([key, value]); else if (overwrite) rows[prior] = [key, value];
    }),
    getUpload: async (wallet, uri) => (await fallback.get('upload-references')).find(([id, value]) => id === `${wallet}:${uri}` && value.expires > Date.now())?.[1],
    watchlist: wallet => fallback.get(`watchlist:${wallet}`),
    setWatchlist: (wallet, mints) => fallback.mutate(`watchlist:${wallet}`, rows => { rows.splice(0, rows.length, ...mints); }),
  };
  const pool = new pg.Pool({ ...databaseConfig(databaseUrl), max: 5, idleTimeoutMillis: 30000 });
  pool.on('error', () => console.error('Catalogue database connection error.'));
  return {
    ready: async () => { await pool.query('SELECT mint FROM catalogue_coins LIMIT 0'); await pool.query('SELECT uri FROM upload_references LIMIT 0'); await pool.query('SELECT mint FROM watchlist_items LIMIT 0'); },
    close: () => pool.end(),
    list: async ({ offset = 0, limit = 100 } = {}) => (await pool.query('SELECT data FROM catalogue_coins ORDER BY created DESC,mint LIMIT $1 OFFSET $2', [limit, offset])).rows.map(row => row.data),
    find: async mints => (await pool.query('SELECT data FROM catalogue_coins WHERE mint=ANY($1::text[])', [mints])).rows.map(row => row.data),
    insert: async coin => { await pool.query('INSERT INTO catalogue_coins(mint,creator,created,updated,data) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(mint) DO NOTHING', [coin.mint, coin.creator, coin.created, Date.now(), JSON.stringify(coin)]); },
    image: async (mint, creator, image) => {
      const result = await pool.query("UPDATE catalogue_coins SET data=jsonb_set(data,'{image}',to_jsonb($3::text)),updated=$4 WHERE mint=$1 AND creator=$2 RETURNING data", [mint, creator, image, Date.now()]);
      if (!result.rowCount) throw denied(); return result.rows[0].data;
    },
    stream: async (mint, creator, streamUrl) => {
      const result = await pool.query("UPDATE catalogue_coins SET data=jsonb_set(data,'{streamUrl}',to_jsonb($3::text)),updated=$4 WHERE mint=$1 AND creator=$2 RETURNING data", [mint, creator, streamUrl, Date.now()]);
      if (!result.rowCount) throw denied(); return result.rows[0].data;
    },
    upload: async (value, { overwrite = true } = {}) => { await pool.query(`INSERT INTO upload_references(wallet,uri,expires,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(wallet,uri) ${overwrite ? 'DO UPDATE SET data=EXCLUDED.data,expires=EXCLUDED.expires' : 'DO NOTHING'}`, [value.wallet, value.uri, value.expires, JSON.stringify(value)]); },
    getUpload: async (wallet, uri) => (await pool.query('SELECT data FROM upload_references WHERE wallet=$1 AND uri=$2 AND expires>$3', [wallet, uri, Date.now()])).rows[0]?.data,
    watchlist: async wallet => (await pool.query('SELECT mint FROM watchlist_items WHERE wallet=$1 ORDER BY position,mint', [wallet])).rows.map(row => row.mint),
    setWatchlist: async (wallet, mints) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO wallet_watchlists(wallet) VALUES($1) ON CONFLICT DO NOTHING', [wallet]);
        await client.query('SELECT wallet FROM wallet_watchlists WHERE wallet=$1 FOR UPDATE', [wallet]);
        await client.query('DELETE FROM watchlist_items WHERE wallet=$1', [wallet]);
        await client.query('INSERT INTO watchlist_items(wallet,mint,position) SELECT $1,mint,position::integer FROM unnest($2::text[]) WITH ORDINALITY AS items(mint,position)', [wallet, mints]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}
