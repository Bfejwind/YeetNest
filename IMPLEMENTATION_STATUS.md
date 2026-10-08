# MemePop Implementation Status

October 8, 2026. Local workspace changes, not a claim of deployment or production readiness.

## October 8 Update

Implemented a scaling foundation while preserving Raydium LaunchLab/Jupiter rather than changing to Pump contracts:

- PostgreSQL job queue with batch enqueue before cursor advancement, concurrent `SKIP LOCKED` claims, expiring renewable leases, exponential retries and retained failed jobs. Signature/event writes remain idempotent. This is at-least-once processing, not exactly-once execution.
- Scanner leader election with independently scalable processing workers, bounded concurrency and backpressure that pauses historical work before live scanning. API status now includes pending/processing/failed queue metrics; queued or failed work prevents a complete-history claim.
- Launch transactions are compared with a freshly reconstructed canonical SDK initialization instruction, including reviewed metadata, economics and account identities. Unexpected transfers, extra launches/signers and excessive priority fees are rejected. Launch review displays actual supply, curve allocation, fundraising target and estimated fees.
- Curve trades also enforce canonical authority/configuration/fee-vault accounts and priority/network fee caps. Live sell shortcuts calculate 25/50/75/100 percent from raw integer wallet balances.
- Signed-wallet moderator allowlist, private report review screen, hide/dismiss actions and persistent moderation attribution. Hidden comment evidence is retained privately. Public comments have bounded pagination and a load-older control.
- Curve candles query the latest 24 hours instead of scanning all historical trades on every request; an indexed time window supports that query. This is not yet a pre-aggregated high-volume candle pipeline.
- Migrations `005-indexer-jobs.sql` and `006-moderation.sql` applied successfully to the configured database. No existing application data was removed.

See [SCALE_AND_PARITY.md](SCALE_AND_PARITY.md) for exact rollout settings, remaining engineering work and production acceptance gates. The historical sections below describe the previous revision; this update supersedes their single-worker restriction, missing moderation, missing percentage sells and old test counts.

Verification for this update: 29 unit/API tests, 5 real PostgreSQL tests and 19 browser tests passed; production build passed with existing large-bundle warnings. Browser coverage includes explicit moderator sign-in, escaped report content, hide actions and mobile layout. Funded creation/trading/migration/claims and Pump.fun-scale load tests remain unperformed.

## Changes In This Revision

- PostgreSQL-backed expiring login nonces, hashed bearer sessions and reviewed Jupiter quote authorizations. Nonces and quotes are consumed atomically across instances. IP and community/upload wallet limits are shared across restarts. Local JSON is development-only and not multi-instance safe.
- Dedicated authorization and chain-index migrations: `003-security.sql`, `004-chain-index.sql`. Successfully applied to the configured database. Existing catalogue/community data was not removed.
- Read-only LaunchLab worker with a database advisory lock, finalized-only scans, durable catch-up/backfill cursors and signature/event deduplication. Events are decoded using Borsh and a Raydium IDL pinned to commit `e7e0c96fe77bcf6a020b84a44c47a722aac8e359`.
- Pool owner, discriminator and canonical PDA checks. Only classic SPL/SOL pools enter this index; unsupported quote assets and Token-2022 pools are intentionally excluded from the trading-supported catalogue.
- Indexed discovery endpoint with server-side search/status/offset/limit, index timestamps and incomplete-history/error signals. Live source filters distinguish YeetNest, supported LaunchLab and wider Jupiter market assets. Indexed pagination can fetch beyond the first 100 entries.
- Real indexed curve trades and five-minute SOL-denominated candles. No interpolation, fake USD conversion or fabricated trades. Post-graduation charts continue to use indexed market providers. Intra-slot OHLC ordering is deterministic by signature/event index, not yet the block's transaction order; do not claim tick-perfect candles.
- Graduation filters now require actual migrated status, not merely 100% fundraising progress.

## Verification

