import { DAILY_CAP } from './automation-core.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openAutomationStore } from './automation-store.js';
import { singaporeDay, DAILY_LAUNCH_COUNT } from '../src/daily-launch-plan.js';

export function installAutomationControl(app, { config, auth, route, fail }) {
  let worker = null, lastStarted = 0, lastExit = null;
  const operators = (config.AUTOLAUNCH_OPERATOR_WALLETS || '').split(',').map(s => s.trim()).filter(Boolean);
  const enabled = () => config.AUTOLAUNCH_ENABLED === 'true';
  const configured = () => enabled() && ['DATABASE_URL','AUTOLAUNCH_WALLET','AUTOLAUNCH_SECRET_KEY','SOLANA_RPC_URL','PINATA_JWT'].every(key => !!config[key]);
  const readToday = async () => {
    const day = singaporeDay();
    if (!config.DATABASE_URL) throw fail('Automation database is not configured.', 503);
    const store = await openAutomationStore(config.DATABASE_URL);
    try {
      await store.ready();
      const record = await store.get(day.date);
      const claim = config.AUTOCLAIM_ENABLED === 'true' ? await store.claimGet(day.date,config.AUTOLAUNCH_WALLET) : null;
      const creatorFeeClaim = { enabled: config.AUTOCLAIM_ENABLED === 'true', schedule: '09:00 Asia/Singapore', state: claim?.state || 'not-run', signature: claim?.signature };
      const confirmed = record?.slots.filter(s => s?.state === 'confirmed').length || 0;
      const complete = record?.slots.length === DAILY_LAUNCH_COUNT && record.slots.every(s => s?.state === 'confirmed' && s.registered);
      return { day: day.date, creatorFeeClaim, dailyCapSol: String(DAILY_CAP / 1_000_000_000), due: day.due, recorded: !!record, confirmed, complete, blocked: ([10_000_000,20_000_000].includes(record?.cap) && ['DAILY_CREATION_BUDGET_EXHAUSTED','CREATION_SIMULATION_FAILED_OR_INSUFFICIENT_BUDGET'].includes(record?.blocked?.reason)) || (record?.blocked?.reason === 'DAILY_CREATION_BUDGET_EXHAUSTED' && record.slots.some(row=>row?.state === 'expired')) ? null : record?.blocked?.reason || null, fundingState: record?.funding?.state || 'not-funded', running: !!worker, lastExit, restartConfigured: configured() && operators.length > 0 };
    } finally { await store.close(); }
  };
  app.get('/api/automation/status', route(async (req, res) => {
    if (!enabled()) throw fail('Server automation is disabled.', 409);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await readToday());
  }));
  app.post('/api/automation/restart', route(async (req, res) => {
    const wallet = await auth(req);
    if (!operators.includes(wallet)) throw fail('This wallet is not an automation operator.', 403);
    if (!configured()) throw fail('Configure the automation worker credentials on this server before restarting.', 503);
    const status = await readToday();
    if (!status.due || status.complete) return res.json({ started: false, ...status });
    if (status.blocked) throw fail('Automation is blocked: ' + status.blocked + '. Resolve the cause and review the journal before retrying.', 409);
    if (worker || Date.now() - lastStarted < 60000) throw fail('A restart is already running or was recently requested. Refresh status shortly.', 409);
    // The worker acquires the existing PostgreSQL advisory lock and reuses the journal.
    // No journal deletion, allowance increase, or replacement transaction is allowed.
    worker = spawn(process.execPath, [fileURLToPath(new URL('./autolaunch.js', import.meta.url))], { env: { ...process.env, ...config }, windowsHide: true, stdio: 'ignore' });
    lastStarted = Date.now(); lastExit = null;
    worker.once('error', () => { lastExit = 'failed-to-start'; worker = null; });
    worker.once('exit', code => { lastExit = code === 0 ? 'finished' : 'stopped-check-worker-configuration-or-lock'; worker = null; });
    res.status(202).json({ started: true, day: status.day });
  }));
}
