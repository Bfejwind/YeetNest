# MemePop Scaling And Feature Completion

October 8, 2026. Implemented locally; not deployed by this agent. No funded transactions were executed.

## What This Revision Does

The existing launch, curve buy/sell, Jupiter routing, creator claims, artwork, profiles, watchlists, discovery and chart flows remain. This revision adds distributed durable indexing, stronger creation/curve validation, launch economics review, percentage sells, moderation and paginated discussions.

It does not make MemePop a complete Pump.fun clone or prove equal throughput. The current architecture deliberately uses Raydium LaunchLab and Jupiter, not Pump/PumpSwap contracts.

## Roll Out These Changes

1. Review and commit the changed source files and new migrations. Keep `.env` out of Git. Push the branch connected to Render.
2. Run `npm run db:migrate` against the same PostgreSQL database used by the deployed web and workers. Migrations 005/006 are required. Render's pre-deploy command is already configured in `render.yaml`; migration commands are idempotent.
3. Deploy the web service with build `npm ci && npm run build`, start `npm start`, health path `/readyz`, `NODE_ENV=production`, `TRUST_PROXY_HOPS=1`, your database/RPC/Jupiter/Pinata runtime settings. Do not expose secrets with `VITE_` names.
4. For moderator access, set web-service `MODERATOR_WALLETS` to comma-separated Solana PUBLIC wallet addresses. Never enter seeds/private keys. The Moderation tab appears in Live mode after status loads. Connect an allowlisted wallet, open Moderation, click Review reports and approve the sign-in message. Hide comment resolves its pending reports; Dismiss reports leaves the comment visible. All authorization is enforced on the server, not by hiding UI controls.
5. Initially retain one background worker, start `npm run indexer`, with the same database and private RPC endpoint as the web service. Set `INDEXER_ROLE=all`, `INDEXER_CONCURRENCY=4`, `INDEXER_PAGE_SIZE=100`, `INDEXER_SCAN_INTERVAL_MS=2000`, `INDEXER_MAX_PENDING=10000`. Leave `INDEXER_ONCE` unset. Check the provider's request allowance before increasing concurrency.
6. To split scanning and processing later, change the original worker to `INDEXER_ROLE=scan`; create another background worker from the same repo with `INDEXER_ROLE=process` and identical database/RPC settings. Increase processor replicas only after measurement. Multiple scanner-capable replicas elect a single scanner through a PostgreSQL advisory lock; processing replicas claim separate queue jobs. Do not use a transaction-pooled connection for the scanner's session advisory lock.
7. Monitor `/api/indexer/status` and `/api/launches/indexed`. Watch `jobs.pending`, `jobs.processing`, `jobs.failed`, `oldestPendingAt`, scan errors and timestamps. Metrics are cached for 15 seconds. A rising queue means processors/RPC cannot keep up. Failed jobs require investigation and deliberate requeue after fixing their cause; there is no automatic administrative requeue endpoint yet. Never mark incomplete history complete to hide errors.
8. Enable database backups and alerts. API pools can total up to 28 connections per instance, plus workers (up to 14 for an all-role worker). Budget all replicas against the database connection limit with operational headroom. Connection pooling must preserve scanner session-lock semantics.
9. Repeat the deployed acceptance checklist in `IMPLEMENTATION_STATUS.md`. Approve any real-money testing separately with an explicit wallet and maximum amount/fees. Passing local tests is not funded-launch acceptance.

## Remaining Engineering Work

These are unfinished features, not settings you can enable:

| Area | What Is Still Required |
| --- | --- |
| Creation with initial buy | Build a separately reviewed initial-buy transaction after confirmed creation; bind owner/mint/pool/input/minimum/fees; persist both signatures and partial outcomes; recover a successful creation if the buy is rejected. Atomic bundles need a separate provider/protocol design and explicit consent. |
| Full transaction security | Extend Jupiter and creator-claim economic/account policies, token/ATA auxiliary instruction checks and adversarial fixtures. Independently audit signing, RPC proxy, metadata and program integrations. Current canonical SDK comparison is not an independent audit. |
| Complete global discovery | Verify sustained historical scanning, archive-RPC availability and supported pool coverage; enrich external metadata through bounded allowlisted fetches; reconcile migrations independently. Unsupported quote/program variants remain excluded. |
| Global ranking and portfolio | Normalize catalogue/watchlists rather than locking entire JSONB collections; add stable keyset paging, finalized balance/unique-holder indexing, price provenance, cost basis and realized/unrealized P/L. Largest token accounts are not unique holders. |
| Realtime market updates | Add finalized-event push/pubsub and SSE/WebSocket fanout with sequence numbers, reconnect/resume, heartbeat and bounded clients; share caches; pre-aggregate candles with replay-safe updates. UI currently fetches data, not tick streams. |
| Sustained indexing operations | Add queue retention/partitioning, explicit dead-job review/requeue tools, worker heartbeat/processing-lag alerts and measured scan-throughput limits. More processors do not remove a single scanner's throughput ceiling. |
| Production traffic | Run realistic ramp, sustained load, failure and restart tests. Measure request latency, DB lock/pool waits, queue delay, RPC quota and memory. Add CDN/WAF/gateway protection; select paid plans from measured capacity, not an assumed Pump.fun traffic number. |
| Social/account lifecycle | Add follows, session revocation, moderation history UI, retention/privacy policy, deletion workflows and staffed moderation. The review queue currently returns the oldest 100 pending reports, advancing as reports are resolved. |
| Pump-specific features | Pump/PumpSwap execution, rewards, fee sharing, USDC launches, advanced orders and protocol-specific modes need distinct specifications and audited integrations. They are not provided by the current Raydium SOL path. |
| Livestreams | Choose a video provider, implement signed stream/access credentials, realtime chat, abuse/report tools, moderation staffing and cost limits. Hosting the frontend alone cannot supply this. |

## Hosting And Data

Yes: public operation needs an always-on backend, PostgreSQL and a continuously running indexer. Render can provide the web service, workers and database; it is not the only option. Artwork/metadata uses Pinata/IPFS, so uploads do not need local disks when Pinata is configured. A paid/private Solana RPC with adequate archival access and quotas and a Jupiter API key remain external dependencies.

Redis is optional for the current PostgreSQL queue. Shared caching/realtime fanout may justify Redis later; it is not a prerequisite for running this revision. A single modest worker is an initial configuration, not a Pump.fun-scale recommendation. No hosting subscriptions or replicas were purchased or changed.

Previously exposed provider credentials must be rotated at their issuing dashboards. Keep replacements only in local `.env` and backend hosting environment settings.
