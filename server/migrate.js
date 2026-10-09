import 'dotenv/config';
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { databaseConfig } from './database-config.js';
import { createHash } from 'node:crypto';

if (!process.env.DATABASE_URL) throw new Error('Set server-only DATABASE_URL before running migrations.');
const client = new pg.Client(databaseConfig(process.env.DATABASE_URL));
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(741921)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied BIGINT NOT NULL)');
  const directory = new URL('./migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter(name => /^\d+-[a-z-]+\.sql$/.test(name)).sort()) {
    const sql = await readFile(new URL(file, directory), 'utf8');
    const checksum = createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
    const prior = (await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [file])).rows[0];
    if (prior && prior.checksum !== checksum) throw new Error('Applied migration changed. Add a new migration instead.');
    if (!prior) {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name,checksum,applied) VALUES($1,$2,$3)', [file, checksum, Date.now()]);
    }
  }
  await client.query('COMMIT');
  console.log('Application database migrations complete.');
} catch {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migration failed. Verify DATABASE_URL, connectivity and migration-role permissions.');
  process.exitCode = 1;
} finally { await client.end(); }
