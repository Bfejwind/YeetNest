# YeetNest

A Solana meme coin launchpad with dark neutral surfaces and Pump-inspired mint-green accents. Demo and live modes are separate: sample coins never become live tokens by connecting a wallet.

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
| `DATABASE_URL` | Server-only PostgreSQL connection string for profiles, comments, reports, catalogue, upload references and watchlists. Run `npm run db:migrate` before starting. |
| `DATA_DIR` | Writable runtime folder; persistent disk required for JSON fallback or self-hosted uploads. |
| `NODE_ENV` | Set to `production` on Render. |
| `TRUST_PROXY_HOPS` | Set to `1` behind Render's reverse proxy; `0` for direct local access. |
| `PUBLIC_BASE_URL` | Optional public HTTPS origin for self-hosted uploads; still requires a persistent disk. |

Do not add private wallet keys or `VITE_`-prefixed credentials. Phantom and Solflare sign transactions in the browser. Creator uploads use a short-lived, nonce-based wallet signature session.

Wallet discovery supports injected Phantom/Solflare providers and the official Solana Wallet Standard adapter, including a short retry for late extension injection. Use the Render HTTPS website directly in a browser where the extension is enabled and allowed site access. On mobile, open that URL inside the wallet app's browser. Missing-wallet errors offer official download links; there is no embedded wallet, remote pairing or automatic installation. The static Sites demo still blocks mainnet wallet connections.

Extension-free options: choose **Solflare Web** for the official SDK connection surface, or **Phantom on phone / Solflare on phone** for a QR/universal link to the deployed website in the mobile wallet browser. Phone handoff creates a phone session, not a remotely connected desktop session. A wallet still needs to hold the user's keys somewhere; never enter seed phrases into YeetNest. External provider UI and real signature/transaction approval need operator acceptance testing. Phantom embedded login requires an approved existing App ID; current official docs say new Portal registrations are paused.

Connection diagnostics under Integrations now check community storage as well as RPC, Jupiter and upload credentials. Upload authentication is not proof of public artwork reachability. `/readyz` checks community storage continuously. In production, Render environment variables take precedence over saved local provider settings. Restart the local dev server after changing `.env`. Render external PostgreSQL URLs automatically use verified TLS when no SSL settings are supplied; use the internal URL on Render and the external URL locally.

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

With `DATABASE_URL`, catalogue, upload references and wallet watchlists now persist in PostgreSQL with transactional row locking. JSON fallback retains serialized atomic writes. Sessions, challenges, quotes and rate limits remain transient: run one instance. A production deployment still needs an indexer, shared sessions/quotas for scaling, image moderation, backups and monitoring. Public transaction signatures are journaled before broadcast and reconciled against chain status, without automatic rebroadcast.

## Provider Setup

Open Integrations locally to configure an HTTPS Solana RPC, Jupiter API key, and Pinata JWT without putting secrets in chat. Settings are stored in ignored `data/provider-settings.json`; do not publish this directory. Blank fields preserve existing settings. Connection tests verify provider responses and mainnet identity. The production `npm start` server disables setup endpoints; configure `.env` or provision settings before deployment.

Alternatively, set `PUBLIC_BASE_URL` to your deployed public HTTPS domain for self-hosted content-addressed artwork and metadata. Keep `data/public/` backed up and mount persistent storage. Public reachability and TLS must be verified after deployment; localhost cannot substitute for a public metadata URL. Never enter a wallet seed phrase or private key.

Creator Studio displays creator-owned launches, checks Raydium's SOL-quote creator vault, and prepares simulated WSOL fee claims for explicit wallet signing. Portfolio displays recent confirmed wallet signatures with Solscan links. Real funded claims remain untested.

Raydium's default platform configuration applies. YeetNest does not claim its own trading revenue, holder rewards, or fee policy. Standard launches currently use classic SPL tokens, not StonkFun's Token-2022 reward token design. Initial buys and custom fee selection are deliberately unavailable in live mode.

The vulnerable native `bigint-buffer` dependency is replaced by a tested, bounded JavaScript implementation; UUID is overridden to a patched version. The current Solana v1 SDK dependency tree still reports a moderate `stream-json` advisory through `jayson`. YeetNest does not use its filter functions; it has not forced an incompatible major upgrade. Reassess before public production deployment.

## StonkFun Parity

Full parity cannot be claimed: the reference site was not directly accessible. The in-app Integrations table and [FEATURE_PARITY.md](FEATURE_PARITY.md) track the known differences and the sources used.

## Pump.fun Coverage

The current request supersedes the earlier StonkFun comparison. Integrations now displays Pump.fun feature coverage. See [PUMP_PARITY.md](PUMP_PARITY.md) for the detailed unfinished-feature checklist, architecture and Render/PostgreSQL setup steps. Terminal and leaderboard use loaded coin data. The static demo has browser-local profiles/discussions; the Node version has signed-wallet shared profile/comment endpoints, owner-only deletion and recorded reports. Reports have no operator moderation service yet. Full Pump protocol integration, social graph, livestreaming and production financial workflows are not complete.

## Community Database Setup

1. Create a managed PostgreSQL database and configure its server-only `DATABASE_URL`. Use the provider's documented TLS settings; never put the URL in a `VITE_` variable or browser code.
2. Run `npm ci` and `npm run db:migrate` with that URL configured. The initial idempotent migration creates profile, comment and report tables. The server refuses to start with an unavailable/unmigrated configured database.
3. Run `npm run build` and `npm start`. In live mode connect a wallet, explicitly approve the sign-in message, then save a profile or post on a mint's discussion.
4. Test with two wallets/browsers, verify unauthorized deletion is rejected and configure backups and retention. Read-only connectivity/schema checks against the configured Render PostgreSQL instance passed on October 7, 2026. Actual PostgreSQL community writes, backup/restore and load tests remain outstanding; automated community write tests use the JSON fallback.

