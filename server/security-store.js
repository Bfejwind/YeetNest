import { createHash } from 'node:crypto';
import pg from 'pg';
import { databaseConfig } from './database-config.js';

// app_records mutations use PostgreSQL row locks across server instances.
export function createSecurityStore(store, now = Date.now, databaseUrl) {
  const keyFor = (kind, value) => `${kind}:${createHash('sha256').update(String(value)).digest('hex')}`;
  if (databaseUrl) {
    const pool = new pg.Pool({ ...databaseConfig(databaseUrl), max: 5, idleTimeoutMillis: 30000 });
    pool.on('error', () => console.error('Authorization database connection error.'));
    return {
      ready: () => pool.query('SELECT key FROM security_records LIMIT 0'),
      close: () => pool.end(),
      put: async (kind, key, value) => {
        await pool.query('INSERT INTO security_records(key,value,expires) VALUES($1,$2::jsonb,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,expires=EXCLUDED.expires', [keyFor(kind, key), JSON.stringify(value), value.expires]);
      },
      get: async (kind, key) => (await pool.query('SELECT value FROM security_records WHERE key=$1 AND expires>$2', [keyFor(kind, key), now()])).rows[0]?.value,
      take: async (kind, key) => {
        const record = (await pool.query('DELETE FROM security_records WHERE key=$1 RETURNING value,expires', [keyFor(kind, key)])).rows[0];
        return record && Number(record.expires) > now() ? record.value : undefined;
      },
      rate: async (kind, key, duration) => {
        const time = now();
        const result = await pool.query(`INSERT INTO security_records(key,value,expires) VALUES($1,'{"count":1}'::jsonb,$2)
          ON CONFLICT(key) DO UPDATE SET value=jsonb_build_object('count',CASE WHEN security_records.expires<=$3 THEN 1 ELSE (security_records.value->>'count')::int+1 END),
          expires=CASE WHEN security_records.expires<=$3 THEN EXCLUDED.expires ELSE security_records.expires END RETURNING value`, [keyFor(kind, key), time + duration, time]);
        return result.rows[0].value.count;
      },
      prune: () => pool.query('DELETE FROM security_records WHERE expires<=$1', [now()]),
    };
  }
  const change = fn => store.mutate('security-records', records => {
    const time = now();
    for (let i = records.length - 1; i >= 0; i--) if (records[i].expires <= time) records.splice(i, 1);
    return fn(records, time);
  });
  return {
    ready: async () => {},
    close: async () => {},
    prune: () => change(() => {}),
    put: (kind, key, value) => change(records => {
      const id = keyFor(kind, key);
      const index = records.findIndex(record => record.id === id);
      if (index >= 0) records.splice(index, 1);
      if (records.length >= 20000) throw Object.assign(new Error('Authorization service is busy.'), { status: 503 });
      records.push({ ...value, id });
    }),
    get: async (kind, key) => (await store.get('security-records')).find(record => record.id === keyFor(kind, key) && record.expires > now()),
    take: (kind, key) => change(records => {
      const index = records.findIndex(record => record.id === keyFor(kind, key));
      return index < 0 ? undefined : records.splice(index, 1)[0];
    }),
    rate: (kind, key, duration) => change((records, time) => {
      const id = keyFor(kind, key);
      let record = records.find(record => record.id === id);
      if (!record) {
        if (records.length >= 20000) throw Object.assign(new Error('Authorization service is busy.'), { status: 503 });
        record = { id, count: 0, expires: time + duration };
        records.push(record);
      }
      return ++record.count;
    }),
  };
}
