import { createIcons, icons } from "./ui-icons.js";
import * as chain from "./chain.js";
import { createChart, CandlestickSeries } from "lightweight-charts";

const icon = (name) => `<i data-lucide="${name}"></i>`;
const dollars = (n) =>
  n == null
    ? "--"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: n < 1 ? 8 : 2,
        notation: n > 1e6 ? "compact" : "standard",
      }).format(n);
let disposeChart = () => {};

export function installLaunchpadUI(context) {
  const { page, mode, navigate, esc } = context;
  const nav = document.querySelector("nav");
  const studio = document.createElement("button");
  studio.className = `nav-item ${page === "Creator Studio" ? "active" : ""}`;
  studio.title = "Creator Studio";
  studio.innerHTML = `${icon("palette")}<span>Creator Studio</span>`;
  studio.onclick = () => navigate("Creator Studio");
  nav.insertBefore(studio, nav.lastElementChild);
  if (page === "Integrations") {
    const grid = document.querySelector(".provider-grid");
    grid.insertAdjacentHTML(
      "beforeend",
      [
        [
          "DexScreener",
          "Live pool prices, liquidity, volume",
          "https://docs.dexscreener.com",
        ],
        [
          "GeckoTerminal",
          "Real hourly candlestick history",
          "https://www.geckoterminal.com/dex-api",
        ],
      ]
        .map(
          ([name, description, url]) =>
            `<article class="provider"><span class="provider-icon">${icon("chart-candlestick")}</span><h2>${name}</h2><p>${description}</p><span class="provider-status">Public market data API</span><a href="${url}" target="_blank" rel="noopener noreferrer">Documentation ${icon("arrow-up-right")}</a></article>`,
        )
        .join(""),
    );
    grid.insertAdjacentHTML(
      "afterend",
      `<section class="setup-section"><div class="section-heading"><div><span class="eyebrow">THE ENGINE ROOM</span><h2>Provider setup</h2></div><button class="secondary" id="provider-health">${icon("activity")} Test connections</button></div><div id="provider-checks"></div><div id="setup-form-root"><p class="muted">Checking local setup access...</p></div></section>`,
    );
    setupForm(context);
    document.querySelector("#provider-health").onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const result = await chain.api("/health");
        document.querySelector("#provider-checks").innerHTML = result.checks
          .map(
            (c) =>
              `<div class="health-check ${c.ok ? "healthy" : "unhealthy"}">${icon(c.ok ? "circle-check" : "circle-alert")}<div><b>${esc(c.name)}</b><span>${esc(c.message)}</span></div><small>${c.ok ? "Connected" : "Needs attention"}</small></div>`,
          )
          .join("");
        createIcons({ icons });
      } catch (error) {
        context.toast(error.message);
      } finally {
        b.disabled = false;
      }
    };
  }
  if (page === "Creator Studio") {
    creatorStudio(context);
    if (mode === 'live' && chain.publicKey) {
      const purchases = chain.pendingLaunchPurchases();
      if (purchases.length) {
        document.querySelector('.content').insertAdjacentHTML('beforeend', `<section class="setup-section"><div class="section-heading"><h2>Initial purchases</h2></div>${purchases.map((intent, index) => `<div class="health-check"><div><strong>${esc(intent.ticker)}</strong><span>${esc(intent.amount)} SOL · ${esc(intent.state)}</span></div><button class="secondary" data-resume-purchase="${index}">${icon('refresh-cw')} Review purchase</button></div>`).join('')}</section>`);
        document.querySelectorAll('[data-resume-purchase]').forEach(button => button.onclick = () => reviewInitialPurchase(purchases[Number(button.dataset.resumePurchase)], context));
      }
    }
    let pending;
    try { pending = JSON.parse(localStorage.getItem('yn-pending-registration') || 'null'); } catch { pending = null; }
    if (mode === 'live' && pending?.wallet === chain.publicKey?.toBase58()) {
      document.querySelector('.content').insertAdjacentHTML('beforeend', `<section class="setup-section"><div class="section-heading"><h2>Pending listing</h2><button class="secondary" id="recover-listing">${icon('refresh-cw')} Recover listing</button></div><a href="https://solscan.io/token/${esc(pending.mint)}" target="_blank" rel="noopener noreferrer">${esc(pending.mint)}</a></section>`);
      document.querySelector('#recover-listing').onclick = async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          await chain.authenticate();
          await chain.api('/coins', { method: 'POST', body: JSON.stringify(pending) });
          localStorage.removeItem('yn-pending-registration');
          context.toast('Confirmed on-chain ownership; listing recovered.');
          context.reload();
        } catch(error) { context.toast(error.message); button.disabled = false; }
      };
    }
  }
  if (page === "Portfolio" && mode === "live" && chain.publicKey) {
    document.querySelector('.content').insertAdjacentHTML('beforeend', `<section class="setup-section"><div class="section-heading"><h2>Transaction recovery</h2><button class="secondary" id="recover-transactions">${icon('refresh-cw')} Recheck</button></div><div id="transaction-recovery"></div></section>`);
    document.querySelector('#recover-transactions').onclick = async event => {
      const button = event.currentTarget;
      const root = document.querySelector('#transaction-recovery');
      button.disabled = true;
      try {
        const records = await chain.recoverTransactions();
        if (root.isConnected) root.innerHTML = records.map(row => `<div class="health-check"><div><a href="https://solscan.io/tx/${esc(row.signature)}" target="_blank" rel="noopener noreferrer">${esc(row.signature.slice(0, 12))}</a><span>${esc(new Date(row.updated).toLocaleString())}</span></div><small>${esc(row.state)}</small></div>`).join('') || '<p class="muted">No recorded transactions in this browser.</p>';
      } catch(error) { if (root.isConnected) root.textContent = error.message; }
      finally { button.disabled = false; }
    };
    document
      .querySelector(".market")
      .insertAdjacentHTML(
        "afterend",
        `<section class="wallet-history"><div class="section-heading"><h2>Recent transactions</h2><button class="icon-button" id="refresh-activity" title="Refresh transactions">${icon("refresh-cw")}</button></div><div id="wallet-activity">Loading on-chain activity...</div></section>`,
      );
    loadActivity(context);
    document.querySelector("#refresh-activity").onclick = () =>
      loadActivity(context);
  }
  createIcons({ icons });
}

