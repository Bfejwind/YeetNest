import { createIcons, icons } from './ui-icons.js';
import * as chain from './chain.js';
import { pumpFeatures } from './pump-features.js';

const icon = name => `<i data-lucide="${name}"></i>`;
function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
const profile = () => read('yn-profile', { name: 'Anonymous', bio: '' });

export function installMarketUI(context) {
  const { page, navigate, esc, mode, coins, money, openCoin, image, toast } = context;
  const nav = document.querySelector('nav');
  for (const [name, glyph] of [['Terminal', 'columns-3'], ['Leaderboard', 'trophy'], ['Profile', 'user-round']]) {
    const button = document.createElement('button');
    button.className = `nav-item ${page === name ? 'active' : ''}`;
    button.title = name;
    button.innerHTML = `${icon(glyph)}<span>${name}</span>`;
    button.onclick = () => navigate(name);
    nav.insertBefore(button, nav.lastElementChild);
  }
  const content = document.querySelector('.content');
  if (page === 'Explore') content.querySelector('.heading h1').textContent = 'Explore coins';
  if (page === 'Watchlist' && mode === 'live') {
    const button = document.createElement('button');
    button.className = 'secondary';
    button.innerHTML = `${icon('refresh-cw')} Sync watchlist`;
    content.querySelector('.heading').append(button);
    button.onclick = async () => {
      button.disabled = true;
      try { await chain.authenticate(); context.setWatchlist(await chain.api('/watchlist')); }
      catch(error) { toast(error.message); }
      finally { button.disabled = false; }
    };
  }
  if (page === 'Integrations') {
    document.querySelector('.parity h2').textContent = 'Pump.fun feature coverage';
    document.querySelector('.parity p').textContent = 'YeetNest uses Raydium, not Pump contracts. Funded launch, trading and claim acceptance remain unverified.';
    document.querySelector('.parity tbody').innerHTML = pumpFeatures.map(([name, status, remaining]) => `<tr><td>${esc(name)}</td><td><span class="status-pill ${status === 'Not implemented' || status === 'Demo only' ? 'pending' : ''}">${status}</span></td><td>${esc(remaining)}</td></tr>`).join('');
    const source = document.querySelector('.parity .source-link');
    source.href = 'https://github.com/pump-fun/pump-public-docs';
    source.textContent = 'Pump official protocol documentation';
    document.querySelector('.parity').insertAdjacentHTML('beforeend', '<a class="source-link" href="/launchpad-roadmap.txt" target="_blank" rel="noopener noreferrer">Implementation checklist</a>');
  }
  if (page === 'Terminal') {
    content.innerHTML = `<div class="heading"><div><div class="eyebrow">${mode === 'demo' ? 'DEMO MARKET' : 'LOADED YEETNEST POOLS'}</div><h1>Terminal</h1></div><label class="terminal-search">${icon('search')}<input aria-label="Search terminal" placeholder="Search coins" /></label></div><div class="terminal-board"></div>`;
    const renderBoard = () => {
      const query = content.querySelector('input').value.trim().toLowerCase();
      const available = coins.filter(c => `${c.name} ${c.ticker} ${c.mint || ''}`.toLowerCase().includes(query));
      const groups = [
        ['New pairs', available.filter(c => c.progress != null && c.progress < 65).sort((a,b) => (b.created || Number(b.id) || 0) - (a.created || Number(a.id) || 0))],
        ['About to graduate', available.filter(c => c.progress >= 65 && c.progress < 100).sort((a,b) => b.progress-a.progress)],
        ['Graduated', available.filter(c => mode === 'demo' ? c.progress >= 100 : c.launchStatus === 'Graduated')],
      ];
      content.querySelector('.terminal-board').innerHTML = groups.map(([name, values]) => `<section class="terminal-column"><div class="terminal-heading"><h2>${name}</h2><span>${values.length}</span></div>${values.map(c => `<button class="terminal-coin" data-open-coin="${esc(c.id)}"><img src="${esc(image(c))}" alt=""/><div><strong>${esc(c.name)}</strong><span>$${esc(c.ticker)}</span><small>MC ${money(c.cap)} · Vol ${money(c.volume)}</small><div class="progress"><span style="width:${Math.max(0, Math.min(c.progress || 0, 100))}%"></span></div></div><b class="${c.change < 0 ? 'negative' : 'change'}">${c.change == null ? '--' : `${c.change.toFixed(2)}%`}</b></button>`).join('') || '<p class="board-empty">No matching pairs.</p>'}</section>`).join('');
      content.querySelectorAll('[data-open-coin]').forEach(b => b.onclick = () => openCoin(b.dataset.openCoin));
    };
    content.querySelector('input').oninput = renderBoard;
    renderBoard();
  }
  if (page === 'Leaderboard') {
    content.innerHTML = `<div class="heading"><div><div class="eyebrow">${mode === 'demo' ? 'SAMPLE COINS' : 'LOADED ASSETS ONLY'}</div><h1>Token leaderboard</h1></div><select id="rank-by" aria-label="Rank tokens"><option value="volume">24h volume</option><option value="cap">Market cap</option><option value="change">24h change</option></select></div><div class="rankings"></div>`;
    const renderRanking = () => {
      const field = content.querySelector('#rank-by').value;
      const ranked = [...coins].filter(c => Number.isFinite(c[field])).sort((a,b) => b[field]-a[field]);
      content.querySelector('.rankings').innerHTML = ranked.map((c,i) => `<button class="ranking-row" data-open-coin="${esc(c.id)}"><span class="rank-number">${i+1}</span><img src="${esc(image(c))}" alt=""/><span><strong>${esc(c.name)}</strong><small>$${esc(c.ticker)}</small></span><b>${field === 'change' ? `${c.change.toFixed(2)}%` : money(c[field])}</b></button>`).join('') || '<p class="board-empty">No ranking data available.</p>';
      content.querySelectorAll('[data-open-coin]').forEach(b => b.onclick = () => openCoin(b.dataset.openCoin));
    };
    content.querySelector('#rank-by').onchange = renderRanking;
    renderRanking();
  }
  if (page === 'Profile') {
    const mine = profile();
    const address = mode === 'live' ? chain.publicKey?.toBase58() : null;
    content.innerHTML = `<div class="heading"><div><div class="eyebrow">BROWSER-LOCAL PROFILE</div><h1>Your profile</h1></div></div><form class="profile-form"><label>Display name<input name="name" maxlength="24" required value="${esc(mine.name)}"/></label><label>Bio<textarea name="bio" maxlength="240">${esc(mine.bio)}</textarea></label><div class="profile-wallet"><span>Connected wallet</span><code>${esc(address || 'Not connected')}</code></div><p class="form-error" role="alert"></p><button class="primary" type="submit">${icon('save')} Save profile</button></form>`;
    if (mode === 'live') {
      content.querySelector('.eyebrow').textContent = 'WALLET PROFILE';
      if (address) chain.api(`/community/profiles/${address}`).then(saved => {
        if (!content.isConnected || chain.publicKey?.toBase58() !== address) return;
        content.querySelector('[name="name"]').value = saved.name;
        content.querySelector('[name="bio"]').value = saved.bio;
      }).catch(error => { if (content.isConnected) content.querySelector('.form-error').textContent = error.message; });
    }
    content.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = Object.fromEntries(new FormData(form));
      const name = data.name.trim();
      if (!name) { form.querySelector('.form-error').textContent = 'Enter a display name.'; return; }
      const button = form.querySelector('button');
      button.disabled = true;
      form.querySelector('.form-error').textContent = '';
      try {
        if (mode === 'live') {
          await chain.authenticate();
          await chain.api('/community/profile', { method: 'POST', body: JSON.stringify({ name, bio: data.bio.trim() }) });
          toast('Profile saved.');
        } else {
          localStorage.setItem('yn-profile', JSON.stringify({ name, bio: data.bio.trim() }));
          toast('Profile saved in this browser.');
        }
      } catch(error) { form.querySelector('.form-error').textContent = error.message; }
      finally { button.disabled = false; }
    };
  }
  createIcons({ icons });
}

