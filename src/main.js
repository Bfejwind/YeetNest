import { createIcons, icons } from "./ui-icons.js";
import { createAvatar } from "@dicebear/core";
import * as bottts from "@dicebear/bottts-neutral";
import * as chain from "./chain.js";
import { fromUnits } from "./amounts.js";
import { installLaunchpadUI, mountMarket, cleanupMarket } from "./launchpad-ui.js";
import "./color-theme.css";
import "./dark-theme.css";
import "./pump-theme.css";
import { installMarketUI, mountDiscussion } from "./market-ui.js";
import { walletBrowseLink } from './wallet-links.js';
import { withTimeout } from './async-timeout.js';

const I = (name) => `<i data-lucide="${name}"></i>`;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const seeds = [
  ["Corporate Cat", "CCAT", "NVDAx", 1284000, 32.48, 186200, 87, "cat"],
  ["Just a Chill Guy", "CHILL", "SOL", 842600, 18.62, 94200, 68, "chill"],
  ["Pepe Incorporated", "PEPEINC", "SPYx", 624800, 124.8, 214500, 92, "pepe"],
  ["Department of Degen", "DOD", "USDC", 412300, -8.24, 72800, 54, "degen"],
  ["NASDAQ DOG", "NDOG", "QQQx", 298700, 45.12, 62400, 43, "dog"],
  ["Overworked Wojak", "WORK", "TSLAx", 186400, 12.76, 48300, 31, "wojak"],
  ["Infinite Money Glitch", "IMG", "SOL", 142800, 67.32, 38700, 26, "money"],
  ["Touch Grass", "GRASS", "USDC", 98200, -3.18, 21400, 18, "grass"],
];
let demoCoins = read(
  "yn-coins",
  read(
    "ah-tokens",
    seeds.map((t, id) => ({
      id,
      name: t[0],
      ticker: t[1],
      pair: t[2],
      cap: t[3],
      change: t[4],
      volume: t[5],
      progress: t[6],
      art: t[7],
      description: "A meme with a mission. Welcome to the nest.",
    })),
  ),
);
const demoCreator = localStorage.getItem("yn-creator") || crypto.randomUUID();
localStorage.setItem("yn-creator", demoCreator);
let watchlist = read("yn-watchlist", read("ah-saved", [])).map(String);
let positions = read("yn-positions", []),
  demoBalance = read("yn-balance", 10);
let mode = "demo",
  page = "Explore",
  tab = "Trending",
  category = "All coins",
  query = "",
  sort = "Trending",
  view = "grid";
let demoWallet = false,
  liveCoins = [],
  liveHoldings = [],
  solBalance = null,
  loading = false,
  liveError = "",
  lastUpdated = null;
let config = null,
  searchTimer,
  walletEpoch = 0;
const cache = new Map();
const money = (n) =>
  n == null
    ? "--"
    : n >= 1e6
      ? `$${(n / 1e6).toFixed(2)}M`
      : n >= 1000
        ? `$${(n / 1000).toFixed(1)}K`
        : `$${Number(n).toFixed(2)}`;
const connected = () =>
  mode === "demo" ? demoWallet : Boolean(chain.publicKey);