export function reviewInitialPurchase(intent, { modal, esc, toast, transactionResult }) {
  modal(`<span class="eyebrow">INITIAL PURCHASE / SEPARATE TRANSACTION</span><h2>Buy your new coin</h2><p class="address">${esc(intent.mint)}</p><div class="launch-terms"><span>Amount <b>${esc(intent.amount)} SOL</b></span><span>Slippage <b>${intent.slippageBps / 100}%</b></span></div><div id="initial-quote"></div><p class="form-error" role="alert"></p><button class="primary full" id="review-initial">${icon('refresh-cw')} Get initial buy quote</button><button class="secondary full" id="cancel-initial">Skip initial purchase</button>`, () => {
    const button = document.querySelector('#review-initial');
    const root = button.closest('.modal');
    root.querySelector('#cancel-initial').onclick = async event => {
      const cancel = event.currentTarget; cancel.disabled = true;
      try { await chain.cancelLaunchPurchase(intent); root.querySelector('.form-error').textContent = 'Initial purchase cancelled. Your coin is unchanged.'; button.disabled = true; }
      catch (error) { root.querySelector('.form-error').textContent = error.message; cancel.disabled = false; }
    };
    button.onclick = async () => {
      button.disabled = true;
      root.querySelector('.form-error').textContent = '';
      try {
        const quote = await chain.prepareLaunchPurchase(intent);
        if (!root.isConnected) return;
        root.querySelector('#initial-quote').innerHTML = `<div class="launch-terms">${quote.inputIsMaximum ? `<span>Maximum SOL input <b>${esc(intent.amount)} SOL</b></span>` : ''}<span>${quote.inputIsMaximum ? 'Target tokens' : 'Estimated tokens'} <b>${esc(quote.output)}</b></span><span>Minimum tokens <b>${esc(quote.minimum)}</b></span>${quote.feeDetails.map(([name, amount]) => `<span>${esc(name)} <b>${esc(amount)} SOL</b></span>`).join('')}</div>`;
        button.disabled = false;
        button.textContent = 'Sign initial buy';
        button.onclick = async () => {
          button.disabled = true;
          try {
            const signature = await quote.execute();
            transactionResult('Initial purchase confirmed.', signature, intent.mint);
          } catch (error) {
            if (root.isConnected) { root.querySelector('.form-error').textContent = `${error.message} Your coin remains created. Recheck this purchase in Creator Studio.`; button.textContent = 'Recheck in Creator Studio'; }
          }
        };
      } catch (error) {
        if (root.isConnected) root.querySelector('.form-error').textContent = error.message;
        button.disabled = false;
      }
    };
    createIcons({ icons });
  });
}

