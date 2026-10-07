import pg from 'pg';
import { databaseConfig } from './database-config.js';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export function createAppStore({ databaseUrl, directory }) {
  if (databaseUrl) {
    const pool = new pg.Pool({ ...databaseConfig(databaseUrl), max: 5, idleTimeoutMillis: 30000 });
    pool.on('error', () => console.error('Application database connection error.'));
    return {
      kind: 'postgres',
      ready: () => pool.query('SELECT key FROM app_records LIMIT 0'),
      close: () => pool.end(),
      get: async key => (await pool.query('SELECT value FROM app_records WHERE key=$1', [key])).rows[0]?.value || [],
      mutate: async (key, fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('INSERT INTO app_records(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING', [key, '[]']);
          const { rows } = await client.query('SELECT value FROM app_records WHERE key=$1 FOR UPDATE', [key]);
          const value = rows[0].value;
          const result = await fn(value);
          await client.query('UPDATE app_records SET value=$2::jsonb WHERE key=$1', [key, JSON.stringify(value)]);
          await client.query('COMMIT');
          return result;
        } catch(error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
        finally { client.release(); }
      },
    };
  }
  const writes = new Map();
  const file = key => resolve(directory, key === 'coins' ? 'coins.json' : key === 'upload-references' ? 'upload-references.json' : `${createHash('sha256').update(key).digest('hex')}.json`);
  const get = async key => {
    try { return JSON.parse(await readFile(file(key), 'utf8')); }
    catch(error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  return {
    kind: 'single-process-json',
    ready: async () => { await get('coins'); await get('upload-references'); },
    close: async () => { await Promise.all(writes.values()); },
    get,
    mutate: (key, fn) => {
      const task = (writes.get(key) || Promise.resolve()).then(async () => {
        const value = await get(key);
        const result = await fn(value);
        await mkdir(directory, { recursive: true });
        await writeFile(`${file(key)}.tmp`, JSON.stringify(value));
        await rename(`${file(key)}.tmp`, file(key));
        return result;
      });
      writes.set(key, task.catch(() => {}));
      return task;
    },
  };
}
