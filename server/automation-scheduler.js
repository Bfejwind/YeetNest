import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { singaporeDay, DAILY_LAUNCH_COUNT } from '../src/daily-launch-plan.js';
import { openAutomationStore } from './automation-store.js';

// The journal decides whether work is needed; exit code zero can also mean pending.
export function startAutomationScheduler({ env = process.env, now = () => new Date(), launch = spawn, every = setInterval, cancel = clearInterval, openStore = openAutomationStore, report = console.log } = {}) {
  if (env.AUTOLAUNCH_ENABLED !== 'true' || env.AUTOLAUNCH_SCHEDULER_ENABLED === 'false') return () => {};
  if (!['DATABASE_URL', 'AUTOLAUNCH_WALLET', 'AUTOLAUNCH_SECRET_KEY', 'SOLANA_RPC_URL', 'PINATA_JWT'].every(key => !!env[key])) {
    report('AUTOMATION_SCHEDULER_MISSING_CONFIGURATION');
    return () => {};
  }
  let worker = null, checking = false, stopped = false, completedDay = null, retryAfter = 0;
  const tick = async () => {
    const day = singaporeDay(now());
    if (stopped || checking || worker || !day.due || completedDay === day.date || now().getTime() < retryAfter) return;
    checking = true;
    let store;
    try {
      store = await openStore(env.DATABASE_URL);
      const record = await store.get(day.date);
      await store.close(); store = null;
      if (stopped || singaporeDay(now()).date !== day.date) return;
      if (record?.blocked || (record?.slots.length === DAILY_LAUNCH_COUNT && record.slots.every(row => row?.state === 'confirmed' && row.registered))) {
        completedDay = day.date;
        return;
      }
      worker = launch(process.execPath, [fileURLToPath(new URL('./autolaunch.js', import.meta.url))], { env: { ...process.env, ...env }, windowsHide: true, stdio: 'inherit' });
      report('AUTOMATION_SCHEDULER_WORKER_STARTED ' + day.date);
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true; worker = null;
        retryAfter = now().getTime() + 300000;
      };
      worker.once('error', settle);
      worker.once('exit', settle);
    } catch {
      // Do not expose database URLs, provider errors or signing credentials.
      report('AUTOMATION_SCHEDULER_RETRY_CHECK_CONFIGURATION_AND_DATABASE');
      retryAfter = now().getTime() + 300000;
    } finally {
      await store?.close().catch(() => {});
      checking = false;
    }
  };
  const timer = every(tick, 60000); timer.unref?.();
  report('AUTOMATION_SCHEDULER_ENABLED 09:15 Asia/Singapore');
  void tick();
  return () => { stopped = true; cancel(timer); worker?.kill('SIGTERM'); };
}
