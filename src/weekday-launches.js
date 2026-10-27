export const animalArtwork = [
  ['golden-retriever', 'Golden Retriever Shades', 'GOLDPUP'], ['ginger-kitten', 'Ginger Kitten Shades', 'GINGERCAT'],
  ['rabbit', 'Rabbit Shades', 'BUNNY'], ['red-panda', 'Red Panda Shades', 'REDPANDA'],
  ['otter', 'Otter Sunshine', 'OTTERSUN'], ['hedgehog', 'Hedgehog Chill', 'HEDGECHILL'],
  ['corgi', 'Corgi Cool', 'CORGI'], ['capybara', 'Capy Sunshine', 'CAPYSUN'],
  ['raccoon', 'Raccoon Rays', 'RACRAYS'], ['koala', 'Koala Shades', 'KOALASHADE'],
];
export function rotatingTemplate(slot, now = new Date(), base = null) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Singapore', weekday: 'short' }).format(now);
  const index = Math.max(0, ['Mon','Tue','Wed','Thu','Fri'].indexOf(weekday)) * 2 + slot;
  const [file, name, ticker] = animalArtwork[index];
  return { fields: { description: 'A little sunshine, a lot of cool.', initialBuy: '0', initialSlippage: '100', ...base?.fields, name, ticker }, image: `/weekday-animals/${file}.png` };
}
let currentWallet = () => null;
export function configureScheduleWallet(getWallet) { currentWallet = getWallet; }
export const scheduleKey = 'yn-weekday-launches-v1';
export function singaporeDay(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, due: !['Sat', 'Sun'].includes(parts.weekday) && (Number(parts.hour) * 60 + Number(parts.minute)) >= 565 };
}
export function loadSchedule() {
  const raw = localStorage.getItem(scheduleKey);
  const s = raw ? JSON.parse(raw) : { enabled: false, wallet: '', templates: [null, null], attempts: {} };
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
export function mountSchedule({ launch, esc, toast, render, connect }) {
  const s = loadSchedule();
  const section = document.createElement('section'); section.className = 'setup-section';
  section.innerHTML = `<div class="section-heading"><h2>Weekday launches</h2><button class="secondary" id="weekday-toggle">${s.enabled ? 'Pause schedule' : 'Connect Phantom and enable'}</button></div><p>Two coins each Monday-Friday from 9:25 a.m. Singapore time. Keep this site open and approve Phantom login and each launch. Missed days are skipped. Templates and history are saved in this browser only.</p><label><input type="checkbox" id="weekday-animals" ${s.rotateAnimals ? 'checked' : ''}/> Rotate animal sunglasses artwork: two different portraits per weekday, repeating weekly</label><button class="secondary" id="weekday-review">Review next due launch</button><p>Scheduled wallet: ${esc(s.wallet || 'Not set')}</p>${[0,1].map(i => `<div class="health-check"><div><b>Slot ${i+1}: ${esc((s.rotateAnimals ? rotatingTemplate(i, new Date(), s.templates[i]) : s.templates[i])?.fields.name || 'No template')}</b><span>${s.rotateAnimals ? 'Artwork, animal name and ticker change together each weekday.' : 'Saved artwork, name and ticker are reused each weekday.'}</span></div><button class="secondary" data-template="${i}">Edit template</button></div>`).join('')}<p class="fine">${Object.entries(s.attempts).slice(-10).map(([key, a]) => `${esc(key)}: ${esc(a.state)} - ${esc(a.mint)}`).join('<br>') || 'No scheduled attempts yet.'}</p><p class="fine">An attempted slot cannot be launched again automatically, including after rejection. Use Transaction recovery for unresolved attempts. Do not clear browser storage to retry.</p>`;
  document.querySelector('.content').append(section);
  section.querySelector('#weekday-animals').onchange = event => { try { const current = loadSchedule(); current.rotateAnimals = event.target.checked; saveSchedule(current); render(); } catch (error) { toast(error.message); } };
  section.querySelector('#weekday-review').onclick = () => { try { const job = nextScheduled(); if (!job) throw new Error('No launch is due. Check wallet, schedule, templates and transaction recovery.'); launch({ job }); } catch (error) { toast(error.message); } };
  section.querySelectorAll('[data-template]').forEach(b => b.onclick = () => launch({ editSlot: Number(b.dataset.template) }));
  section.querySelector('#weekday-toggle').onclick = async () => {
    try {
      if (s.enabled) { const current = loadSchedule(); current.enabled = false; saveSchedule(current); }
      else {
        if (!s.rotateAnimals && s.templates.some(t => !t)) throw new Error('Save both templates first.');
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