Without `DATABASE_URL`, application data uses serialized JSON in `DATA_DIR`, for a single-process pilot only. Existing JSON is not automatically imported. `npm run db:import-catalogue` verifies a trusted backed-up catalogue against mainnet and performs a dry run; add `-- --apply` to import missing catalogue/upload records without overwriting database records. Community imports require a separate reviewed import. No private keys or seed phrases are stored.

October 7 update: migrations `001-community.sql` and `002-app-records.sql` are required. Actual PostgreSQL persistence/concurrent-write and community authorization tests now pass. [AUDIT_REPORT.md](AUDIT_REPORT.md) supersedes older verification/checklist statements above and details remaining safety gaps. [DEPLOYMENT.md](DEPLOYMENT.md) gives current Render steps.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for Node hosting, Docker Compose, persistent storage, HTTPS, health checks, and the remaining acceptance checklist. The production server validates writable `DATA_DIR`, exposes `/healthz` and `/readyz`, sets baseline response security headers, and drains requests on shutdown. Container execution has not been verified on this machine because Docker is unavailable.

`npm run build:hosted` produces the public static demo used by Sites. It keeps demo launches, creator artwork, watchlists, and simulated trades browser-local. It explicitly blocks mainnet connections and API calls because Sites does not run the existing persistent Node backend. The normal `npm run build` and `npm start` path retains the full server integration. Publishing the static demo is not a deployment of live trading.

### Automation recovery

The always-on Node web service now triggers coin creation daily from **09:15 Asia/Singapore**, including catch-up after a restart. It requires `AUTOLAUNCH_ENABLED=true` and the existing database, wallet, RPC and Pinata settings on that service. The scheduler reads the persistent journal, skips completed or blocked days, and retries incomplete runs after five minutes. The worker retains the database advisory lock and 0.03 SOL daily cap. Set `AUTOLAUNCH_SCHEDULER_ENABLED=false` when a separate cron job owns scheduling. No additional paid service is required. Run `node --test tests/automation-scheduler.test.js` to verify scheduling behavior.

Creator Studio in server automation mode now shows today's Singapore-date journal status and offers **Restart today's automation**. Configure `AUTOLAUNCH_OPERATOR_WALLETS` with the public address(es) of wallets allowed to sign in and request restarts. The web server must also have the worker's `DATABASE_URL`, `AUTOLAUNCH_ENABLED=true`, `AUTOLAUNCH_WALLET`, `AUTOLAUNCH_SECRET_KEY`, `SOLANA_RPC_URL`, and `PINATA_JWT`; deployments that keep signing credentials only on a separate cron worker cannot restart it through this control. Never put these secrets in browser settings.

The button resumes the existing worker using its database advisory lock and persisted transactions; it does not reset journals or increase the 0.03 SOL daily cap. It is unavailable before 09:15 Singapore time, after completion, or when the journal records a block. Resolve blocked causes with journal review. Status refresh is manual. A restart acceptance means the child process was requested; refresh status and check worker configuration/logs if progress stops. These source changes require deploying/restarting the web server to appear on a hosted instance.

The daily creation cap is now 0.03 SOL. Journals from the 0.01 or 0.02 SOL policy retain all original funding, fee records and signed attempts. Each cap upgrade journals a separate funding delta before broadcast, counts every earlier delta, and preserves the source wallet's rent minimum. Expired creation attempts are archived and replaced only after finalized expiry with no signature history, transaction, or mint account. Five slots are attempted, but creation rent, fees or insufficient wallet funding can stop a run earlier.

Manual Pump launches recheck the reviewed instructions and refresh the final blockhash after the mainnet check, immediately before wallet approval. The mint signature is regenerated for that message. Wallet-signed instructions and signatures are still validated and simulated; the identical signed launch is then submitted without duplicating that simulation at broadcast. Expired or ambiguous attempts still require transaction recovery before another launch.

If the fifth creation would leave the daily payer below its minimum account balance, the worker can return only the unused remainder to the configured automation wallet in that same creation transaction. Cost measurement uses an unsigned, non-broadcastable simulation; the final signed transaction contains only the normal creation instructions and the precisely measured refund. Funding and fees remain inside the 0.03 SOL cap.

### Daily automation creator-fee claims

Set `AUTOCLAIM_ENABLED=true` on the existing always-on Node web service to claim creator fees daily from 09:00 Asia/Singapore. On restart after that time, it catches up using the persistent `automation_fee_claims` journal (migration 016). The worker shares the creation advisory lock, verifies mainnet, simulates and journals signed transactions before broadcast, and resumes only the same bytes until final confirmation or proven expiry. Fees go only to `AUTOLAUNCH_WALLET` (native SOL for Pump; WSOL for PumpSwap). There is no transfer to a personal Phantom address. Empty or uneconomical claims are skipped. The network fee is capped at 0.0001 SOL per claim transaction; claim fees and necessary account rent are separate from the 0.03 SOL creation allowance. Unswept fees still held on curves/pools are not included by the installed SDK's vault-balance claim.

Run `npm run autoclaim` for a catch-up run and `npm run test:autoclaim` for regression tests. Claims keep running when browsers close. A web-service outage delays a claim until the service resumes; this reuses the existing service without provisioning a separate paid cron job. Creator Studio's automation status shows the daily fee-claim state.
