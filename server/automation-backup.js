import 'dotenv/config';
import pg from 'pg';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { databaseConfig } from './database-config.js';
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const client=new pg.Client(databaseConfig(process.env.DATABASE_URL));client.on('error',()=>{});
try {
 await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
 const snapshot={format:'yeetnest-public-data-v1',created:new Date().toISOString(),tables:{}};
 let bytes=0;
 for(const {tablename} of tables) {
  const estimate=await client.query(`SELECT COALESCE(sum(octet_length(row_to_json(t)::text)),0)::text AS size FROM public.${quote(tablename)} t`);
  bytes+=Number(estimate.rows[0].size);if(bytes>64*1024*1024)throw new Error('BACKUP_TOO_LARGE');
  // Database renders bytea, timestamps and numeric types to restorable PostgreSQL JSON.
  const rows=(await client.query(`SELECT row_to_json(t)::text AS value FROM public.${quote(tablename)} t`)).rows.map(row=>JSON.parse(row.value));
  snapshot.tables[tablename]=rows;
 }
 await client.query('COMMIT');
 await mkdir('data/backups',{recursive:true});
 const filename=`data/backups/pre-autolaunch-${Date.now()}.json`,payload=JSON.stringify(snapshot);
 await writeFile(filename,payload,{flag:'wx',mode:0o600});
 const verified=JSON.parse(await readFile(filename,'utf8'));
 await client.query('BEGIN');
 for(const [table,rows] of Object.entries(verified.tables)) {
  await client.query(`CREATE TEMP TABLE automation_backup_check (LIKE public.${quote(table)}) ON COMMIT DROP`);
  await client.query(`INSERT INTO automation_backup_check SELECT * FROM json_populate_recordset(NULL::public.${quote(table)},$1::json)`,[JSON.stringify(rows)]);
  const count=(await client.query('SELECT count(*)::text AS count FROM automation_backup_check')).rows[0].count;
  if(Number(count)!==rows.length)throw new Error('BACKUP_ROW_COUNT_MISMATCH');
  await client.query('DROP TABLE automation_backup_check');
 }
 await client.query('ROLLBACK');
 console.log(JSON.stringify({backup:filename,tables:Object.keys(verified.tables).length,rows:Object.values(verified.tables).reduce((n,rows)=>n+rows.length,0),sha256:createHash('sha256').update(payload).digest('hex'),verified:'file read-back and typed temporary-table row restore; live tables unchanged'}));
}catch {await client.query('ROLLBACK').catch(()=>{});console.error('Backup/temporary restore check failed; migration was not run.');process.exitCode=1;}
finally{await client.end().catch(()=>{});}
