# MemePop Implementation Status

Chart update (October 9): `CHART_SYSTEM.md` supersedes the chart/indexing limitations below. The worker now scans canonical SOL PumpSwap trades, migration 013 stores one-minute OHLCV, and Pump token charts use local history after graduation. USD uses observed minute rates (no retroactive FX invention); FDV uses issued supply. Archive completeness, exact same-slot ordering, shared multi-replica quotas and capacity certification remain unverified. Latest chart checks: 49 unit/API tests, 8 PostgreSQL tests, 3 live-only browser tests, a bounded worker cycle and read-only PumpSwap verification. Historical demo-mode UI tests are not the live-only acceptance suite.

October 9, 2026. Local implementation and verification, not deployment or production readiness. At the user's request, new launches now use Pump and graduated trades use canonical PumpSwap pools. Existing Raydium/Jupiter coins and recovery records remain supported. See `PUMP_ROLLOUT.md` before deploying this protocol change.

## Completed Code

- Wallet connection: injected wallets, Wallet Standard, Solflare web and mobile wallet-browser handoff. Phone QR is not desktop pairing.
- Identity: signed one-use challenges, hashed durable sessions, shared quotas and logout revocation.
- Artwork: creator uploads, bounded PNG processing and public metadata references. Updates affect the MemePop listing, not original on-chain metadata.
- SOL launch: official pinned Pump SDK create_v2, standard SOL curve, Token-2022 mint, reviewed configuration, local instruction/message binding, fee cap, simulation, signing and listing recovery. No funded launch acceptance has been performed. Legacy Raydium builder is preserved.
- Optional initial buy: separate purchase after confirmed creation, fresh quote and separate wallet approval. Amount/slippage and signatures persist locally; rejection does not undo coin creation. Creator Studio resumes/rechecks purchases; unknown signatures block another buy. Skip cancels an unsubmitted intent.
- Curve trading: Pump SOL buys fix the maximum SOL input and minimum token amount; sells fix token input and minimum SOL output. Local SDK instructions, fee caps, canonical curve ownership, simulation and wallet/message binding are enforced. Existing classic SPL/SOL Raydium policy remains available. Percentage sells use raw balances.
- Graduated trading: canonical SOL PumpSwap pool, official SDK pricing including signed virtual reserves and fee buckets, bounded inputs/minima and simulation. Legacy market tokens still use Jupiter; its full decoded route economic policy remains unfinished.
- Creator claims: protocol selector supports collected Pump/PumpSwap SOL-equivalent fees and legacy Raydium claims. Pump pays SOL, PumpSwap deposits WSOL; user token accounts are not closed. Unswept fee buckets and fee-sharing distributions are not included.
- Indexing: finalized Pump Create/Trade/Complete events, canonical curves, durable cursors, event deduplication and incomplete-history status. Read-only transactions support Solana versions 0 and 1. Set INDEXER_PROTOCOL=pump (default), or raydium for a separate legacy worker. PumpSwap event indexing/migration reconciliation remains unfinished.
- Worker queue: leases, parallel processing, scanner election, backpressure, retries, failed-job tools and heartbeat visibility.
- Market updates: bounded PostgreSQL-backed SSE refresh notifications with event IDs, replay/reset, backpressure and browser debounce. Not tick-perfect trade streaming or Pump-scale fanout.
- Charts: bounded 24-hour indexed SOL candles; market-provider charts after migration. No fabricated/interpolated history; intra-slot order is not exact block transaction order.
- Social: profiles, watchlists, follows/unfollows, paginated following/discussions, private reports, owner comment deletion and signed-wallet moderation with private history.
- Account-data deletion: wallet-address confirmation; PostgreSQL transaction clears profile/comment content/follows/watchlist/upload references and wallet sessions. Public coin/blockchain/IPFS records, moderation reports and provider backups are retained. Development JSON fallback clears profile/comments/follows/watchlist; production privacy/backup policy still requires operator review.
- Metadata: lazy external description/artwork through approved IPFS/Arweave gateways, no redirects, 64 KB JSON limit, five-second request deadline, four concurrent fetches, bounded 500-entry cache and 15-minute expiry. Unsupported artwork falls back to an avatar; no arbitrary-host fetching.
- Broadcasts: creator-only Cloudflare live-input player configuration, removal and responsive playback on coin detail. Uses dashboard-provisioned inputs; no ingest keys or paid API provisioning are exposed in the app. Not a realtime chat service.
- Shared catalogue: per-coin PostgreSQL rows, owner-qualified image updates, per-wallet transactional watchlists and expiring upload references. Verified imports preserve existing records. Legacy JSON fallback remains development-only.
- Discovery: filter-bound keyset cursors with lookahead, so newly inserted launches do not shift subsequent pages. Not a frozen snapshot; late historical backfills can still appear.
- Schema upgrades: advisory-locked migration ledger with checksums and one-time legacy catalogue backfill. Do not edit applied SQL migrations; add new migrations.
- Recovery: local transaction journal, status rechecks, listing recovery and initial-purchase recovery. Cross-device intents remain unfinished.

