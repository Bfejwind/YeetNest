import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

let failed = false;
function check(label, passed, advice) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}${passed ? '' : ': ' + advice}`);
  if (!passed) failed = true;
}
const env = process.env;
for (const key of ['DATABASE_URL', 'SOLANA_RPC_URL', 'PINATA_JWT', 'JUPITER_API_KEY']) {
  check(key + ' configured', Boolean(env[key]?.trim()), 'Set this privately in the web-service Environment page.');
}
try {
  const rpc = new URL(env.SOLANA_RPC_URL);
  check('Dedicated HTTPS RPC', rpc.protocol === 'https:' && rpc.hostname !== 'api.mainnet-beta.solana.com', 'Use your provider mainnet HTTPS RPC, not the public default.');
} catch { check('RPC URL format', false, 'Set a valid mainnet HTTPS RPC URL.'); }
try {
  const db = new URL(env.DATABASE_URL);
  check('PostgreSQL URL format', ['postgres:', 'postgresql:'].includes(db.protocol), 'Use the database connection URL.');
} catch { check('PostgreSQL URL format', false, 'Set DATABASE_URL.'); }
check('Pump protocol', !env.INDEXER_PROTOCOL || env.INDEXER_PROTOCOL === 'pump', 'Set INDEXER_PROTOCOL=pump.');
check('Continuous worker configuration', env.INDEXER_ONCE !== 'true', 'Remove INDEXER_ONCE from Render.');
if (env.NODE_ENV === 'production') check('Render proxy configuration', env.TRUST_PROXY_HOPS === '1', 'On Render set TRUST_PROXY_HOPS=1.');
check('Production build exists', existsSync('dist/index.html'), 'Run npm run build first.');
check('Migration 014 present', readdirSync('server/migrations').some(name => name.startsWith('014-')), 'Restore the small-launchpad migration before deployment.');
const git = spawnSync('git', ['ls-files', '--', '.env', '.env.local', '.env.production'], { encoding: 'utf8', windowsHide: true });
if (git.status === 0) check('Local secret env files untracked', !git.stdout.trim(), 'Remove tracked secrets from Git and rotate exposed credentials.');
else console.log('WARN Git tracking check unavailable in this environment.');
console.log('This checks configuration only. It does not verify credentials, applied migrations, mainnet connectivity, worker health, trading or security. No secrets are printed.');
process.exitCode = failed ? 1 : 0;
