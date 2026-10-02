# YeetNest

A Solana meme coin launchpad with a light, coral-and-teal visual identity. Demo and live modes are separate: sample coins never become live tokens by connecting a wallet.

## Run

```sh
npm install
npm run dev -- --port 5174
```

For the production server, run `npm run build` followed by `npm start`. The server serves `dist` and the same API used during development.

## Live Configuration

Set values in the project's `.env`, using `.env.example` as the template, and restart the server. Credentials remain server-side.

| Variable | Purpose |
| --- | --- |
| `SOLANA_RPC_URL` | Mainnet RPC URL, including a provider key when needed. Defaults to Solana's rate-limited public endpoint. |
| `JUPITER_API_KEY` | Jupiter API key. Current endpoints also accept keyless requests at lower limits. |
| `PINATA_JWT` | Required for public IPFS coin artwork and metadata uploads. |
| `IPFS_GATEWAY` | Public gateway prefix ending in `/ipfs/`. Defaults to Pinata. |
| `PORT` | Production HTTP port, default 3000. |

Do not add private wallet keys or `VITE_`-prefixed credentials. Phantom and Solflare sign transactions in the browser. Creator uploads use a short-lived, nonce-based wallet signature session.

## What Works

- Rebranded YeetNest discovery, filters, watchlists, portfolio, and integrations views.
- Creator uploads at launch and creator-only artwork replacement. PNG, JPEG, WebP, and GIF input is resized to a maximum of 512 pixels and converted into a static PNG; GIF uses one frame.
- Local demo launches, trading, and balance accounting, with persisted creator artwork.
- Live Jupiter token discovery and mint search; quote review, wallet signing, and Swap V2 execution.
- Live mainnet SOL balances and SPL / Token-2022 holdings.
- Raydium standard SOL LaunchLab token creation, transaction simulation, sequential submission, HTTP confirmation polling, native curve buy/sell, and Jupiter routing after curve trading closes when a route is available.
- Public Pinata uploads and server catalogue registration, with creator ownership verified from the Raydium pool account.
- Signed swap messages must match the reviewed order. Quote expiration, rejection, failure, and unknown confirmation outcomes are handled explicitly.

Artwork replacement changes YeetNest's catalogue image. It does not rewrite the original on-chain metadata URI or promise changes in other explorers. Coins launched elsewhere cannot have their artwork changed through YeetNest.

## Verification And Limits

Run `npm test` and `npm run test:ui`. Browser tests use installed Microsoft Edge and the local server at port 5174. They use controlled wallet/provider responses and never move funds.

Read-only live checks confirmed Jupiter token search/top-traded responses, Solana mainnet genesis, and the existence of Raydium's SOL LaunchLab configuration. No funded wallet transaction has been submitted by the coding agent. Pinata upload, real wallet signing, live swap settlement, live launch settlement, and real curve trades still need integration acceptance testing with configured credentials and a wallet under the operator's control.

Public RPC and keyless Jupiter limits can cause failures. Active market views refresh every 60 seconds. DexScreener supplies indexed pool metrics and GeckoTerminal supplies real hourly candles; unindexed assets show an unavailable state rather than synthetic charts.

Catalogue and upload references persist under `data/` with serialized atomic writes, suitable for a single process. Authentication challenges and quote state remain transient. A production deployment needs a durable database, shared sessions, an indexer, distributed quotas, image moderation, backup, and monitoring.

## Provider Setup

Open Integrations locally to configure an HTTPS Solana RPC, Jupiter API key, and Pinata JWT without putting secrets in chat. Settings are stored in ignored `data/provider-settings.json`; do not publish this directory. Blank fields preserve existing settings. Connection tests verify provider responses and mainnet identity. The production `npm start` server disables setup endpoints; configure `.env` or provision settings before deployment.

Alternatively, set `PUBLIC_BASE_URL` to your deployed public HTTPS domain for self-hosted content-addressed artwork and metadata. Keep `data/public/` backed up and mount persistent storage. Public reachability and TLS must be verified after deployment; localhost cannot substitute for a public metadata URL. Never enter a wallet seed phrase or private key.

Creator Studio displays creator-owned launches, checks Raydium's SOL-quote creator vault, and prepares simulated WSOL fee claims for explicit wallet signing. Portfolio displays recent confirmed wallet signatures with Solscan links. Real funded claims remain untested.

Raydium's default platform configuration applies. YeetNest does not claim its own trading revenue, holder rewards, or fee policy. Standard launches currently use classic SPL tokens, not StonkFun's Token-2022 reward token design. Initial buys and custom fee selection are deliberately unavailable in live mode.

The vulnerable native `bigint-buffer` dependency is replaced by a tested, bounded JavaScript implementation; UUID is overridden to a patched version. The current Solana v1 SDK dependency tree still reports a moderate `stream-json` advisory through `jayson`. YeetNest does not use its filter functions; it has not forced an incompatible major upgrade. Reassess before public production deployment.

## StonkFun Parity

Full parity cannot be claimed: the reference site was not directly accessible. The in-app Integrations table and [FEATURE_PARITY.md](FEATURE_PARITY.md) track the known differences and the sources used.

## Pump.fun Coverage

The current request supersedes the earlier StonkFun comparison. Integrations now displays Pump.fun feature coverage. See [PUMP_PARITY.md](PUMP_PARITY.md) for the detailed unfinished-feature checklist, architecture and Render/PostgreSQL setup steps. Terminal and leaderboard use loaded coin data; profiles/discussions are explicitly browser-local demos. Full Pump protocol integration, shared accounts, livestreaming and production financial workflows are not complete.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for Node hosting, Docker Compose, persistent storage, HTTPS, health checks, and the remaining acceptance checklist. The production server validates writable `DATA_DIR`, exposes `/healthz` and `/readyz`, sets baseline response security headers, and drains requests on shutdown. Container execution has not been verified on this machine because Docker is unavailable.

`npm run build:hosted` produces the public static demo used by Sites. It keeps demo launches, creator artwork, watchlists, and simulated trades browser-local. It explicitly blocks mainnet connections and API calls because Sites does not run the existing persistent Node backend. The normal `npm run build` and `npm start` path retains the full server integration. Publishing the static demo is not a deployment of live trading.
