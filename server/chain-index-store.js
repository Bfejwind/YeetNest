import pg from 'pg';
import { databaseConfig } from './database-config.js';

export function createChainIndexStore(databaseUrl) {
  if (!databaseUrl) return null;
  const pool = new pg.Pool({ ...databaseConfig(databaseUrl), max: 4, idleTimeoutMillis: 30000 });
  pool.on('error', () => console.error('Chain index database connection error.'));
  return {
    ready: async () => { await pool.query('SELECT pool,protocol,progress FROM indexed_launches LIMIT 0'); await pool.query('SELECT signature,venue FROM indexed_trades LIMIT 0'); await pool.query('SELECT mint FROM chart_candles LIMIT 0'); await pool.query('SELECT id FROM market_events LIMIT 0'); },
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
      await pool.query(`WITH event_lock AS MATERIALIZED (SELECT pg_advisory_xact_lock(741923)), changed AS (
        INSERT INTO indexed_trades(signature,event_index,pool,slot,block_time,side,base_amount,quote_amount,fee_amount,venue)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 FROM event_lock ON CONFLICT(signature,event_index) DO NOTHING RETURNING pool)
        INSERT INTO market_events(mint,created) SELECT l.mint,$11 FROM changed JOIN indexed_launches l ON l.pool=changed.pool`, [trade.signature, trade.index, trade.pool, trade.slot, trade.blockTime, trade.side, trade.base, trade.quote, trade.fees, trade.venue || 'curve', Date.now()]);
    },
    saveExchangeRate: async ({ time, usd, source }) => pool.query('INSERT INTO chart_exchange_rates(time,usd,source,observed) VALUES($1,$2,$3,$4) ON CONFLICT(time) DO NOTHING', [time, usd, source, Date.now()]),
    chart: async (mint, { interval = 60, since = Math.floor(Date.now() / 1000) - 86400, before = Math.floor(Date.now() / 1000) + 60, currency = 'SOL', metric = 'price' } = {}) => {
      const launch = (await pool.query('SELECT supply,decimals,protocol FROM indexed_launches WHERE mint=$1', [mint])).rows[0];
      if (!launch) return { candles: [], available: false };
      const multiplier = metric === 'fdv' && launch.protocol === 'pump' ? Number(launch.supply) / 10 ** launch.decimals : 1;
      if (metric === 'fdv' && launch.protocol !== 'pump') throw new Error('FDV requires an indexed Pump supply.');
      const rows = (await pool.query(`WITH priced AS (
        SELECT c.*,floor(c.time/$2)*$2 AS bucket,CASE WHEN $5='USD' THEN r.usd ELSE 1 END AS fx
        FROM chart_candles c LEFT JOIN chart_exchange_rates r ON r.time=c.time
        WHERE c.mint=$1 AND c.time>=$3 AND c.time<$4
      ) SELECT bucket AS time,(array_agg(open*fx ORDER BY time))[1] AS open,max(high*fx) AS high,min(low*fx) AS low,
        (array_agg(close*fx ORDER BY time DESC))[1] AS close,sum(volume*fx) AS volume,sum(trades) AS trades
        FROM priced WHERE fx IS NOT NULL GROUP BY bucket ORDER BY bucket DESC LIMIT 1500`, [mint, interval, since, before, currency])).rows.reverse();
      return { available: true, candles: rows.map(row => [Number(row.time), Number(row.open) * multiplier, Number(row.high) * multiplier, Number(row.low) * multiplier, Number(row.close) * multiplier, Number(row.volume)]), currency, metric, interval, source: 'Finalized Pump/PumpSwap indexed execution prices', scope: 'Indexed trades only; no gap filling. Same-slot ordering is deterministic, not block transaction order.', conversion: currency === 'USD' ? 'Observed Coinbase SOL/USD minute snapshots; minutes without rates are excluded. Not tick-exact historical FX.' : null, updatedAt: Date.now() };
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