| Capability | Implemented | Actual Evidence | Still Unverified/Incomplete |
| --- | --- | --- | --- |
| Signed login/session/one-use execution | Yes | Unit/API tests; real PostgreSQL multi-client atomic consumption and reopen | Render deployment/restart acceptance; no session revocation endpoint |
| Community/profile/watchlist | Existing plus durable authorization | API and browser tests; real PostgreSQL persistence/owner-delete tests | Moderation dashboard and complete discussion pagination |
| Metadata/launch preparation | Existing deadline/recovery work preserved | Controlled upload and timeout tests | Funded creation; complete decoded creation policy and initial buy |
| Curve buy/sell | Existing implementation preserved | Integer/slippage/instruction-tampering tests | Funded acceptance; percentage sell shortcuts and full authority policy |
| Jupiter execution | Existing plus durable quote consume | Message/signature validation API tests | Full route instruction economic policy; funded execution |
| Curve event decoder | Yes | Three actual finalized mainnet transactions decoded, buy and sell | Broader program/version coverage |
| Indexer/cursors | Partial | Controlled interrupted-scan/restart tests | RPC `-32015` encountered; latest retry cycle passed, but no complete global history |
| Indexed storage/candles | Yes | Real PostgreSQL duplicate suppression, normalized candle calculation and stale-update rejection | No claim that a complete real SOL catalogue was populated |
| Source/status filters and SOL chart | Yes | Controlled browser test, including migrating-vs-graduated distinction | Real indexed artwork enrichment; global pagination under changing records |
| Graduation/creator fee claims | Existing implementation | Read-only configuration checks | Approved real migration and funded claim acceptance |

Tests: `npm test` passed 24 tests; PostgreSQL verification passed 4 tests against the configured database; browser suite passed 17 tests; `npm run build` passed with large-bundle warnings. No lint/typecheck script exists. npm audit retains five moderate dependency advisories; the briefly evaluated high-severity decoder dependency was removed.

## Blocking Issues

1. The configured RPC returned `-32015` during several scans. A later one-cycle retry succeeded and cleared the error, so this is not presently a persistent blocker. Backfill remains incomplete and no supported SOL launches were populated during the sampled scan (unsupported quote/program formats are excluded). Investigate recurring provider/version failures, verify sustained progress and populate the supported index before calling discovery complete. Do not skip unknown transactions and mark history complete.
2. The initial-buy creation workflow and complete creation/claim/Jupiter instruction policy are unfinished. They need decoded account/economic constraints, fee caps and partial-result recovery before real funded acceptance. These are engineering work, not environment-variable fixes.
3. No funded create -> buy -> sell -> migration -> claim flow was authorized or executed. The site must not be advertised as end-to-end verified.
4. External metadata/artwork enrichment, independent migration reconciliation, full-history pagination, moderation controls, unique-holder indexing, streaming reconnects and defensible portfolio P/L remain unfinished. Current leaderboards cover loaded token metrics, not trader profits.
5. IP limits now have an atomic PostgreSQL quota and an additional process-local limiter; market caches remain process-local. Load-test database-backed rate limits and configure gateway abuse protection before scaling public traffic. Database connections total up to 24 per web instance plus the worker; budget instances against PostgreSQL capacity.
6. Discovery offset pagination is not a snapshot: concurrent new records can shift pages. Candle ordering within a slot needs block transaction positions for precise open/close. Missing block times are excluded, not guessed.

## Exact Render Setup

