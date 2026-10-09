# MemePop Scaling And Feature Completion

October 9, 2026. Implemented locally; not deployed by this agent. No funded transactions were executed.

## What This Revision Does

The existing launch, curve buy/sell, Jupiter routing, creator claims, artwork, profiles, watchlists, discovery and chart flows remain. Updates add durable indexing, stronger creation/curve/claim policies, economics review, percentage sells, moderation, paginated discussions, separately approved initial buys with recovery, logout revocation, worker heartbeats/maintenance tools and bounded reconnectable market refresh notifications.

The user subsequently selected Pump/PumpSwap. New standard SOL creation/trading now uses the official Pump SDKs; legacy Raydium/Jupiter paths remain. Follows, account-data deletion, moderator history, bounded metadata and Cloudflare player integration were also added. See `PUMP_ROLLOUT.md` for the current deployment and remaining-work checklist. This does not establish complete feature parity or equal throughput; contradictory older roadmap entries below are superseded.

## Roll Out These Changes

1. Review and commit the changed source files and new migrations. Keep `.env` out of Git. Push the branch connected to Render.
2. Run `npm run db:migrate` against the same PostgreSQL database used by the deployed web and workers. Migrations through 012 are required. Render's pre-deploy command is already configured in `render.yaml`; the advisory-locked checksum ledger skips applied migrations. Add new SQL files rather than editing applied ones. Migration 009 copies legacy application catalogue/watchlist records once without deleting the original records.
3. Deploy the web service with build `npm ci && npm run build`, start `npm start`, health path `/readyz`, `NODE_ENV=production`, `TRUST_PROXY_HOPS=1`, your database/RPC/Jupiter/Pinata runtime settings. Do not expose secrets with `VITE_` names.
4. For moderator access, set web-service `MODERATOR_WALLETS` to comma-separated Solana PUBLIC wallet addresses. Never enter seeds/private keys. The Moderation tab appears in Live mode after status loads. Connect an allowlisted wallet, open Moderation, click Review reports and approve the sign-in message. Hide comment resolves its pending reports; Dismiss reports leaves the comment visible. All authorization is enforced on the server, not by hiding UI controls.
5. Initially retain one background worker, start `npm run indexer`, with the same database and private RPC endpoint as the web service. Set `INDEXER_ROLE=all`, `INDEXER_CONCURRENCY=4`, `INDEXER_PAGE_SIZE=100`, `INDEXER_SCAN_INTERVAL_MS=2000`, `INDEXER_MAX_PENDING=10000`. Leave `INDEXER_ONCE` unset. Check the provider's request allowance before increasing concurrency.
6. To split scanning and processing later, change the original worker to `INDEXER_ROLE=scan`; create another background worker from the same repo with `INDEXER_ROLE=process` and identical database/RPC settings. Increase processor replicas only after measurement. Multiple scanner-capable replicas elect a single scanner through a PostgreSQL advisory lock; processing replicas claim separate queue jobs. Do not use a transaction-pooled connection for the scanner's session advisory lock.
7. Monitor `/api/indexer/status` and `/api/launches/indexed`. Watch pending/processing/failed jobs, oldest pending time, worker heartbeats, scan errors and timestamps. Metrics are cached for 15 seconds. Use `npm run indexer:jobs -- failed`, then explicitly `retry <signature>` after fixing the cause. Bounded completed-job and market-event retention is seven days. Never mark incomplete history complete to hide errors.
8. Enable database backups and alerts. API pools can total up to 33 connections per instance, plus workers (up to 14 for an all-role worker). Budget all replicas against the database connection limit with operational headroom. Connection pooling must preserve scanner session-lock semantics.
9. Repeat the deployed acceptance checklist in `IMPLEMENTATION_STATUS.md`. Approve any real-money testing separately with an explicit wallet and maximum amount/fees. Passing local tests is not funded-launch acceptance.

## Remaining Engineering Work

These are unfinished features, not settings you can enable:

| Area | What Is Still Required |
| --- | --- |
| Creation with initial buy | Separate reviewed purchase, local intent/signature recovery and skip action are implemented. Funded acceptance and cross-device intent storage remain. Atomic bundles require a separate provider/protocol design and consent. |
| Full transaction security | Creator claim and auxiliary curve instruction policies are implemented with adversarial tests. Complete Jupiter route economic/instruction checks and independent audit remain. Canonical SDK comparison is not an independent audit. |
| Complete global discovery | Verify sustained historical scanning, archive-RPC availability and supported pool coverage; enrich external metadata through bounded allowlisted fetches; reconcile migrations independently. Unsupported quote/program variants remain excluded. |
| Global ranking and portfolio | Catalogue/watchlists are normalized and indexed discovery uses keyset cursors. Still add finalized balance/unique-holder indexing, price provenance, cost basis and realized/unrealized P/L. Largest token accounts are not unique holders. |
| Realtime market updates | Bounded SSE refresh notifications with replay/reset and heartbeats are implemented. Shared caches, higher-capacity fanout, full tick feeds and replay-safe pre-aggregated candles remain. |
| Sustained indexing operations | Retention, dead-job CLI and worker heartbeats are implemented. Partitioning, automated alerts and measured throughput remain. More processors do not remove the scanner's throughput ceiling. |
| Production traffic | Run realistic ramp, sustained load, failure and restart tests. Measure request latency, DB lock/pool waits, queue delay, RPC quota and memory. Add CDN/WAF/gateway protection; select paid plans from measured capacity, not an assumed Pump.fun traffic number. |
| Social/account lifecycle | Logout revocation is implemented. Follows, moderation history UI, privacy/deletion workflows and staffed moderation remain. The review queue returns the oldest 100 pending reports. |
| Pump-specific features | Pump/PumpSwap execution, rewards, fee sharing, USDC launches, advanced orders and protocol-specific modes need distinct specifications and audited integrations. They are not provided by the current Raydium SOL path. |
| Livestreams | Choose a video provider, implement signed stream/access credentials, realtime chat, abuse/report tools, moderation staffing and cost limits. Hosting the frontend alone cannot supply this. |

## Hosting And Data

Yes: public operation needs an always-on backend, PostgreSQL and a continuously running indexer. Render can provide the web service, workers and database; it is not the only option. Artwork/metadata uses Pinata/IPFS, so uploads do not need local disks when Pinata is configured. A paid/private Solana RPC with adequate archival access and quotas and a Jupiter API key remain external dependencies.

Redis is optional for the current PostgreSQL queue. Shared caching/realtime fanout may justify Redis later; it is not a prerequisite for running this revision. A single modest worker is an initial configuration, not a Pump.fun-scale recommendation. No hosting subscriptions or replicas were purchased or changed.

Previously exposed provider credentials must be rotated at their issuing dashboards. Keep replacements only in local `.env` and backend hosting environment settings.