const short = (address) => `${address.slice(0, 4)}...${address.slice(-4)}`;
function image(coin) {
  if (coin.image && /^data:image\/(png|jpeg|webp);base64,/.test(coin.image))
    return coin.image;
  if (coin.image && /^https:\/\//.test(coin.image))
    return `/api/artwork?uri=${encodeURIComponent(coin.image)}`;
  const seed = String(coin.art || coin.ticker);
  if (!cache.has(seed))
    cache.set(
      seed,
      createAvatar(bottts, {
        seed,
        backgroundColor: [
          {
            cat: "f4c85f",
            chill: "a4ded1",
            pepe: "b3d77e",
            degen: "f6b8c7",
            dog: "9dd1e8",
            wojak: "dac5e5",
            money: "e7d68b",
            grass: "a3c68d",
          }[seed] || "f5bfac",
        ],
      }).toDataUri(),
    );
  return cache.get(seed);
}
const art = (coin) =>
  `<img src="${esc(image(coin))}" alt="${esc(coin.name)}" loading="lazy"/>`;
function persist() {
  localStorage.setItem("yn-coins", JSON.stringify(demoCoins));
  if (mode === 'demo') localStorage.setItem("yn-watchlist", JSON.stringify(watchlist));
  localStorage.setItem("yn-positions", JSON.stringify(positions));
  localStorage.setItem("yn-balance", JSON.stringify(demoBalance));
}
function tokenFromApi(t) {
  return {
    id: t.id,
    mint: t.id,
    name: t.name,
    ticker: t.symbol,
    decimals: t.decimals,
    image: t.icon,
    cap: t.mcap ?? null,
    change: t.stats24h?.priceChange ?? null,
    volume: t.stats24h
      ? (t.stats24h.buyVolume || 0) + (t.stats24h.sellVolume || 0)
      : null,
    pair: "SOL",
    description: t.isVerified
      ? "Jupiter-verified token."
      : "Token verification is not confirmed by Jupiter.",
    verified: Boolean(t.isVerified),
    source: "Jupiter",
    created: t.firstPool?.createdAt ? Date.parse(t.firstPool.createdAt) : null,
  };
}
const allCoins = () => (mode === "demo" ? demoCoins : liveCoins);
function filtered() {
  const holdings = mode === "demo" ? positions : liveHoldings;
  return allCoins()
    .filter(
      (t) =>
        (page !== "Watchlist" || watchlist.includes(String(t.id))) &&
        (page !== "Portfolio" ||
          holdings.some((p) => String(p.id || p.mint) === String(t.id))) &&
        (!query ||
          `${t.name} ${t.ticker} ${t.pair} ${t.mint || ""}`
            .toLowerCase()
            .includes(query.toLowerCase())) &&
        (category === "All coins" ||
          (mode === 'live' && category === 'YeetNest' && t.source === 'YeetNest') ||
          (mode === 'live' && category === 'LaunchLab' && Boolean(t.poolId)) ||
          (mode === 'live' && category === 'Market' && !t.poolId) ||
          (mode === 'demo' && (category === "Stocks"
            ? t.pair.endsWith("x")
            : category === "Crypto"
              ? ["SOL", "USDC"].includes(t.pair)
              : ["OPENAI", "ANTHROPIC"].includes(t.pair)))) &&
        (tab !== "About to graduate" ||
          (t.progress >= 65 && t.progress < 100 && (mode === 'demo' || t.launchStatus === 'Trading'))) &&
        (tab !== "Graduated" || (mode === 'demo' ? t.progress >= 100 : t.launchStatus === 'Graduated')),
    )
    .sort((a, b) =>
      tab === "New pairs"
        ? (b.created || Number(b.id) || 0) - (a.created || Number(a.id) || 0)
        : sort === "Market cap"
          ? (b.cap || 0) - (a.cap || 0)
          : sort === "Volume"
            ? (b.volume || 0) - (a.volume || 0)
            : sort === "Top gainers"
              ? (b.change || 0) - (a.change || 0)
              : 0,
    );
}

function render() {
  const coins = allCoins(),
    spotlight = coins[0],
    volume = coins.reduce((sum, c) => sum + (c.volume || 0), 0),
    address = chain.publicKey?.toBase58();
  document.querySelector("#app").innerHTML =
    `<aside class="sidebar"><a class="brand" href="#" aria-label="YeetNest home"><span class="brand-mark">${I("bird")}</span><span>YeetNest<span class="brand-dot">/</span></span></a><div class="network"><span class="live-dot"></span> SOLANA <b>MAINNET</b></div><nav>${[
      ["Explore", "compass"],
      ["Watchlist", "bookmark"],
      ["Portfolio", "chart-pie"],
      ["Integrations", "plug-zap"],
    ]
      .map(
        ([n, i]) =>
          `<button title="${n}" class="nav-item ${page === n ? "active" : ""}" data-page="${n}">${I(i)}<span>${n}</span>${n === "Watchlist" ? `<small>${watchlist.length}</small>` : ""}</button>`,
      )
      .join(
        "",
      )}<button class="nav-item" data-launch title="Launch a coin">${I("circle-plus")}<span>Launch a coin</span>${I("arrow-up-right")}</button></nav><div class="sidebar-note"><span class="little-egg">${I("egg")}</span><h3>Small beginnings.<br>Big yeet energy.</h3><p>Your next idea belongs here.</p><button data-launch>Build your nest ${I("arrow-up-right")}</button></div><div class="sidebar-bottom"><span>Independent. Non-custodial.</span><button id="help">About YeetNest ${I("arrow-up-right")}</button><span>© 2026 YeetNest</span></div></aside><main><header><div class="breadcrumb">The nest <span>/</span> <b>${page}</b></div><div class="header-right"><div class="mode-switch" aria-label="Trading environment"><button data-mode="demo" class="${mode === "demo" ? "active" : ""}">Demo</button><button data-mode="live" class="${mode === "live" ? "active" : ""}"><span class="live-dot"></span> Live</button></div><button class="wallet" id="wallet">${I("wallet")} ${connected() ? (mode === "demo" ? `${demoBalance.toFixed(2)} SOL · Demo` : esc(short(address))) : "Connect wallet"}</button></div></header><div class="content">${
      page === "Integrations"
        ? integrations()
        : `
  <div class="heading"><div><div class="eyebrow"><span class="live-dot"></span> ${mode === "demo" ? "DEMO NEST / SAMPLE MARKET" : "LIVE NEST / SOLANA MAINNET"}</div><h1>${page === "Explore" ? "Where memes take flight." : page === "Watchlist" ? "On your radar." : "Your nest egg."}</h1><p>${page === "Explore" ? "Find your flock. Hatch a coin. Make your move." : page === "Watchlist" ? "The coins you are keeping close." : mode === "live" ? "On-chain balances from your connected wallet." : "Your demo positions, all in one place."}</p></div><button class="primary" data-launch>${I("plus")} Launch a coin ${I("arrow-up-right")}</button></div>
  <section class="stats">${[
    [
      "Listed 24h volume",
      money(volume),
      mode === "demo" ? "Sample data" : "Loaded assets only",
      "chart-no-axes-combined",
    ],
    [
      "Coins in the nest",
      String(coins.length),
      mode === "demo" ? "Demo catalogue" : "Jupiter + YeetNest launches",
      "egg",
    ],
    [
      "Your SOL balance",
      mode === "demo"
        ? demoBalance.toFixed(2)
        : solBalance == null
          ? "--"
          : solBalance.toFixed(4),
      mode === "demo" ? "Simulated balance" : "Confirmed on-chain",
      "wallet",
    ],
    [
      "Your positions",
      String((mode === "demo" ? positions : liveHoldings).length),
      mode === "demo" ? "Demo holdings" : "SPL + Token-2022",
      "layers",
    ],
  ]
    .map(
      ([a, b, c, d]) =>
        `<div class="stat"><div>${a}${I(d)}</div><strong>${b}</strong><span>${c}</span></div>`,
    )
    .join("")}</section>
  ${page === "Explore" ? `<section class="feature"><div class="feature-copy"><span class="label">${mode === "demo" ? "FROM THE NEST" : "MARKET SPOTLIGHT"}</span><h2>${spotlight ? esc(spotlight.name) : "Ready for takeoff."}</h2><p>${mode === "demo" ? "One small meme. A whole new flock." : spotlight ? `${esc(spotlight.source)} · ${spotlight.verified ? "Verified token" : "Check the mint address"}` : "Explore on-chain coins or hatch your own."}</p><button id="spotlight">${spotlight ? `Explore $${esc(spotlight.ticker)}` : "Explore live coins"} ${I("arrow-up-right")}</button></div><div class="feature-art">${spotlight ? art(spotlight) : `<div class="empty-art">${I("egg")}</div>`}<span class="floating-tag tag-one">${I("feather")} JUST HATCHED</span><span class="floating-tag tag-two">${spotlight?.change != null ? `${spotlight.change > 0 ? "+" : ""}${spotlight.change.toFixed(2)}%` : "YEETNEST"} ${I("arrow-up-right")}</span></div><div class="feature-market"><span class="label">${spotlight?.cap != null ? "MARKET CAP" : "YOUR NEXT LAUNCH"}</span><strong>${spotlight?.cap != null ? money(spotlight.cap) : "Starts here."}</strong><p>${mode === "demo" ? "Sample market" : "Provider market data"}</p><div class="nest-lines">${I("bird")}${I("move-up-right")}</div><span class="paired">${spotlight?.mint ? `<a href="https://solscan.io/token/${esc(spotlight.mint)}" target="_blank" rel="noopener noreferrer">${esc(short(spotlight.mint))} ${I("external-link")}</a>` : "Hatch something worth watching."}</span></div></section>` : ""}
<section class="market"><div class="market-heading"><h2>${page === "Explore" ? "Fresh from the nest" : page}</h2><span class="live-label"><span class="live-dot"></span> ${mode === "demo" ? "Sample market" : lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Provider data"}</span><button id="refresh" class="icon-button" title="Refresh market">${I("refresh-cw")}</button></div><div class="tabs">${["Trending", "New pairs", "About to graduate", "Graduated"].map((n) => `<button class="${tab === n ? "selected" : ""}" data-tab="${n}">${I(n === "Trending" ? "flame" : n === "New pairs" ? "sparkles" : n === "About to graduate" ? "graduation-cap" : "badge-check")}${n}</button>`).join("")}<div class="view-switch"><button data-view="grid" title="Grid view" class="${view === "grid" ? "selected" : ""}">${I("layout-grid")}</button><button data-view="list" title="List view" class="${view === "list" ? "selected" : ""}">${I("list")}</button></div></div><div class="filters"><div class="categories">${(mode === "live" ? ["All coins", "YeetNest", "LaunchLab", "Market"] : ["All coins", "Stocks", "Crypto", "Pre-IPO"]).map((n) => `<button data-category="${n}" class="${category === n ? "chosen" : ""}">${n}</button>`).join("")}</div><div class="search-sort"><label class="search">${I("search")}<input id="search" aria-label="Search coins" placeholder="Search coins or mint address" value="${esc(query)}"/></label><label class="sort">${I("arrow-down-wide-narrow")}<select id="sort" aria-label="Sort coins"><option>Trending</option><option>Market cap</option><option>Volume</option><option>Top gainers</option></select></label></div></div>${liveError && mode === "live" ? `<div class="notice error">${I("circle-alert")}<span>${esc(liveError)}</span><button id="retry">Retry</button></div>` : ""}${mode === "live" && page === "Portfolio" && !chain.publicKey ? `<div class="notice">${I("wallet")} Connect a wallet to load your real holdings.</div>` : ""}<div id="coins" class="coins ${view}"></div></section>`
    }<footer><span>${I("feather")} A little chaos. A lot of possibility.</span><span>${mode === "demo" ? "Demo environment" : "Solana · Jupiter · Raydium"} ${I("arrow-up-right")}</span></footer></div></main><div id="modal-root"></div><div id="toast" role="status"></div>`;
  if (page !== "Integrations") {
    document.querySelector("#sort").value = sort;
    drawCoins();
  }
  bind();
  installLaunchpadUI({
    page,
    mode,
    coins: allCoins(),
    demoCreator,
    esc,
    toast,
    modal,
    launch,
    wallet: walletModal,
    openCoin: detail,
    transactionResult,
    reload: refreshStatusAndMarket,
    navigate: (next) => {
      page = next;
      render();
    },
    switchLive: () => {
      if (chain.hostedDemo) {
        toast("Online demo only. The mainnet backend is not deployed yet.");
        return;
      }
      mode = "live";
      render();
      refreshLive();
    },
  });
  installMarketUI({ page, mode, coins: allCoins(), esc, money, image, openCoin: detail, toast, setWatchlist: values => { watchlist = values; render(); }, navigate: next => { page = next; render(); } });
  if (chain.hostedDemo) document.querySelector(".content").insertAdjacentHTML("afterbegin", '<div class="notice">Online demo. Launches, artwork and simulated trades stay in this browser. Mainnet trading is not enabled.</div>');
  createIcons({ icons });
}

const parity = [
  [
    "Wallet + balances",
    "Integrated",
    "Phantom / Solflare; external mainnet verification pending",
  ],
  [
    "Creator artwork",
    "Integrated",
    "Creator uploads; configure Pinata or a public HTTPS upload domain",
  ],
  [
    "Live swaps",
    "Integrated",
    "Jupiter quote, review, wallet signing, execution; funded-wallet test pending",
  ],
  [
    "SOL token launches",
    "Integrated",
    "Raydium standard launch; credentials + funded-wallet test pending",
  ],
  [
    "Curve trades / graduation",
    "Partial",
    "Native SOL curves and registered pool status; full event indexer pending",
  ],
  [
    "Custom quote assets",
    "Unfinished",
    "Stocks, pre-IPO, currencies, leverage, and custom mint configs",
  ],
  [
    "Holder rewards",
    "Unfinished",
    "Token-2022 transfer tax, collection, distribution, receipts",
  ],
  [
    "Creator fee payouts",
    "Integrated",
    "WSOL balance and wallet-reviewed claims; funded claim test pending",
  ],
  [
    "Fee / launch customization",
    "Unfinished",
    "YeetNest platform config, selectable fees, initial buy / bundles",
  ],
  [
    "Buyback / burn flywheel",
    "Unfinished",
    "Platform token, treasury execution, transparent receipts",
  ],
  [
    "Market history + activity",
    "Partial",
    "Live pool metrics, candles and wallet transactions; holder analytics pending",
  ],
  [
    "Production operations",
    "Unfinished",
    "Durable database, image moderation, indexing jobs, deployment hardening",
  ],
];
function integrations() {
  return `<div class="heading"><div><div class="eyebrow">CONNECTED INFRASTRUCTURE</div><h1>The foundations of the nest.</h1><p>Provider status and feature availability.</p></div><button class="primary" id="check-status">${I("refresh-cw")} Check status</button></div><div class="provider-grid">${[
    [
      "Jupiter",
      "Swaps + token discovery",
      config?.jupiter === "configured"
        ? "API key configured"
        : "Keyless access · rate limited",
      "https://developers.jup.ag",
    ],
    [
      "Raydium",
      "SOL LaunchLab launches + curve trades",
      "Official SDK · wallet signature required",
      "https://docs.raydium.io",
    ],
    [
      "Solana",
      "Balances + transaction confirmation",
      config?.rpc === "configured"
        ? "Custom RPC configured"
        : "Public mainnet RPC · rate limited",
      "https://solana.com/docs",
    ],
    [
      "Pinata",
      "Public images + launch metadata",
      config?.uploads
        ? "Upload credentials configured"
        : "Server upload credentials needed",
      "https://docs.pinata.cloud",
    ],
  ]
    .map(
      ([name, description, status, url]) =>
        `<article class="provider"><span class="provider-icon">${I(name === "Pinata" ? "image" : name === "Solana" ? "layers" : "orbit")}</span><h2>${name}</h2><p>${description}</p><span class="provider-status">${status}</span><a href="${url}" target="_blank" rel="noopener noreferrer">Documentation ${I("arrow-up-right")}</a></article>`,
    )
    .join(
      "",
    )}</div><section class="parity"><h2>StonkFun feature parity</h2><p>Reference access is incomplete. These gaps are based on published launch documentation, not a full audit of StonkFun.</p><div class="table-wrap"><table><thead><tr><th>Feature</th><th>YeetNest status</th><th>Remaining work</th></tr></thead><tbody>${parity.map(([a, b, c]) => `<tr><td>${a}</td><td><span class="status-pill ${b === "Unfinished" ? "pending" : ""}">${b}</span></td><td>${c}</td></tr>`).join("")}</tbody></table></div><a class="source-link" href="https://docs.sumo.trade/launch-tokens/stonkfun-launch" target="_blank" rel="noopener noreferrer">Published StonkFun launch documentation ${I("external-link")}</a></section>`;
}
let discoveryPage = 0;
function drawCoins() {
  const container = document.querySelector("#coins");
  if (!container) return;
  const matches = filtered();
  const pages = Math.max(1, Math.ceil(matches.length / 24));
  discoveryPage = Math.min(discoveryPage, pages - 1);
  container.innerHTML =
    matches.slice(discoveryPage * 24, (discoveryPage + 1) * 24)
      .map((t) => {
        const holding = (mode === "demo" ? positions : liveHoldings).find(
          (p) => String(p.id || p.mint) === String(t.id),
        );
        return `<article class="coin" data-coin="${esc(t.id)}" tabindex="0" aria-label="Open ${esc(t.name)}"><div class="coin-top">${art(t)}<div class="coin-title"><h3 title="${esc(t.name)}">${esc(t.name)}</h3><span>$${esc(t.ticker)} <span class="age">${mode === "demo" ? "Demo" : t.verified ? "Verified" : "Live"}</span></span></div><button class="save ${watchlist.includes(String(t.id)) ? "saved" : ""}" data-save="${esc(t.id)}" title="${watchlist.includes(String(t.id)) ? "Remove from" : "Add to"} watchlist">${I("bookmark")}</button></div><div class="pair-row"><span class="pair">${t.poolId ? "LAUNCHLAB" : esc(t.pair)}</span><span class="change ${t.change < 0 ? "negative" : ""}">${t.change == null ? "--" : `${t.change > 0 ? "+" : ""}${t.change.toFixed(2)}%`}${I(t.change < 0 ? "trending-down" : "trending-up")}</span></div><div class="coin-numbers"><div><span>Market cap</span><b>${money(t.cap)}</b></div><div><span>24h volume</span><b>${money(t.volume)}</b></div></div>${page === "Portfolio" && holding ? `<div class="holding">${mode === "demo" ? `${holding.amount.toFixed(4)} SOL allocated` : `${esc(fromUnits(holding.amount, holding.decimals))} ${esc(t.ticker)}`}</div>` : `<div class="curve-label"><span>${t.progress == null ? esc(t.source || "Sample") : "Bonding curve"}</span><b>${t.progress == null ? I("arrow-up-right") : `${t.progress.toFixed(0)}%`}</b></div>${t.progress != null ? `<div class="progress"><span style="width:${Math.min(t.progress, 100)}%"></span></div>` : ""}`}</article>`;
      })
      .join("") ||
    `<div class="empty">${I(loading ? "loader-circle" : "egg")}<h3>${loading ? "Loading the nest..." : page === "Portfolio" ? "Your nest is waiting." : "Nothing in this nest yet."}</h3><p>${loading ? "Fetching provider data." : mode === "live" && tab !== "Trending" && tab !== "New pairs" ? "Graduation filters cover registered YeetNest LaunchLab coins only." : "Try another search, or hatch something new."}</p></div>`;
  document.querySelectorAll("[data-coin]").forEach((el) => {
    el.onclick = () => detail(el.dataset.coin);
    el.onkeydown = (e) => {
      if (e.key === "Enter") detail(el.dataset.coin);
    };
  });
  document.querySelector('#discovery-pagination')?.remove();
  container.insertAdjacentHTML('afterend', `<div id="discovery-pagination" class="discovery-pagination"><button class="icon-button" id="previous-coins" title="Previous page" ${discoveryPage === 0 ? 'disabled' : ''}>${I('chevron-left')}</button><span>${discoveryPage + 1} / ${pages}${mode === 'live' && liveIndexHasMore ? '+' : ''}</span><button class="icon-button" id="next-coins" title="Next page" ${loading || (discoveryPage + 1 >= pages && !(mode === 'live' && liveIndexHasMore)) ? 'disabled' : ''}>${I('chevron-right')}</button></div>`);
  document.querySelector('#previous-coins').onclick = () => { discoveryPage--; drawCoins(); };
  document.querySelector('#next-coins').onclick = async () => {
    if (mode === 'live' && discoveryPage + 1 >= pages && liveIndexHasMore) await loadMoreIndexed();
    if (discoveryPage + 1 < Math.ceil(filtered().length / 24)) discoveryPage++;
    drawCoins();
  };
  document.querySelectorAll("[data-save]").forEach((el) => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const id = el.dataset.save;
      if (mode === 'live') {
        el.disabled = true;
        try {
          await chain.authenticate();
          const prior = await chain.api('/watchlist');
          const next = prior.includes(id) ? prior.filter(mint => mint !== id) : [...prior, id];
          watchlist = await chain.api('/watchlist', { method: 'PUT', body: JSON.stringify({ mints: next }) });
          render();
        } catch(error) { toast(error.message); }
        finally { el.disabled = false; }
        return;
      }
      watchlist = watchlist.includes(id)
        ? watchlist.filter((x) => x !== id)
        : [...watchlist, id];
      persist();
      drawCoins();
      const count = document.querySelector('[data-page="Watchlist"] small');
      if (count) count.textContent = watchlist.length;
    };
    el.onkeydown = (e) => e.stopPropagation();
  });
  createIcons({ icons });
}

function bind() {
  document.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        if (chain.hostedDemo && b.dataset.mode === "live") {
          toast("Online demo only. The mainnet backend is not deployed yet.");
          return;
        }
        page = b.dataset.page;
        query = "";
        tab = "Trending";
        category = "All coins";
        render();
        if (mode === "live" && page === "Portfolio") refreshHoldings();
      }),
  );
  document
    .querySelectorAll("[data-launch]")
    .forEach((b) => (b.onclick = launch));
  document.querySelectorAll("[data-mode]").forEach(
    (b) =>
      (b.onclick = () => {
        if (mode === b.dataset.mode) return;
        mode = b.dataset.mode;
        watchlist = mode === 'demo' ? read('yn-watchlist', []).map(String) : [];
        query = "";
        tab = "Trending";
        category = "All coins";
        render();
        if (mode === "live") {
          refreshLive();
          if (chain.publicKey) refreshHoldings();
        }
      }),
  );
  document.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        render();
      }),
  );
  document.querySelectorAll("[data-category]").forEach(
    (b) =>
      (b.onclick = () => {
        category = b.dataset.category;
        render();
      }),
  );
  document.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        view = b.dataset.view;
        render();
      }),
  );
  const search = document.querySelector("#search");
  if (search)
    search.oninput = (e) => {
      query = e.target.value;
      drawCoins();
      clearTimeout(searchTimer);
      if (mode === "live") searchTimer = setTimeout(refreshLive, 800);
    };
  const sorting = document.querySelector("#sort");
  if (sorting)
    sorting.onchange = (e) => {
      sort = e.target.value;
      drawCoins();
    };
  document.querySelector("#wallet").onclick = walletModal;
  document.querySelector("#help").onclick = () =>
    modal(
      `<span class="eyebrow">HELLO, YEETNEST</span><h2>A home for your next meme.</h2><p>Demo coins and balances stay in this browser. Live transactions use Solana mainnet and require your wallet signature. Creator image updates change the YeetNest listing; the original on-chain metadata remains unchanged.</p><button class="primary full" id="see-integrations">View integrations</button>`,
      () => {
        document.querySelector("#see-integrations").onclick = () => {
          page = "Integrations";
          render();
        };
      },
    );
  const spotlight = document.querySelector("#spotlight");
  if (spotlight)
    spotlight.onclick = () => {
      if (allCoins()[0]) detail(String(allCoins()[0].id));
      else refreshLive();
    };
  for (const id of ["refresh", "retry", "check-status"]) {
    const b = document.querySelector(`#${id}`);
    if (b)
      b.onclick = () =>
        mode === "live" || page === "Integrations"
          ? refreshStatusAndMarket()
          : toast("Demo market refreshed.");
  }
}
async function loadStatus() {
  try {
    config = await chain.api("/status");
  } catch (e) {
    toast(e.message);
  }
}
async function refreshStatusAndMarket() {
  await loadStatus();
  if (mode === "live") await refreshLive();
  else render();
}
let liveRequest = 0;
let liveIndexOffset = 0, liveIndexHasMore = false;
async function loadMoreIndexed() {
  const expectedQuery = query, expectedRequest = liveRequest;
  loading = true;
  drawCoins();
  try {
    const result = await chain.api(`/launches/indexed?query=${encodeURIComponent(expectedQuery)}&offset=${liveIndexOffset}&limit=100`);
    if (query !== expectedQuery || liveRequest !== expectedRequest || mode !== 'live') return;
    const merged = new Map(liveCoins.map(coin => [coin.mint, coin]));
    for (const coin of result.coins || []) merged.set(coin.mint, { ...merged.get(coin.mint), ...coin });
    liveCoins = [...merged.values()];
    liveIndexOffset += (result.coins || []).length;
    liveIndexHasMore = Boolean(result.hasMore);
  } catch (error) { toast(error.message); }
  finally { if (liveRequest === expectedRequest) loading = false; }
}
async function refreshLive(background = false) {
  if (background && loading) return;
  const request = ++liveRequest,
    requestedQuery = query;
  loading = true;
  liveError = "";
  if (!background) drawCoins();
  const results = await Promise.allSettled([
    chain.api(`/tokens?query=${encodeURIComponent(requestedQuery)}`),
    chain.api("/launches"),
    chain.api(`/launches/indexed?query=${encodeURIComponent(requestedQuery)}&limit=100`),
  ]);
  if (request !== liveRequest) return;
  if (requestedQuery !== query) {
    loading = false;
    refreshLive();
    return;
  }
  const remote =
    results[0].status === "fulfilled" && Array.isArray(results[0].value)
      ? results[0].value.map(tokenFromApi)
      : [];
  const registered = results[1].status === "fulfilled" ? results[1].value : [];
  liveIndexOffset = results[2].status === 'fulfilled' ? (results[2].value.coins || []).length : 0;
  liveIndexHasMore = results[2].status === 'fulfilled' && Boolean(results[2].value.hasMore);
  const merged = new Map(remote.map((c) => [c.mint, c]));
  if (results[2].status === 'fulfilled') for (const c of results[2].value.coins || []) merged.set(c.mint, { ...merged.get(c.mint), ...c });
  for (const c of registered)
    merged.set(c.mint, { ...merged.get(c.mint), ...c });
  for (const holding of liveHoldings)
    if (!merged.has(holding.mint))
      merged.set(
        holding.mint,
        liveCoins.find((c) => c.mint === holding.mint) || {
          id: holding.mint,
          mint: holding.mint,
          name: short(holding.mint),
          ticker: "TOKEN",
          pair: "SOL",
          decimals: holding.decimals,
          source: "Wallet holding",
        },
      );
  liveCoins = [...merged.values()];
  liveError = results.filter(result => result.status === 'rejected').map(result => result.reason.message).join(' ');
  if (results[2].status === 'fulfilled' && results[2].value.indexerError) liveError += ' LaunchLab indexing is paused at a provider error; indexed history is incomplete.';
  loading = false;
  lastUpdated = results[0].status === "fulfilled" ? Date.now() : lastUpdated;
  if (mode === "live" && !document.querySelector(".overlay")) {
    if (background) drawCoins();
    else render();
  }
}
async function refreshHoldings() {
  const epoch = walletEpoch,
    address = chain.publicKey?.toBase58();
  if (!address) return;
  try {
    const result = await chain.balances();
    if (walletEpoch !== epoch || chain.publicKey?.toBase58() !== address)
      return;
    solBalance = result.sol;
    liveHoldings = result.tokens;
    for (const holding of liveHoldings)
      if (!liveCoins.some((c) => c.mint === holding.mint))
        liveCoins.push({
          id: holding.mint,
          mint: holding.mint,
          name: short(holding.mint),
          ticker: "TOKEN",
          pair: "SOL",
          decimals: holding.decimals,
          source: "Wallet holding",
          description:
            "Metadata is not loaded. Verify the full mint address before trading.",
        });
    if (mode === "live" && !document.querySelector(".overlay")) render();
  } catch (e) {
    if (walletEpoch === epoch) {
      solBalance = null;
      liveHoldings = [];
      toast(`Balance unavailable: ${e.message}`);
    }
  }
}
function modal(content, setup = () => {}) {
  document.querySelector("#modal-root").innerHTML =
    `<div class="overlay"><section class="modal" role="dialog" aria-modal="true"><button class="close" title="Close">${I("x")}</button>${content}</section></div>`;
  document.querySelector(".close").onclick = closeModal;
  document.querySelector(".overlay").onclick = (e) => {
    if (e.target.classList.contains("overlay")) closeModal();
  };
  createIcons({ icons });
  setup();
  document.querySelector(".modal input, .modal button:not(.close)")?.focus();
}
function closeModal() {
  cleanupMarket();
  document.querySelector("#modal-root").innerHTML = "";
}
function toast(message) {
  const e = document.querySelector("#toast");
  e.textContent = message;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 5000);
}
function inlineError(error) {
  const node = document.querySelector("#form-error");
  if (node) node.textContent = error.message || String(error);
  else toast(error.message || String(error));
}
function walletModal() {
  if (connected()) {
    modal(
      `<span class="eyebrow">${mode === "demo" ? "DEMO WALLET" : "LIVE WALLET"}</span><h2>Your nest egg.</h2><p class="address">${mode === "demo" ? "Local demo wallet" : esc(chain.publicKey.toBase58())}</p><div class="wallet-balance">${mode === "demo" ? demoBalance.toFixed(4) : solBalance == null ? "--" : solBalance.toFixed(4)} <span>SOL</span></div><button class="secondary full" id="disconnect">Disconnect</button>`,
      () => {
        document.querySelector("#disconnect").onclick = async () => {
          if (mode === "demo") demoWallet = false;
          else {
            walletEpoch++;
            await chain.disconnectWallet();
            solBalance = null;
            liveHoldings = [];
          }
          render();
        };
      },
    );
    return;
  }
  modal(
    `<span class="eyebrow">JOIN THE FLOCK</span><h2>Connect your wallet</h2><p>${mode === "demo" ? "Demo mode uses local funds." : "Solana mainnet. Your keys stay in your wallet."}</p>${mode === "demo" ? `<button class="wallet-option" id="demo">${I("flask-conical")} Demo wallet <span>${demoBalance.toFixed(2)} SOL</span></button>` : ["Phantom", "Solflare"].map((n) => `<button class="wallet-option" data-wallet="${n}">${I(n === "Phantom" ? "ghost" : "sun")} ${n} ${I("arrow-up-right")}</button>`).join("")}<p class="form-error" id="form-error" role="alert"></p>`,
    () => {
      const demo = document.querySelector("#demo");
      if (demo)
        demo.onclick = () => {
          demoWallet = true;
          render();
          toast("Demo wallet connected.");
        };
      if (mode === 'live') {
        document.querySelector('#form-error').insertAdjacentHTML('beforebegin', `<button class="wallet-option" data-wallet="Solflare Web">${I('external-link')} Solflare Web ${I('arrow-up-right')}</button><button class="wallet-option" data-phone-wallet="Phantom">${I('smartphone')} Phantom on phone ${I('arrow-up-right')}</button><button class="wallet-option" data-phone-wallet="Solflare">${I('smartphone')} Solflare on phone ${I('arrow-up-right')}</button><div id="phone-wallet"></div>`);
        document.querySelectorAll('[data-phone-wallet]').forEach(button => button.onclick = async () => {
          const root = document.querySelector('#phone-wallet');
          const error = document.querySelector('#form-error');
          error.textContent = '';
          button.disabled = true;
          try {
            const link = walletBrowseLink(button.dataset.phoneWallet, location.href);
            const QRCode = await import('qrcode');
            const image = await QRCode.default.toDataURL(link, { width: 224, margin: 2, errorCorrectionLevel: 'M' });
            if (!root.isConnected) return;
            root.innerHTML = `<h3>${esc(button.dataset.phoneWallet)} on phone</h3><span class="status-pill">Phone session</span><img class="wallet-qr" src="${image}" alt="Open YeetNest in ${esc(button.dataset.phoneWallet)} on your phone"/><a class="source-link" href="${esc(link)}" rel="noopener noreferrer">Open ${esc(button.dataset.phoneWallet)} ${I('arrow-up-right')}</a>`;
            createIcons({ icons });
          } catch(e) { if (root.isConnected) error.textContent = e.message; }
          finally { button.disabled = false; }
        });
        createIcons({ icons });
      }
      document.querySelectorAll("[data-wallet]").forEach(
        (b) =>
          (b.onclick = async () => {
            const originalLabel = b.innerHTML;
            const walletButtons = [...document.querySelectorAll('[data-wallet]')];
            walletButtons.forEach(button => { button.disabled = true; });
            b.textContent = `Waiting for ${b.dataset.wallet}...`;
            document.querySelector('#wallet-help')?.remove();
            document.querySelector('#form-error').textContent = '';
            try {
              await chain.connectWallet(b.dataset.wallet);
              if (!b.isConnected) { await chain.disconnectWallet(); return; }
              watchlist = [];
              walletEpoch++;
              const provider = chain.provider;
              provider.on?.("accountChanged", async () => {
                if (chain.provider !== provider) return;
                walletEpoch++;
                solBalance = null;
                liveHoldings = [];
                watchlist = [];
                await chain.disconnectWallet();
                if (mode === "live") render();
                toast("Wallet account changed. Reconnect to continue.");
              });
              provider.on?.("disconnect", () => {
                if (chain.provider !== provider) return;
                walletEpoch++;
                solBalance = null;
                liveHoldings = [];
                watchlist = [];
                if (chain.provider === provider)
                  chain.disconnectWallet().catch(() => {});
                if (mode === "live") render();
              });
              render();
              refreshHoldings();
            } catch (e) {
              if (!b.isConnected) return;
              inlineError(e);
              if (e.code === 'WALLET_UNAVAILABLE') {
                document.querySelector('#wallet-help')?.remove();
                const link = document.createElement('a');
                link.id = 'wallet-help';
                link.className = 'source-link';
                link.href = e.wallet === 'Phantom' ? 'https://phantom.com/download' : 'https://solflare.com/download';
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = `Get ${e.wallet}`;
                document.querySelector('#form-error').after(link);
              }
            } finally {
              if (b.isConnected) b.innerHTML = originalLabel;
              walletButtons.forEach(button => { if (button.isConnected) button.disabled = false; });
            }
          }),
      );
    },
  );
}
async function normalizeImage(file) {
  if (
    !file ||
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)
  )
    throw new Error("Choose a PNG, JPEG, WebP, or GIF image.");
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Choose an image under 5 MB.");
  const bitmap = await createImageBitmap(file);
  if (
    !bitmap.width ||
    !bitmap.height ||
    bitmap.width * bitmap.height > 40000000
  ) {
    bitmap.close();
    throw new Error("Image dimensions are too large.");
  }
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const result = canvas.toDataURL("image/png");
  if (result.length > 2800000)
    throw new Error("Image is too large after conversion.");
  return result;
}
function launch() {
  let uploaded = "";
  let uploadedMetadata = null, uploadedMetadataKey = '';
  modal(
    `<span class="eyebrow">${mode === "demo" ? "DEMO LAUNCH" : "RAYDIUM / MAINNET"}</span><h2>Hatch your coin.</h2><form id="launch-form"><label class="upload-control"><span class="upload-preview" id="upload-preview">${I("image-plus")}</span><span>Coin artwork<small>PNG, JPEG, WebP, GIF · up to 5 MB</small></span><input id="coin-image" name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" ${mode === "live" ? "required" : ""}/></label><div class="form-row"><label>Coin name<input name="name" required maxlength="32" placeholder="Your next big idea"/></label><label>Ticker<input name="ticker" required maxlength="10" pattern="[A-Za-z0-9]+" placeholder="YEET"/></label></div><label>Description<textarea name="description" maxlength="500" placeholder="Give your flock a story."></textarea></label>${mode === "demo" ? `<div class="form-row"><label>Quote asset<select name="pair"><option>SOL</option><option>USDC</option><option>NVDAx</option><option>SPYx</option><option>TSLAx</option><option>QQQx</option><option>OPENAI</option><option>ANTHROPIC</option></select></label><label>Launch type<select name="launchMode"><option>Standard</option></select></label></div><p class="fine">Local demo launch. No on-chain token is created.</p>` : `<div class="launch-terms"><span>Quote asset <b>SOL</b></span><span>Launch mode <b>Standard</b></span><span>Migration <b>Raydium CPMM</b></span><span>Initial buy <b>None</b></span></div><p class="fine">Public IPFS artwork and metadata. Raydium default economics apply. Network fees are paid by your wallet.</p>${!config?.uploads ? `<div class="notice">${I("key-round")} Configure server PINATA_JWT to enable public uploads.</div>` : ""}`}<p class="form-error" id="form-error" role="alert"></p><button class="primary full" type="submit">${I("egg")} ${mode === "demo" ? "Hatch demo coin" : "Prepare live launch"}</button></form>`,
    () => {
      document.querySelector("#coin-image").onchange = async (e) => {
        try {
          uploaded = await normalizeImage(e.target.files[0]);
          document.querySelector("#upload-preview").innerHTML =
            `<img src="${uploaded}" alt="Coin artwork preview"/>`;
        } catch (error) {
          uploaded = "";
          e.target.value = "";
          inlineError(error);
        }
      };
      document
        .querySelector("#launch-form [name=description]")
        .closest("label")
        .insertAdjacentHTML(
          "afterend",
          `<details class="social-fields"><summary>Social links</summary><label>Website<input name="website" type="url" placeholder="https://your-project.com" pattern="https://.*"/></label><label>X profile<input name="twitter" type="url" placeholder="https://x.com/your-project" pattern="https://(x[.]com|twitter[.]com)/.*"/></label><label>Telegram<input name="telegram" type="url" placeholder="https://t.me/your-project" pattern="https://t[.]me/.*"/></label></details>`,
        );
      const uploadNotice = document.querySelector("#launch-form .notice");
      if (uploadNotice) uploadNotice.textContent = "Configure Pinata or a public upload domain in Integrations.";
      const termsNote = document.querySelector("#launch-form .launch-terms + .fine");
      if (termsNote) termsNote.textContent = "Public artwork and metadata. Raydium default economics apply. Network fees are paid by your wallet.";
      document.querySelector("#launch-form").onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target,
          button = form.querySelector("[type=submit]"),
          d = Object.fromEntries(new FormData(form));
        if (button.disabled) return;
        button.disabled = true;
        try {
          if (mode === "demo") {
            const coin = {
              id: Date.now(),
              name: d.name.trim(),
              ticker: d.ticker.toUpperCase(),
              description: d.description.trim(),
              socials: Object.fromEntries(["website", "twitter", "telegram"].filter(key => d[key]).map(key => [key, d[key]])),
              pair: d.pair,
              cap: 1000,
              volume: 0,
              change: 0,
              progress: 0,
              art: d.ticker,
              image: uploaded,
              creator: demoCreator,
              created: Date.now(),
            };
            demoCoins.unshift(coin);
            try {
              persist();
            } catch {
              demoCoins.shift();
              throw new Error("Browser storage is full. Try a smaller image.");
            }
            query = "";
            tab = "New pairs";
            category = "All coins";
            page = "Explore";
            render();
            toast(`$${coin.ticker} hatched in demo mode.`);
          } else {
            if (!chain.publicKey)
              throw new Error(
                "Connect a live wallet before preparing the launch.",
              );
            if (!uploaded) throw new Error("Upload your coin artwork first.");
            if (!config?.uploads)
              throw new Error(
                "Configure Pinata or a public HTTPS upload domain in Integrations.",
              );
            const owner = chain.publicKey.toBase58();
            button.textContent = "Waiting for wallet sign-in...";
            await chain.authenticate();
            if (!form.isConnected) return;
            const fields = {
              name: d.name, ticker: d.ticker.toUpperCase(), description: d.description,
              image: uploaded, website: d.website, twitter: d.twitter, telegram: d.telegram,
            };
            const metadataKey = JSON.stringify({ owner, ...fields });
            button.textContent = "Uploading artwork and metadata...";
            if (!uploadedMetadata || uploadedMetadataKey !== metadataKey) {
              uploadedMetadata = await chain.api("/metadata", {
              method: "POST",
              body: JSON.stringify(fields),
            });
              uploadedMetadataKey = metadataKey;
            }
            const metadata = uploadedMetadata;
            if (!form.isConnected) return;
            button.textContent = "Building and simulating launch...";
            let activePreparation = true, prepared;
            try { prepared = await withTimeout(() => chain.prepareLaunch({
              name: d.name,
              ticker: d.ticker.toUpperCase(),
              uri: metadata.uri,
              onProgress: message => {
                if (!activePreparation || !form.isConnected) throw new Error('Launch preparation was cancelled.');
                button.textContent = message;
              },
            }), 90000, 'Launch preparation timed out while loading or simulating through RPC/Raydium. No launch transaction was submitted. Check provider connections; completed metadata is retained for retry.'); }
            finally { activePreparation = false; }
            if (!form.isConnected) return;
            if (chain.publicKey?.toBase58() !== owner) throw new Error('Wallet changed. Prepare the launch again.');
            reviewLaunch(prepared, metadata, d);
          }
        } catch (error) {
          if (!form.isConnected) return;
          inlineError(error);
          button.disabled = false;
          button.textContent =
            mode === "demo" ? "Hatch demo coin" : "Prepare live launch";
        }
      };
    },
  );
}
function reviewLaunch(prepared, metadata, d) {
  modal(
    `<span class="eyebrow">LIVE LAUNCH / REVIEW</span><h2>Ready to leave the nest?</h2><div class="detail-heading"><img src="${esc(metadata.image)}" alt="${esc(d.name)}"/><div><h3>${esc(d.name)}</h3><span>$${esc(d.ticker.toUpperCase())}</span></div></div><div class="launch-terms"><span>Network <b>Solana mainnet</b></span><span>Supply <b>${prepared.supply}</b></span><span>Transactions <b>${prepared.transactions}</b></span><span>Initial buy <b>None</b></span></div><p class="address">Mint: ${esc(prepared.mint)}</p><p class="fine">Review transactions and network fees in your wallet. Raydium's default platform economics apply. Wallet confirmation submits a real token launch.</p><p class="form-error" id="form-error"></p><button class="primary full" id="sign-launch">${I("pen-line")} Sign and launch</button>`,
    () => {
      document.querySelector("#sign-launch").onclick = async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = "Awaiting wallet and confirmation...";
        let signatures;
        try {
          const record = {
            mint: prepared.mint,
            poolId: prepared.poolId,
            uri: metadata.uri,
          };
            localStorage.setItem(
            "yn-pending-registration",
              JSON.stringify({ ...record, wallet: chain.publicKey.toBase58() }),
          );
            signatures = await prepared.execute();
          await chain.api("/coins", {
            method: "POST",
            body: JSON.stringify(record),
          });
            localStorage.removeItem("yn-pending-registration");
          transactionResult(
            "Your coin has hatched.",
            signatures[0],
            prepared.mint,
          );
          refreshLive();
        } catch (error) {
          inlineError(
            new Error(
              signatures
                ? `Launch submitted, listing registration failed: ${error.message}. Retry registration below; do not launch again.`
                : `${error.message} Check wallet activity before preparing another launch.`,
            ),
          );
          if (signatures) {
            b.disabled = false;
            b.textContent = "Retry registration";
            b.onclick = async () => {
              b.disabled = true;
              try {
                  await chain.authenticate();
                await chain.api("/coins", {
                  method: "POST",
                    body: localStorage.getItem("yn-pending-registration"),
                });
                  localStorage.removeItem("yn-pending-registration");
                transactionResult(
                  "Coin registered.",
                  signatures[0],
                  prepared.mint,
                );
                refreshLive();
              } catch (err) {
                inlineError(err);
                b.disabled = false;
              }
            };
          }
        }
      };
    },
  );
}
function detail(id) {
  const coin = allCoins().find((c) => String(c.id) === id);
  if (!coin) return;
  const owns =
    mode === "demo"
      ? coin.creator === demoCreator
      : coin.creator && coin.creator === chain.publicKey?.toBase58();
  let side = "Buy";
  modal(
    `<div class="detail-heading">${art(coin)}<div><span class="eyebrow">${mode === "demo" ? "DEMO COIN" : esc(coin.source || "SOLANA")} / ${esc(coin.pair)}</span><h2>${esc(coin.name)}</h2><span class="muted">$${esc(coin.ticker)}</span></div>${owns ? `<button class="icon-button" id="edit-art" title="Change coin artwork">${I("image-plus")}</button>` : ""}</div><p class="coin-description">${esc(coin.description || "Welcome to the nest.")}</p>${coin.mint ? `<a class="mint-address" href="https://solscan.io/token/${esc(coin.mint)}" target="_blank" rel="noopener noreferrer">${esc(coin.mint)} ${I("external-link")}</a>` : ""}<div class="detail-stats"><span>Market cap<b>${money(coin.cap)}</b></span><span>24h change<b class="change ${coin.change < 0 ? "negative" : ""}">${coin.change == null ? "--" : `${coin.change.toFixed(2)}%`}</b></span><span>Volume<b>${money(coin.volume)}</b></span></div>${coin.progress != null ? `<div class="curve-summary"><span>Bonding curve</span><b>${coin.progress.toFixed(0)}%</b><div class="progress"><span style="width:${coin.progress}%"></span></div></div>` : ""}<form id="trade-form"><div class="trade-tabs"><button type="button" class="selected" data-side="Buy">Buy</button><button type="button" data-side="Sell">Sell</button></div><label id="amount-label"><span>Amount (SOL)</span><input name="amount" inputmode="decimal" placeholder="0.00" required pattern="[0-9]+([.][0-9]+)?"/></label><div class="quick-amounts">${[0.1, 0.5, 1, 2].map((n) => `<button type="button" data-amount="${n}">${n}</button>`).join("")}</div><p class="fine">${mode === "demo" ? "Simulated trade. No funds are transferred." : coin.poolId ? "Raydium bonding curve until graduation; Jupiter routing afterwards." : "Live Jupiter routing. Review the quote before signing."}</p><p class="form-error" id="form-error" role="alert"></p><button class="primary full" type="submit" id="trade-submit">${connected() ? (mode === "demo" ? `Demo buy $${esc(coin.ticker)}` : "Get live quote") : "Connect wallet"}</button></form>`,
    () => {
      if (owns)
        document.querySelector("#edit-art").onclick = () => editArtwork(coin);
      mountDiscussion(coin, { mode, esc, toast });
      const socialLinks = Object.entries(coin.socials || {}).filter(([, url]) =>
        /^https:\/\//.test(url),
      );
      if (socialLinks.length)
        document
          .querySelector(".coin-description")
          .insertAdjacentHTML(
            "afterend",
            `<div class="coin-socials">${socialLinks.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${I("external-link")} ${esc(label)}</a>`).join("")}</div>`,
          );
      if (mode === "live") {
        document.querySelector('#amount-label').insertAdjacentHTML('afterend', '<label>Slippage<select name="slippage"><option value="50">0.5%</option><option value="100" selected>1%</option><option value="200">2%</option><option value="500">5%</option></select></label>');
        document
          .querySelector("#trade-form")
          .insertAdjacentHTML(
            "beforebegin",
            '<section id="live-market" class="live-market"></section>',
          );
        mountMarket(coin, { esc });
        const root = document.querySelector('#live-market');
        root.insertAdjacentHTML('afterend', '<section id="token-evidence" class="live-market"><h3>Recent trades</h3><div id="recent-trades">Loading...</div><h3>Largest token accounts</h3><div id="largest-accounts">Loading...</div></section>');
        const evidence = document.querySelector('#token-evidence');
        chain.api(`/trades/${coin.mint}`).then(result => {
          if (!evidence.isConnected) return;
          evidence.querySelector('#recent-trades').innerHTML = result.trades.map(trade => `<div class="health-check"><div><b>${esc(trade.kind)}</b><span>${esc(trade.block_timestamp || '')}</span></div><a href="https://solscan.io/tx/${esc(trade.tx_hash)}" target="_blank" rel="noopener noreferrer">${esc(String(trade.tx_hash).slice(0, 10))}</a><small>${trade.volume_in_usd ? esc(trade.volume_in_usd) + ' USD' : '--'}</small></div>`).join('') || '<p class="muted">No indexed trades available.</p>';
        }).catch(() => { if (evidence.isConnected) evidence.querySelector('#recent-trades').textContent = 'Recent trade data unavailable.'; });
        chain.api(`/holders/${coin.mint}`).then(result => {
          if (!evidence.isConnected) return;
          evidence.querySelector('#largest-accounts').innerHTML = result.accounts.map(account => `<div class="health-check"><a href="https://solscan.io/account/${esc(account.address)}" target="_blank" rel="noopener noreferrer">${esc(short(account.address))}</a><small>${esc(fromUnits(account.amount, account.decimals))}</small></div>`).join('') || '<p class="muted">No token account data available.</p>';
        }).catch(() => { if (evidence.isConnected) evidence.querySelector('#largest-accounts').textContent = 'Token account data unavailable.'; });
      }
      document
        .querySelectorAll("[data-amount]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              (document.querySelector("[name=amount]").value =
                b.dataset.amount)),
        );
      document.querySelectorAll("[data-side]").forEach(
        (b) =>
          (b.onclick = () => {
            side = b.dataset.side;
            document
              .querySelectorAll("[data-side]")
              .forEach((t) => t.classList.toggle("selected", t === b));
            document.querySelector("#amount-label span").textContent =
              `Amount (${mode === "live" && side === "Sell" ? coin.ticker : "SOL"})`;
            document.querySelector("#trade-submit").textContent = connected()
              ? mode === "demo"
                ? `Demo ${side.toLowerCase()} $${coin.ticker}`
                : "Get live quote"
              : "Connect wallet";
          }),
      );
      document.querySelector("#trade-form").onsubmit = async (e) => {
        e.preventDefault();
        if (!connected()) {
          walletModal();
          return;
        }
        const amount = new FormData(e.target).get("amount"),
          b = document.querySelector("#trade-submit");
        b.disabled = true;
        try {
          if (mode === "demo") {
            const value = Number(amount),
              holding = positions.find((p) => String(p.id) === id);
            if (!Number.isFinite(value) || value <= 0)
              throw new Error("Enter a positive amount.");
            if (side === "Buy" && value > demoBalance)
              throw new Error("Insufficient demo SOL.");
            if (side === "Sell" && (!holding || value > holding.amount))
              throw new Error("Insufficient demo holdings.");
            if (side === "Buy") {
              demoBalance -= value;
              if (holding) holding.amount += value;
              else positions.push({ id: coin.id, amount: value });
            } else {
              demoBalance += value;
              holding.amount -= value;
            }
            positions = positions.filter((p) => p.amount > 0.000000001);
            persist();
            render();
            toast(
              `${side === "Buy" ? "Bought" : "Sold"} ${value} SOL of $${coin.ticker} in demo mode.`,
            );
          } else {
            b.textContent = "Fetching live quote...";
            const prepared = await (coin.poolId
              ? chain.prepareCurveTrade(coin, side, amount, Number(e.target.elements.slippage.value))
              : chain.prepareSwap(coin, side, amount, Number(e.target.elements.slippage.value)));
            reviewTrade(coin, side, amount, prepared);
          }
        } catch (error) {
          inlineError(error);
          b.disabled = false;
          b.textContent =
            mode === "demo" ? "Try demo trade again" : "Get live quote";
        }
      };
    },
  );
}
function reviewTrade(coin, side, amount, quote) {
  modal(
    `<span class="eyebrow">SOLANA MAINNET / LIVE TRADE</span><h2>Review your ${side.toLowerCase()}.</h2><div class="trade-review"><span>You pay <b>${esc(amount)} ${side === "Buy" ? "SOL" : esc(coin.ticker)}</b></span><span>You receive (estimate) <b>${esc(quote.output)} ${esc(quote.outputSymbol)}</b></span><span>Route <b>${esc(quote.route)}</b></span><span>Trading fee <b>${esc(quote.fee)}</b></span><span>Slippage <b>${esc(quote.slippage)}</b></span><span>Wallet <b>${esc(short(chain.publicKey.toBase58()))}</b></span></div><p class="fine">Network fees are additional. Quote expires in 45 seconds. Your wallet shows the final transaction before signing.</p><p class="form-error" id="form-error" role="alert"></p><button class="primary full" id="sign-trade">${I("pen-line")} Sign and submit</button>`,
    () => {
      document.querySelector("#sign-trade").onclick = async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = "Awaiting wallet and confirmation...";
        try {
          const signature = await quote.execute();
          transactionResult("Trade confirmed.", signature, coin.mint);
          refreshHoldings();
        } catch (error) {
          inlineError(error);
          b.textContent = "Quote closed · request a new quote";
        }
      };
      document.querySelector('.trade-review').insertAdjacentHTML('beforeend', `<span>Minimum received <b>${esc(quote.minimum || 'Unavailable')} ${quote.minimum && !quote.minimum.includes('unavailable') ? esc(quote.outputSymbol) : ''}</b></span>${(quote.feeDetails || []).map(([label, amount]) => `<span>${esc(label)} <b>${esc(amount)} SOL</b></span>`).join('')}`);
    },
  );
}
function transactionResult(title, signature, mint) {
  modal(
    `<span class="success-mark">${I("check")}</span><h2>${title}</h2><p>Confirmed on Solana mainnet.</p><a class="primary full" href="https://solscan.io/tx/${esc(signature)}" target="_blank" rel="noopener noreferrer">View transaction ${I("external-link")}</a><a class="secondary full" href="https://solscan.io/token/${esc(mint)}" target="_blank" rel="noopener noreferrer">View token ${I("arrow-up-right")}</a>`,
  );
}
function editArtwork(coin) {
  let uploaded = "";
  modal(
    `<span class="eyebrow">CREATOR STUDIO</span><h2>Give your coin a new look.</h2><form id="image-form"><label class="upload-control"><span class="upload-preview" id="upload-preview">${art(coin)}</span><span>New coin artwork<small>PNG, JPEG, WebP, GIF · up to 5 MB</small></span><input type="file" id="coin-image" accept="image/png,image/jpeg,image/webp,image/gif" required/></label><p class="fine">${mode === "demo" ? "Updates this browser’s demo listing." : "Only your creator wallet can update this YeetNest listing. Original on-chain metadata stays unchanged."}</p><p class="form-error" id="form-error" role="alert"></p><button class="primary full" type="submit">${I("image")} Save artwork</button></form>`,
    () => {
      document.querySelector("#coin-image").onchange = async (e) => {
        try {
          uploaded = await normalizeImage(e.target.files[0]);
          document.querySelector("#upload-preview").innerHTML =
            `<img src="${uploaded}" alt="New artwork"/>`;
        } catch (err) {
          inlineError(err);
          uploaded = "";
          e.target.value = "";
        }
      };
      document.querySelector("#image-form").onsubmit = async (e) => {
        e.preventDefault();
        const b = e.target.querySelector("button");
        b.disabled = true;
        try {
          if (!uploaded) throw new Error("Choose an image first.");
          if (mode === "demo") {
            if (coin.creator !== demoCreator)
              throw new Error("Only the creator can edit this coin.");
            const old = coin.image;
            coin.image = uploaded;
            try {
              persist();
            } catch {
              coin.image = old;
              throw new Error("Browser storage is full. Try a smaller image.");
            }
          } else {
            await chain.authenticate();
            const metadata = await chain.api("/metadata", {
              method: "POST",
              body: JSON.stringify({
                name: coin.name,
                ticker: coin.ticker,
                description: coin.description || "",
                image: uploaded,
              }),
            });
            const result = await chain.api(`/coins/${coin.mint}/image`, {
              method: "PATCH",
              body: JSON.stringify({ uri: metadata.uri }),
            });
            Object.assign(coin, result);
          }
          render();
          toast("Coin artwork updated.");
        } catch (error) {
          inlineError(error);
          b.disabled = false;
        }
      };
    },
  );
}
document.addEventListener(
  "error",
  (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.fallback) return;
    img.dataset.fallback = "true";
    img.title = "Artwork unavailable from the provider";
    img.src = createAvatar(bottts, {
      seed: img.alt || "YeetNest",
      backgroundColor: ["f5bfac"],
    }).toDataUri();
  },
  true,
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});
render();
loadStatus();
setInterval(() => {
  if (
    mode === "live" &&
    !document.hidden &&
    !document.querySelector(".overlay") &&
    !document.querySelector("#search:focus") &&
    ["Explore", "Watchlist"].includes(page)
  )
    refreshLive(true);
}, 60000);
