import { DAILY_LAUNCH_COUNT, rotatingTemplate, singaporeDay } from './daily-launch-plan.js';
export { DAILY_LAUNCH_COUNT, animalArtwork, rotatingTemplate, singaporeDay } from './daily-launch-plan.js';
let currentWallet = () => null;
export function configureScheduleWallet(getWallet) { currentWallet = getWallet; }
export const scheduleKey = 'yn-weekday-launches-v1';
export function loadSchedule() {
  const raw = localStorage.getItem(scheduleKey);
  const s = raw ? JSON.parse(raw) : { enabled: false, wallet: '', templates: [null, null], attempts: {} };
  s.templates = Array.from({ length: DAILY_LAUNCH_COUNT }, (_, i) => s.templates?.[i] ?? null);
  s.rotateAnimals ??= true;
  return s;
}
export function saveSchedule(value) { localStorage.setItem(scheduleKey, JSON.stringify(value)); }
export function nextScheduled(now = new Date()) {
  const s = loadSchedule(), day = singaporeDay(now);
  if (!s.enabled || !day.due || s.wallet !== currentWallet() || localStorage.getItem('yn-pending-registration')) return null;
  const slot = s.templates.findIndex((template, i) => (template || s.rotateAnimals) && !s.attempts[`${day.date}:${i}`]);
  return slot < 0 ? null : { key: `${day.date}:${slot}`, wallet: s.wallet, template: s.rotateAnimals ? rotatingTemplate(slot, now, s.templates[slot]) : s.templates[slot] };
}
export async function executeScheduled(job, prepared) {
  if (!job) return prepared.execute();
  if (!navigator.locks) throw new Error('This browser needs Web Locks support for scheduled launches.');
  return navigator.locks.request('yn-weekday-signing', async () => {
    const s = loadSchedule();
    if (!singaporeDay().due || !job.key.startsWith(singaporeDay().date + ':') || !s.enabled || s.wallet !== job.wallet || currentWallet() !== job.wallet || s.attempts[job.key]) throw new Error('Schedule changed or this slot was already attempted. Check Creator Studio recovery.');
    s.attempts[job.key] = { state: 'needs-recovery', mint: prepared.mint, wallet: job.wallet };
    saveSchedule(s); // Persist before asking the wallet; ambiguous outcomes must never create a replacement.
    const signatures = await prepared.execute();
    const latest = loadSchedule();
    latest.attempts[job.key] = { ...s.attempts[job.key], state: 'confirmed', signature: signatures[0] };
    saveSchedule(latest);
    return signatures;
  });
}
export function mountSchedule({ launch, esc, toast, render, connect, automationApi, authenticateAutomation, serverAutomation = false }) {
  const s = loadSchedule();
  if (serverAutomation) {
    const section = document.createElement('section'); section.className = 'setup-section';
    section.innerHTML = '<h2>Daily launches / server automation</h2><p>Up to five creations every day from 9:15 a.m. Singapore time. Maximum daily funding including fees: 0.02 SOL. No token purchases. Browser scheduling is disabled. Budget or transaction recovery may prevent all five creations.</p><p>Check the automation worker logs and npm run autolaunch:status for results. Closing this browser does not stop the server worker.</p>';
    section.insertAdjacentHTML('beforeend', '<p role="status" id="automation-status">Checking today&#39;s automation...</p><button class="secondary" id="automation-refresh">Refresh automation status</button> <button class="secondary" id="automation-restart" disabled>Restart today&#39;s automation</button><p class="fine">Restart requires a configured operator wallet. Existing transactions and the 0.02 SOL daily cap are preserved.</p>');
    document.querySelector('.content').append(section);
    const status = section.querySelector('#automation-status'), restart = section.querySelector('#automation-restart');
    const refresh = async () => {
      restart.disabled = true;
      try {
        const result = await automationApi('/automation/status');
        status.textContent = result.day + ': ' + result.confirmed + '/5 confirmed. ' + (result.complete ? 'Completed.' : result.blocked ? 'Blocked: ' + result.blocked : result.running ? 'Worker running.' : result.recorded ? 'Run recorded; refresh for progress.' : 'No run recorded today.') + (!result.due ? ' Scheduled from 9:15 a.m. Singapore time.' : '') + (!result.restartConfigured ? ' Restart requires server worker credentials and an operator wallet configuration.' : '');
        restart.disabled = !result.restartConfigured || !result.due || result.complete || result.running || !!result.blocked;
      } catch (error) { status.textContent = error.message; }
    };
    section.querySelector('#automation-refresh').onclick = refresh;
    restart.onclick = async () => {
      restart.disabled = true;
      try { await authenticateAutomation(); const result = await automationApi('/automation/restart', { method: 'POST', body: '{}' }); toast(result.started ? 'Automation restart requested. Refresh status for progress.' : 'No restart needed.'); await refresh(); }
      catch (error) { toast(error.message); await refresh(); }
    };
    void refresh(); return;
  }
  const section = document.createElement('section'); section.className = 'setup-section';
  section.innerHTML = `<div class="section-heading"><h2>Daily launches</h2><button class="secondary" id="weekday-toggle">${s.enabled ? 'Pause schedule' : 'Connect Phantom and enable'}</button></div><p>Five coins every day from 9:15 a.m. Singapore time. Keep this site open and approve Phantom login and each launch. Missed days are skipped. Templates and history are saved in this browser only.</p><label><input type="checkbox" id="weekday-animals" ${s.rotateAnimals ? 'checked' : ''}/> Rotate animal sunglasses artwork: five different portraits per day, alternating between two sets</label><button class="secondary" id="weekday-review">Review next due launch</button><p>Scheduled wallet: ${esc(s.wallet || 'Not set')}</p>${Array.from({ length: DAILY_LAUNCH_COUNT }, (_, i) => i).map(i => `<div class="health-check"><div><b>Slot ${i+1}: ${esc((s.rotateAnimals ? rotatingTemplate(i, new Date(), s.templates[i]) : s.templates[i])?.fields.name || 'No template')}</b><span>${s.rotateAnimals ? 'Artwork, animal name and ticker change together each day.' : 'Saved artwork, name and ticker are reused each day.'}</span></div><button class="secondary" data-template="${i}">Edit template</button></div>`).join('')}<p class="fine">${Object.entries(s.attempts).slice(-10).map(([key, a]) => `${esc(key)}: ${esc(a.state)} - ${esc(a.mint)}`).join('<br>') || 'No scheduled attempts yet.'}</p><p class="fine">An attempted slot cannot be launched again automatically, including after rejection. Use Transaction recovery for unresolved attempts. Do not clear browser storage to retry.</p>`;
  document.querySelector('.content').append(section);
  section.querySelector('#weekday-animals').onchange = event => { try { const current = loadSchedule(); current.rotateAnimals = event.target.checked; saveSchedule(current); render(); } catch (error) { toast(error.message); } };
  section.querySelector('#weekday-review').onclick = () => { try { const job = nextScheduled(); if (!job) throw new Error('No launch is due. Check wallet, schedule, templates and transaction recovery.'); launch({ job }); } catch (error) { toast(error.message); } };
  section.querySelectorAll('[data-template]').forEach(b => b.onclick = () => launch({ editSlot: Number(b.dataset.template) }));
  section.querySelector('#weekday-toggle').onclick = async () => {
    try {
      if (s.enabled) { const current = loadSchedule(); current.enabled = false; saveSchedule(current); }
      else {
        if (!s.rotateAnimals && s.templates.some(t => !t)) throw new Error('Save all five templates first.');
        if (!navigator.locks) throw new Error('Scheduled launches require a browser supporting Web Locks.');
        await connect();
        const current = loadSchedule(), owner = currentWallet();
        if (current.wallet && current.wallet !== owner) throw new Error('Connect the wallet that owns these templates.');
        current.wallet = owner; current.enabled = true; saveSchedule(current);
      }
      render();
    } catch (error) { toast(error.message); }
  };
}
