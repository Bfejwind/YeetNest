import pg from 'pg';
import { databaseConfig } from './database-config.js';

export function createChainIndexStore(databaseUrl) {
  if (!databaseUrl) return null;
  const pool = new pg.Pool({ ...databaseConfig(databaseUrl), max: 4, idleTimeoutMillis: 30000 });
  pool.on('error', () => console.error('Chain index database connection error.'));
  return {
    ready: async () => { await pool.query('SELECT pool,protocol,progress FROM indexed_launches LIMIT 0'); await pool.query('SELECT signature FROM indexed_trades LIMIT 0'); await pool.query('SELECT id FROM market_events LIMIT 0'); },
    close: () => pool.end(),
    latestEvent: async () => Number((await pool.query('SELECT COALESCE(max(id),0) AS id FROM market_events')).rows[0].id),
    eventsAfter: async id => (await pool.query('SELECT id,mint FROM market_events WHERE id>$1 ORDER BY id LIMIT 100', [id])).rows,
    pruneEvents: () => pool.query('DELETE FROM market_events WHERE id IN (SELECT id FROM market_events WHERE created<$1 ORDER BY created LIMIT 1000)', [Date.now() - 7 * 86400000]),
    saveLaunch: async launch => {
      await pool.query(`WITH event_lock AS MATERIALIZED (SELECT pg_advisory_xact_lock(741923)), changed AS (INSERT INTO indexed_launches(pool,mint,creator,config,platform,name,ticker,uri,decimals,status,raised,target,supply,created,updated,slot,protocol,progress)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT(pool) DO UPDATE SET
        status=CASE WHEN EXCLUDED.slot>=indexed_launches.slot THEN EXCLUDED.status ELSE indexed_launches.status END,
        raised=CASE WHEN EXCLUDED.slot>=indexed_launches.slot THEN EXCLUDED.raised ELSE indexed_launches.raised END,
        target=CASE WHEN EXCLUDED.slot>=indexed_launches.slot THEN EXCLUDED.target ELSE indexed_launches.target END,
        supply=CASE WHEN EXCLUDED.slot>=indexed_launches.slot THEN EXCLUDED.supply ELSE indexed_launches.supply END,
        progress=CASE WHEN EXCLUDED.slot>=indexed_launches.slot THEN EXCLUDED.progress ELSE indexed_launches.progress END,
        name=CASE WHEN EXCLUDED.name='' THEN indexed_launches.name ELSE EXCLUDED.name END,
        ticker=CASE WHEN EXCLUDED.ticker='' THEN indexed_launches.ticker ELSE EXCLUDED.ticker END,
        uri=CASE WHEN EXCLUDED.uri='' THEN indexed_launches.uri ELSE EXCLUDED.uri END,
        created=COALESCE(indexed_launches.created,EXCLUDED.created),updated=GREATEST(indexed_launches.updated,EXCLUDED.updated),slot=GREATEST(indexed_launches.slot,EXCLUDED.slot)
        RETURNING mint) INSERT INTO market_events(mint,created) SELECT mint,$15 FROM event_lock CROSS JOIN changed`, [launch.pool, launch.mint, launch.creator, launch.config, launch.platform, launch.name, launch.ticker, launch.uri, launch.decimals, launch.status, launch.raised, launch.target, launch.supply, launch.created, Date.now(), launch.slot, launch.protocol || 'raydium', launch.progress ?? null]);
    },
    getLaunch: async mint => (await pool.query('SELECT * FROM indexed_launches WHERE mint=$1', [mint])).rows[0],
    list: async ({ query = '', status, offset = 0, limit = 24, after } = {}) => {
      const result = await pool.query(`SELECT * FROM indexed_launches WHERE ($1='' OR strpos(lower(name),lower($1))>0 OR strpos(lower(ticker),lower($1))>0 OR mint=$1)
        AND ($2::smallint IS NULL OR status=$2)
        AND ($5::bigint IS NULL OR COALESCE(created,0)<$5 OR (COALESCE(created,0)=$5 AND pool>$6))
        ORDER BY COALESCE(created,0) DESC,pool LIMIT $3 OFFSET $4`, [query, status ?? null, limit, after ? 0 : offset, after?.created ?? null, after?.pool ?? null]);
      return result.rows;
    },
    saveTrade: async trade => {
      await pool.query(`INSERT INTO indexed_trades(signature,event_index,pool,slot,block_time,side,base_amount,quote_amount,fee_amount)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(signature,event_index) DO NOTHING`, [trade.signature, trade.index, trade.pool, trade.slot, trade.blockTime, trade.side, trade.base, trade.quote, trade.fees]);
    },
    trades: async (mint, limit = 100) => (await pool.query(`SELECT t.*,l.decimals FROM indexed_trades t JOIN indexed_launches l ON l.pool=t.pool
      WHERE l.mint=$1 ORDER BY t.slot DESC,t.event_index DESC LIMIT $2`, [mint, limit])).rows,
    candles: async (mint, { since = Math.floor(Date.now() / 1000) - 86400 } = {}) => (await pool.query(`WITH priced AS (
      SELECT floor(t.block_time/300)*300 AS time,t.slot,t.signature,t.event_index,
      t.quote_amount/power(10::numeric,9)/(t.base_amount/power(10::numeric,l.decimals)) AS price,t.quote_amount/power(10::numeric,9) AS volume
      FROM indexed_trades t JOIN indexed_launches l ON l.pool=t.pool WHERE l.mint=$1 AND t.block_time >= $2
    ) SELECT time,(array_agg(price ORDER BY slot,signature,event_index))[1] AS open,max(price) AS high,min(price) AS low,
      (array_agg(price ORDER BY slot DESC,signature DESC,event_index DESC))[1] AS close,sum(volume) AS volume,count(*) AS trades
      FROM priced GROUP BY time ORDER BY time DESC LIMIT 288`, [mint, since])).rows.reverse(),
  };
}