1. Commit the reviewed project files and lockfile, then push the branch linked to Render. Do not commit `.env`, wallet keys or seed phrases. These edits have not been pushed/deployed by this agent.
2. At https://dashboard.render.com open the existing YeetNest **Web Service**, then **Settings**. Set **Build Command** to `npm ci && npm run build`, **Start Command** to `npm start`, **Pre-Deploy Command** to `npm run db:migrate`, and **Health Check Path** to `/readyz`. Leave **Root Directory** empty if `package.json` is at the repo root. Do not use `build:hosted`.
3. Open **Environment**. Backend runtime values: `DATABASE_URL` = the same Render PostgreSQL database's internal URL; `SOLANA_RPC_URL` = private mainnet provider endpoint; `JUPITER_API_KEY` = Jupiter-issued key; `PINATA_JWT` = Pinata-issued JWT; `TRUST_PROXY_HOPS=1`; `NODE_ENV=production`. Keep `IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs/`. Render supplies `PORT`; do not set a separate frontend API URL or any secret `VITE_` variable.
4. With Pinata configured, `PUBLIC_BASE_URL` is optional. For self-hosted uploads instead, use the site's public HTTPS origin and a paid persistent disk mounted at `/var/data`, with `DATA_DIR=/var/data`. Do not store production uploads on ephemeral disk.
5. Click **Save, rebuild, and deploy** if offered, or **Save** then **Manual Deploy > Deploy latest commit**. Confirm migration and startup success in **Logs**. If your plan lacks pre-deploy support, run migrations once from an authorized local terminal against that same database before deploying. Do not put migrations in the frontend build.
6. After validating sustained indexing as described in blocker 1, choose **New > Background Worker**, connect the same GitHub repo/branch, use **Node**, same region as PostgreSQL, name `yeetnest-launchlab-indexer`, build `npm ci`, start `npm run indexer`, one instance. Workers incur hosting cost; select and approve a suitable paid plan in Render. Alternatively, the updated `render.yaml` includes this worker declaration.
7. Set worker runtime `DATABASE_URL` and `SOLANA_RPC_URL` to the same values as the web service, `NODE_ENV=production`. Do not set `INDEXER_ONCE`; it is only a local one-cycle diagnostic. The worker needs neither Jupiter nor Pinata keys nor a public port. Apply migrations before its first start (the Blueprint specifies a pre-deploy migration).
8. Monitor **Logs** and `/api/launches/indexed`: require recent `indexedAt`, `indexerError=null`, and a nonempty verified catalogue. `historyComplete=false` is legitimate during backfill. `/readyz` checks process/application schemas, not funded correctness or complete chain indexing.
9. Keep a single worker; the advisory lock also prevents simultaneous indexers. Configure database backups, alerts for indexing lag/errors and provider quota monitoring before opening unrestricted trading.

All named credentials belong in backend runtime. `.env.example` contains only public defaults/empty placeholders. Rotate keys previously exposed in chat or screenshots; do not paste replacements into chat.

## Deployed Acceptance Checklist

1. Open the HTTPS site on a separate desktop and phone. Confirm Demo remains isolated and Live is explicit.
2. Sign in, save a profile/watchlist, restart the web service, and verify the same unexpired session still works. Replaying a used nonce must fail; a second execution attempt must not broadcast again.
3. Verify source filters, server-side indexed search/pages, updated timestamps, truthful empty/error states and actual graduation status. Stop if indexing remains blocked.
4. Inspect real SOL curve history and post-migration USD charts. Check transaction links and reserve amounts against the explorer; acknowledge incomplete backfill.
5. Funded acceptance requires separate explicit approval specifying wallet, maximum total SOL, maximum fees/slippage and whether creation, buy, sell and claim are authorized. Use a disposable wallet. This document does not authorize spending.
6. Once the unfinished instruction-policy/initial-buy work is complete, prepare a minimal launch, verify every reviewed parameter and simulation, reject once, then approve within the agreed budget. Record the actual mint, pool and signature. Repeat clicks must not create another mint.
7. Verify creation confirmation precedes listing; close/reopen during confirmation and recover without automatic rebroadcast. Buy and sell minimal approved amounts, verify chain balances/fees, and test rejection/unknown outcomes. Never simulate success after live failure.
8. Verify migration/claims on an appropriately approved real pool; don't buy out a curve merely to force graduation. No unrestricted production-readiness claim until these checks and an independent security review pass.

References: [Raydium pinned IDL](https://github.com/raydium-io/raydium-idl/blob/e7e0c96fe77bcf6a020b84a44c47a722aac8e359/raydium_launchpad/raydium_launchpad.json), [Render web services](https://render.com/docs/web-services), [Render background workers](https://render.com/docs/background-workers).