async function setupForm({ esc, toast, reload }) {
  const root = document.querySelector("#setup-form-root");
  try {
    const result = await chain.api("/setup");
    if (!root.isConnected) return;
    const fields = [
      [
        "SOLANA_RPC_URL",
        "Solana mainnet RPC URL",
        "url",
        "https://your-mainnet-rpc-provider.com",
      ],
      [
        "JUPITER_API_KEY",
        "Jupiter API key",
        "password",
        "Optional for higher rate limits",
      ],
      ["PINATA_JWT", "Pinata JWT", "password", "Public IPFS uploads"],
      [
        "PUBLIC_BASE_URL",
        "Public MemePop URL",
        "url",
        "https://your-yeetnest-domain.com",
      ],
      [
        "IPFS_GATEWAY",
        "IPFS gateway",
        "url",
        "https://gateway.pinata.cloud/ipfs/",
      ],
    ];
    root.innerHTML = `<form id="provider-form" autocomplete="off"><div class="setup-fields">${fields.map(([key, label, type, placeholder]) => `<label>${label}<span class="configured-label">${result.configured[key] ? "Configured" : "Not configured"}</span><input name="${key}" type="${type}" placeholder="${esc(placeholder)}" autocomplete="new-password"/></label>`).join("")}</div><p class="fine">Blank fields keep existing values. Credentials stay on this machine. Public uploads use Pinata, or your HTTPS domain when Pinata is not configured.</p><p class="form-error" id="setup-error" role="alert"></p><button type="submit" class="primary">${icon("save")} Save provider settings</button></form>`;
    createIcons({ icons });
    document.querySelector("#provider-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.target,
        button = form.querySelector("button");
      button.disabled = true;
      try {
        await chain.api("/setup", {
          method: "POST",
          headers: { "x-setup-token": result.token },
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        form.reset();
        toast("Provider settings saved.");
        await reload();
      } catch (error) {
        form.querySelector("#setup-error").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  } catch {
    if (root.isConnected)
      root.innerHTML =
        '<p class="muted">Provider setup is available on the local development server. Production credentials are configured on the server.</p>';
  }
}

function creatorStudio(context) {
  const { mode, coins, esc, launch, wallet, toast, modal, openCoin } = context;
  const creator = mode === "live" ? chain.publicKey?.toBase58() : context.demoCreator;
  const mine = coins.filter(
    (c) => creator && c.creator === creator,
  );
  const content = document.querySelector(".content");
  content.innerHTML = `<div class="heading"><div><div class="eyebrow">CREATOR STUDIO / ${mode.toUpperCase()}</div><h1>Make some noise.</h1><p>Your launches. Your artwork. Your creator fees.</p></div><button class="primary" id="studio-launch">${icon("plus")} Hatch a coin</button></div><section class="creator-banner"><div><span class="label">RAYDIUM CREATOR FEES</span><h2 id="creator-fee">${mode === "live" ? "--" : "Demo mode"}</h2><p>SOL-paired launch fees are claimed in wrapped SOL.</p></div><div class="creator-actions"><button class="secondary" id="refresh-fees">${icon("refresh-cw")} Refresh</button><button class="primary" id="claim-fees">${icon("gift")} ${chain.publicKey && mode === "live" ? "Claim fees" : "Connect live wallet"}</button></div></section><div class="section-heading"><h2>Your launches <span class="count-badge">${mine.length}</span></h2></div><div class="studio-coins">${mine.map((c) => `<button class="studio-coin" data-studio-coin="${esc(c.id)}"><div><b>${esc(c.name)}</b><span>$${esc(c.ticker)} · ${esc(c.launchStatus || (mode === "demo" ? "Demo" : "LaunchLab"))}</span></div>${icon("arrow-up-right")}</button>`).join("") || `<div class="empty">${icon("egg")}<h3>Your next idea starts here.</h3><p>${mode === "live" && !chain.publicKey ? "Connect your creator wallet to see your launches." : "Your created coins will appear here."}</p></div>`}</div>`;
  document.querySelector("#studio-launch").onclick = launch;
  const feeProtocol = document.createElement('select');
  feeProtocol.title = 'Creator fee protocol';
  feeProtocol.innerHTML = '<option value="pump">Pump / PumpSwap</option><option value="raydium">Raydium LaunchLab (legacy)</option>';
  document.querySelector('.creator-actions').prepend(feeProtocol);
  document.querySelector('.creator-banner .label').textContent = 'CREATOR FEES';
  document.querySelector('.creator-banner p').textContent = 'Collected SOL fees. Unswept Pump curve/pool fee buckets are not included.';
  const loadFees = async () => {
    if (mode !== "live" || !chain.publicKey) return;
    try {
      const balance = await chain.creatorFeeBalance(feeProtocol.value);
      if (document.querySelector("#creator-fee"))
        document.querySelector("#creator-fee").textContent =
          `${balance.amount} ${balance.symbol}`;
    } catch (error) {
      toast(`Fee balance unavailable: ${error.message}`);
    }
  };
  document.querySelector("#refresh-fees").onclick = loadFees;
  feeProtocol.onchange = () => {
    document.querySelector('#creator-fee').textContent = '--';
    document.querySelector('.creator-banner p').textContent = feeProtocol.value === 'pump' ? 'Collected SOL fees. Unswept Pump curve/pool fee buckets are not included.' : 'Legacy LaunchLab SOL-paired fees are claimed in wrapped SOL.';
    loadFees();
  };
  document
    .querySelectorAll("[data-studio-coin]")
    .forEach((b) => (b.onclick = () => openCoin(b.dataset.studioCoin)));
  document.querySelector("#claim-fees").onclick = async (event) => {
    if (mode !== "live") {
      context.switchLive();
      return;
    }
    if (!chain.publicKey) {
      wallet();
      return;
    }
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const prepared = await chain.prepareCreatorClaim(feeProtocol.value);
      modal(
        `<span class="eyebrow">RAYDIUM / MAINNET</span><h2>Claim your creator fees.</h2><div class="claim-amount">${esc(prepared.amount)} <span>WSOL</span></div><p class="fine">Claims your SOL-paired LaunchLab creator fees. Wrapped SOL is deposited into your wallet’s token account. Network fees apply.</p><p class="form-error" id="claim-error"></p><button class="primary full" id="sign-claim">${icon("pen-line")} Sign and claim</button>`,
        () => {
          if (prepared.protocol === 'pump') {
            document.querySelector('.modal > .eyebrow').textContent = 'PUMP / PUMPSWAP';
            document.querySelector('.claim-amount span').textContent = 'SOL/WSOL';
            document.querySelector('.modal > .fine').textContent = 'Pump fees arrive as SOL; PumpSwap fees arrive as WSOL in your wallet token account, which is not closed. Unswept buckets are excluded. Review recipients and network fees in your wallet.';
          }
          document.querySelector("#sign-claim").onclick = async (e) => {
            const b = e.currentTarget;
            b.disabled = true;
            try {
              const signature = await prepared.execute();
              context.transactionResult(
                "Creator fees claimed.",
                signature,
                chain.SOL,
              );
            } catch (error) {
              document.querySelector("#claim-error").textContent =
                error.message;
            }
          };
        },
      );
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  };
  loadFees();
}

async function loadActivity({ esc }) {
  const root = document.querySelector("#wallet-activity");
  root.textContent = "Loading on-chain activity...";
  const wallet = chain.publicKey?.toBase58();
  try {
    const activity = await chain.walletActivity();
    if (!root.isConnected || wallet !== chain.publicKey?.toBase58()) return;
    root.innerHTML =
      activity
        .map(
          (t) =>
            `<a class="activity-row" href="https://solscan.io/tx/${esc(t.signature)}" target="_blank" rel="noopener noreferrer"><span class="activity-icon ${t.err ? "failed" : ""}">${icon(t.err ? "x" : "check")}</span><div><b>${esc(t.signature.slice(0, 10))}...${esc(t.signature.slice(-6))}</b><span>${t.blockTime ? new Date(t.blockTime * 1000).toLocaleString() : "Timestamp unavailable"}</span></div><span>${t.err ? "Failed" : esc(t.confirmationStatus || "Confirmed")}</span>${icon("external-link")}</a>`,
        )
        .join("") || '<p class="muted">No recent wallet transactions.</p>';
    createIcons({ icons });
  } catch {
    if (root.isConnected)
      root.textContent =
        "Transaction history is unavailable from the RPC provider.";
  }
}

export function cleanupMarket() { disposeChart(); }

export async function mountMarket(coin, { esc }) {
  disposeChart();
  const root = document.querySelector("#live-market");
  if (!root) return;
  let cancelled = false, refreshTimer;
  const changed = event => {
    if (!root.isConnected || document.hidden || (event.detail.mint && event.detail.mint !== coin.mint) || refreshTimer) return;
    refreshTimer = setTimeout(() => { if (root.isConnected) mountMarket(coin, { esc }); }, 5000);
  };
  window.addEventListener('memepop-market', changed);
  const cleanupUpdates = () => { cancelled = true; clearTimeout(refreshTimer); window.removeEventListener('memepop-market', changed); };
  disposeChart = cleanupUpdates;
  root.innerHTML =
    '<div class="market-loading">Loading live pool data...</div>';
  try {
    const curve = Boolean(coin.poolId && coin.launchStatus !== 'Graduated');
    const result = await chain.api(`${curve ? '/curve/' : '/market/'}${coin.mint}`);
    if (!root.isConnected || cancelled) return;
    const pair = result.pair;
    if (!curve && !pair) {
      root.innerHTML = `<p class="fine">${esc(result.chartError)}</p>`;
      return;
    }
    root.innerHTML = curve
      ? `<div class="chart-header"><b>Price / SOL</b><span>5M · Finalized curve trades</span></div><div class="token-chart" id="token-chart"></div>${result.candles?.length ? '' : '<p class="fine">No curve trades have been indexed yet.</p>'}`
      : `<div class="pool-metrics"><span>Price<b>${dollars(Number(pair.priceUsd))}</b></span><span>Liquidity<b>${dollars(pair.liquidity?.usd)}</b></span><span>24h trades<b>${(pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0)}</b></span></div><div class="chart-header"><b>Price / USD</b><span>1H · ${esc(pair.dexId)}</span></div><div class="token-chart" id="token-chart"></div>${result.chartError ? `<p class="fine">${esc(result.chartError)}</p>` : ""}<a class="source-link" href="https://dexscreener.com/solana/${esc(pair.pairAddress)}" target="_blank" rel="noopener noreferrer">Pool on DexScreener ${icon("external-link")}</a>`;
    createIcons({ icons });
    const candles = new Map();
    for (const candle of result.candles) {
      if (
        !Array.isArray(candle) ||
        candle.length < 5 ||
        !candle.slice(0, 5).every(Number.isFinite)
      )
        continue;
      const [time, open, high, low, close] = candle;
      if (
        time > 0 &&
        low >= 0 &&
        low <= Math.min(open, close) &&
        high >= Math.max(open, close)
      )
        candles.set(time, { time, open, high, low, close });
    }
    if (!candles.size) {
      document.querySelector("#token-chart").remove();
      return;
    }
    const element = document.querySelector("#token-chart");
    const theme = getComputedStyle(document.documentElement);
    const chart = createChart(element, {
      height: 220,
      width: element.clientWidth,
      layout: {
        background: { color: theme.getPropertyValue("--surface").trim() },
        textColor: theme.getPropertyValue("--muted").trim(),
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: theme.getPropertyValue("--chart-grid").trim() },
        horzLines: { color: theme.getPropertyValue("--chart-grid").trim() },
      },
      rightPriceScale: { borderColor: theme.getPropertyValue("--line").trim() },
      timeScale: { borderColor: theme.getPropertyValue("--line").trim(), timeVisible: true },
    });
    chart
      .addSeries(CandlestickSeries, {
        upColor: "#93c9b0",
        downColor: "#ed9a8b",
        wickUpColor: "#93c9b0",
        wickDownColor: "#ed9a8b",
        borderVisible: false,
        ...(curve ? { priceFormat: { type: 'price', precision: 12, minMove: 0.000000000001 } } : {}),
      })
      .setData([...candles.values()].sort((a, b) => a.time - b.time));
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(() => {
      if (element.isConnected)
        chart.applyOptions({ width: element.clientWidth });
      else {
        observer.disconnect();
        chart.remove();
      }
    });
    observer.observe(element);
    disposeChart = () => {
      cleanupUpdates();
      observer.disconnect();
      chart.remove();
      disposeChart = () => {};
    };
  } catch (error) {
    if (root.isConnected)
      root.innerHTML = `<p class="fine">${esc(error.message)}</p>`;
  }
}
