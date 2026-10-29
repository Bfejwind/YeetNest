import pg from 'pg';
import { databaseConfig } from './database-config.js';
import { stop } from './automation-core.js';
export async function openAutomationStore(databaseUrl) {
  const client = new pg.Client(databaseConfig(databaseUrl));
  let lost = false, locked = false;
  client.on('error', () => { lost = true; });
  await client.connect();
  return {
    async acquire() {
      const result = await client.query('SELECT pg_try_advisory_lock(741922) AS locked');
      locked = result.rows[0].locked; return locked;
    },
    async ready() { await client.query('SELECT day FROM automation_days LIMIT 0'); await client.query('SELECT artwork FROM automation_metadata LIMIT 0'); },
    async get(day) { if (lost) throw stop('AUTOMATION_DATABASE_LOCK_LOST'); return (await client.query('SELECT data FROM automation_days WHERE day=$1', [day])).rows[0]?.data; },
    async save(day, data) {
      if (lost || !locked) throw stop('AUTOMATION_DATABASE_LOCK_LOST');
      await client.query('INSERT INTO automation_days(day,data,updated) VALUES($1,$2::jsonb,$3) ON CONFLICT(day) DO UPDATE SET data=EXCLUDED.data,updated=EXCLUDED.updated', [day, JSON.stringify(data), Date.now()]);
    },
    async metadata(creator, artwork) { return (await client.query('SELECT data FROM automation_metadata WHERE creator=$1 AND artwork=$2', [creator, artwork])).rows[0]?.data; },
    async cacheMetadata(creator, artwork, data) {
      if (lost || !locked) throw stop('AUTOMATION_DATABASE_LOCK_LOST');
      await client.query('INSERT INTO automation_metadata(creator,artwork,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(creator,artwork) DO NOTHING', [creator, artwork, JSON.stringify(data)]);
    },
    async recent() { return (await client.query('SELECT data FROM automation_days ORDER BY day DESC LIMIT 30')).rows.map(row=>row.data); },
    async claimReady() { await client.query('SELECT day FROM automation_fee_claims LIMIT 0'); },
    async claimGet(day,wallet) { if(lost)throw stop('AUTOMATION_DATABASE_LOCK_LOST');return (await client.query('SELECT data FROM automation_fee_claims WHERE day=$1 AND wallet=$2',[day,wallet])).rows[0]?.data; },
    async claimRecent(wallet) { return (await client.query('SELECT data FROM automation_fee_claims WHERE wallet=$1 ORDER BY day DESC LIMIT 30',[wallet])).rows.map(row=>row.data); },
    async claimSave(day,wallet,data) {
      if(lost||!locked)throw stop('AUTOMATION_DATABASE_LOCK_LOST');
      await client.query('INSERT INTO automation_fee_claims(day,wallet,data,updated) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(day,wallet) DO UPDATE SET data=EXCLUDED.data,updated=EXCLUDED.updated',[day,wallet,JSON.stringify(data),Date.now()]);
    },
    async summary() {
      const rows = (await client.query('SELECT day,data FROM automation_days ORDER BY day DESC LIMIT 14')).rows;
      return rows.map(({day,data}) => ({ day, wallet: data.wallet, payer: data.payer, dailyCapSol:String(data.cap / 1_000_000_000), initialBuySol:'0', fundingState:data.funding?.state || 'not-funded', fundingSignature:data.funding?.signature, blocked:data.blocked, slots:data.slots.map((s,i)=>({slot:i+1,state:s?.state || 'not-created',mint:s?.mint,signature:s?.signature,registered:!!s?.registered,reservedLamports:s?.reserve})) }));
    },
    async close() { try { if (locked && !lost) await client.query('SELECT pg_advisory_unlock(741922)'); } finally { await client.end(); } },
  };
}
