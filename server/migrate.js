import 'dotenv/config';
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { databaseConfig } from './database-config.js';

if (!process.env.DATABASE_URL) throw new Error('Set server-only DATABASE_URL before running migrations.');
const client = new pg.Client(databaseConfig(process.env.DATABASE_URL));
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(741921)');
  const directory = new URL('./migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter(name => /^\d+-[a-z-]+\.sql$/.test(name)).sort()) {
    await client.query(await readFile(new URL(file, directory), 'utf8'));
  }
  await client.query('COMMIT');
  console.log('Application database migrations complete.');
} catch {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migration failed. Verify DATABASE_URL, connectivity and migration-role permissions.');
  process.exitCode = 1;
} finally { await client.end(); }
