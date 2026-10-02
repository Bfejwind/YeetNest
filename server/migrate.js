import 'dotenv/config';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

if (!process.env.DATABASE_URL) throw new Error('Set server-only DATABASE_URL before running migrations.');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(741921)');
  await client.query(await readFile(new URL('./migrations/001-community.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Community database migration complete.');
} catch {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migration failed. Verify DATABASE_URL, connectivity and migration-role permissions.');
  process.exitCode = 1;
} finally { await client.end(); }