## Verification

43 unit/API tests, 8 real PostgreSQL tests and 22 browser tests passed across the latest verification runs; production build passed with large-bundle warnings. Pump SDK browser loading/instruction construction, reviewed buy budget/sell minimum, fees, wallet changes, spoofed events, metadata bounds, follows and deletion were checked. Read-only mainnet Pump global configuration and a bounded worker cycle passed; live TradeEvent decoding was observed. Migrations through 012 were applied. No funded transaction, public deployment, broadcast-provider purchase or independent audit was performed. `npm audit --omit=dev` still reports five moderate advisories in the existing Solana/Jayson dependency path; Anchor's high-severity TOML advisories were addressed with a tested 4.2.0 override.

## Deploy And Operate

1. Review/commit and push the linked Render branch. Never commit secrets, seeds or wallet private keys.
2. Web: build `npm ci && npm run build`, start `npm start`, pre-deploy `npm run db:migrate`, health `/readyz`.
3. Keep database, RPC, Jupiter and Pinata settings server-only. Rotate exposed credentials. Set `TRUST_PROXY_HOPS=1` on Render.
4. Worker: `npm run indexer`; same database/RPC as web. Set `INDEXER_PROTOCOL=pump` on both web and worker. A separate legacy worker may use raydium. Keep bounded defaults from `.env.example`; leave `INDEXER_ONCE` unset.
5. Monitor `/api/indexer/status`. `jobs.workers` lists heartbeats received within 90 seconds. Watch scan age, queue delay/failures, provider quotas and incomplete history.
6. Authorized backend terminal: `npm run indexer:jobs -- failed` lists up to 100 oldest failures. Fix the cause, then `npm run indexer:jobs -- retry <signature>`. Only failed jobs are retried.
7. `npm run indexer:jobs -- prune` removes up to 1000 completed jobs older than seven days. Worker cleanup is hourly and bounded; a large backlog needs additional maintenance.
8. Set `MODERATOR_WALLETS` to public addresses, connect that wallet in Live mode and sign in from Moderation.
9. Disable proxy buffering for `/api/market/events`. Limits: 100 stream clients per process, 5 per IP. These are refresh notifications, not full market snapshots.

## Still Unfinished

Engineering work:
- Independent Pump/PumpSwap signing/economic-policy audit, additional PumpSwap adversarial coverage, and full legacy Jupiter route policy.
- PumpSwap event indexing, independent migration reconciliation and comprehensive archive-backed history. Registered catalogue reads are bounded; global creator/ranking aggregation remains unfinished.
- Complete archive-RPC backfill and broader supported quote/program coverage.
- Unique-holder indexing, accurate portfolio/trader P/L, global rankings and pre-aggregated candles.
- Shared caches and high-capacity streaming/fanout.
- Cross-device transaction/purchase intents, staffed moderation, privacy/backup-retention policy and deployment abuse protection.
- Holder rewards, fee sharing/sweeps/distribution, USDC launches, advanced modes/orders, realtime livestream chat and native onboarding. These remain engineering work, not environment switches.

External acceptance gates:
- Explicitly authorized, small-funded create -> initial buy -> sell -> migration -> claim tests, with rejection/unknown-outcome cases and a spending/fee/slippage cap.
- HTTPS desktop/mobile deployment, backups/restore and restart acceptance.
- Sustained load/failure tests, RPC quotas, alerts, CDN/WAF protection and capacity planning. Pump.fun-scale throughput is unproven.

See `SCALE_AND_PARITY.md` for architecture and remaining work. More functionality is implemented, but full Pump.fun parity and unrestricted production readiness are not claimed.