export function mountDiscussion(coin, { mode, esc, toast }) {
  if (mode !== 'demo') {
    if (coin.mint) mountLiveDiscussion(coin, { esc, toast });
    return;
  }
  const key = `yn-discussion-${coin.id}`;
  const reportsKey = `yn-reports-${coin.id}`;
  const modal = document.querySelector('.modal');
  modal.insertAdjacentHTML('beforeend', `<section class="discussion"><div class="section-heading"><h2>Discussion</h2><span class="status-pill pending">Browser-local demo</span></div><div class="discussion-posts"></div><form id="discussion-form"><label>Comment<textarea name="body" maxlength="500" required></textarea></label><p class="form-error" role="alert"></p><button class="primary" type="submit">${icon('message-square')} Post comment</button></form></section>`);
  const root = modal.querySelector('.discussion');
  const show = () => {
    const posts = read(key, []);
    const reports = read(reportsKey, []);
    root.querySelector('.discussion-posts').innerHTML = posts.map(post => `<article class="discussion-post"><div><strong>${esc(post.author)}</strong><time>${esc(new Date(post.created).toLocaleString())}</time><button class="icon-button" data-remove-post="${esc(post.id)}" title="Delete local comment">${icon('trash-2')}</button><button class="icon-button" data-report-post="${esc(post.id)}" title="Report comment" ${reports.includes(post.id) ? 'disabled' : ''}>${icon('flag')}</button></div><p>${esc(post.body)}</p></article>`).join('') || '<p class="board-empty">No comments in this browser.</p>';
    root.querySelectorAll('[data-remove-post]').forEach(button => button.onclick = () => {
      try { localStorage.setItem(key, JSON.stringify(posts.filter(p => p.id !== button.dataset.removePost))); show(); }
      catch { toast('Browser storage is unavailable.'); }
    });
    root.querySelectorAll('[data-report-post]').forEach(button => button.onclick = () => {
      try { localStorage.setItem(reportsKey, JSON.stringify([...reports, button.dataset.reportPost])); show(); toast('Report saved locally. No moderation service is connected.'); }
      catch { toast('Browser storage is unavailable.'); }
    });
    createIcons({ icons });
  };
  root.querySelector('form').onsubmit = event => {
    event.preventDefault();
    const body = new FormData(event.currentTarget).get('body').trim();
    if (!body) return;
    try {
      const posts = read(key, []);
      if (posts.length >= 100) throw new Error('This demo discussion is full. Delete older comments first.');
      localStorage.setItem(key, JSON.stringify([...posts, { id: crypto.randomUUID(), author: profile().name, body, created: Date.now() }]));
      event.currentTarget.reset();
      show();
    } catch(error) { root.querySelector('.form-error').textContent = error.message; }
  };
  show();
}

