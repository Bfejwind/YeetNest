import pg from 'pg';
import { databaseConfig } from './database-config.js';

export function createChainIndexStore(databaseUrl) {
  if (!databaseUrl) return null;
  const pool = new pg.Pool({ ...databaseConfig(databaseUrl), max: 4, idleTimeoutMillis: 30000 });
  pool.on('error', () => console.error('Chain index database connection error.'));
  return {
    ready: async () => { await pool.query('SELECT pool FROM indexed_launches LIMIT 0'); await pool.query('SELECT signature FROM indexed_trades LIMIT 0'); },
    close: () => pool.end(),
    saveLaunch: async launch => {
      await pool.query(`INSERT INTO indexed_launches(pool,mint,creator,config,platform,name,ticker,uri,decimals,status,raised,target,supply,created,updated,slot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT(pool) DO UPDATE SET status=EXCLUDED.status,raised=EXCLUDED.raised,target=EXCLUDED.target,supply=EXCLUDED.supply,
        name=CASE WHEN EXCLUDED.name='' THEN indexed_launches.name ELSE EXCLUDED.name END,
        ticker=CASE WHEN EXCLUDED.ticker='' THEN indexed_launches.ticker ELSE EXCLUDED.ticker END,
        uri=CASE WHEN EXCLUDED.uri='' THEN indexed_launches.uri ELSE EXCLUDED.uri END,
        created=COALESCE(indexed_launches.created,EXCLUDED.created),updated=EXCLUDED.updated,slot=EXCLUDED.slot
        WHERE EXCLUDED.slot>=indexed_launches.slot`, [launch.pool, launch.mint, launch.creator, launch.config, launch.platform, launch.name, launch.ticker, launch.uri, launch.decimals, launch.status, launch.raised, launch.target, launch.supply, launch.created, Date.now(), launch.slot]);
    },
    getLaunch: async mint => (await pool.query('SELECT * FROM indexed_launches WHERE mint=$1', [mint])).rows[0],
    list: async ({ query = '', status, offset = 0, limit = 24 } = {}) => {
      const result = await pool.query(`SELECT * FROM indexed_launches WHERE ($1='' OR strpos(lower(name),lower($1))>0 OR strpos(lower(ticker),lower($1))>0 OR mint=$1)
        AND ($2::smallint IS NULL OR status=$2) ORDER BY created DESC NULLS LAST,pool LIMIT $3 OFFSET $4`, [query, status ?? null, limit, offset]);
      return result.rows;
    },
    saveTrade: async trade => {
      await pool.query(`INSERT INTO indexed_trades(signature,event_index,pool,slot,block_time,side,base_amount,quote_amount,fee_amount)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(signature,event_index) DO NOTHING`, [trade.signature, trade.index, trade.pool, trade.slot, trade.blockTime, trade.side, trade.base, trade.quote, trade.fees]);
    },
    trades: async (mint, limit = 100) => (await pool.query(`SELECT t.*,l.decimals FROM indexed_trades t JOIN indexed_launches l ON l.pool=t.pool
      WHERE l.mint=$1 ORDER BY t.slot DESC,t.event_index DESC LIMIT $2`, [mint, limit])).rows,
    candles: async mint => (await pool.query(`WITH priced AS (
      SELECT floor(t.block_time/300)*300 AS time,t.slot,t.signature,t.event_index,
      t.quote_amount/power(10::numeric,9)/(t.base_amount/power(10::numeric,l.decimals)) AS price,t.quote_amount/power(10::numeric,9) AS volume
      FROM indexed_trades t JOIN indexed_launches l ON l.pool=t.pool WHERE l.mint=$1 AND t.block_time IS NOT NULL
    ) SELECT time,(array_agg(price ORDER BY slot,signature,event_index))[1] AS open,max(price) AS high,min(price) AS low,
      (array_agg(price ORDER BY slot DESC,signature DESC,event_index DESC))[1] AS close,sum(volume) AS volume,count(*) AS trades
      FROM priced GROUP BY time ORDER BY time DESC LIMIT 288`, [mint])).rows.reverse(),
  };
}