function mountLiveDiscussion(coin, { esc, toast }) {
  const modal = document.querySelector('.modal');
  modal.insertAdjacentHTML('beforeend', `<section class="discussion"><div class="section-heading"><h2>Discussion</h2></div><div class="discussion-posts"></div><form><label>Comment<textarea name="body" maxlength="500" required></textarea></label><p class="form-error" role="alert"></p><button class="primary" type="submit">${icon('message-square')} Post comment</button></form></section>`);
  const root = modal.querySelector('.discussion');
  const errorBox = root.querySelector('.form-error');
  const endpoint = `/community/coins/${encodeURIComponent(coin.mint)}/comments`;
  const refresh = async () => {
    const posts = await chain.api(endpoint);
    if (!root.isConnected) return;
    const wallet = chain.publicKey?.toBase58();
    root.querySelector('.discussion-posts').innerHTML = posts.map(post => `<article class="discussion-post"><div><strong title="${esc(post.wallet)}">${esc(post.author)}</strong><time>${esc(new Date(post.created).toLocaleString())}</time>${post.wallet === wallet ? `<button class="icon-button" data-delete="${esc(post.id)}" title="Delete your comment">${icon('trash-2')}</button>` : ''}</div><p>${esc(post.body)}</p><form data-report="${esc(post.id)}"><select name="reason" aria-label="Report reason"><option value="spam">Spam</option><option value="scam">Scam</option><option value="abuse">Abuse</option></select><button class="icon-button" title="Report comment" type="submit">${icon('flag')}</button></form></article>`).join('') || '<p class="board-empty">No comments yet.</p>';
    root.querySelectorAll('[data-delete]').forEach(button => button.onclick = () => change(button, async () => {
      await chain.api(`/community/comments/${button.dataset.delete}`, { method: 'DELETE' });
      await refresh();
    }));
    root.querySelectorAll('[data-report]').forEach(form => form.onsubmit = event => {
      event.preventDefault();
      change(form.querySelector('button'), async () => {
        await chain.api(`/community/comments/${form.dataset.report}/report`, { method: 'POST', body: JSON.stringify({ reason: form.elements.reason.value }) });
        toast('Report recorded. No moderation service is connected.');
      });
    });
    createIcons({ icons });
  };
  const change = async (button, action) => {
    button.disabled = true;
    errorBox.textContent = '';
    try { await chain.authenticate(); await action(); }
    catch(error) { if (root.isConnected) errorBox.textContent = error.message; }
    finally { button.disabled = false; }
  };
  root.querySelector('form').onsubmit = event => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = form.elements.body.value.trim();
    if (!body) return;
    change(form.querySelector('button'), async () => {
      await chain.api(endpoint, { method: 'POST', body: JSON.stringify({ body }) });
      form.reset();
      await refresh();
    });
  };
  refresh().catch(error => { if (root.isConnected) errorBox.textContent = error.message; });
}
