# Pump.fun Coverage And Production Plan

Assessment date: October 2, 2026. This is a public-feature assessment, not a claim of full parity or an audit of Pump.fun's private systems. Navigation and public protocol documentation were inspected. Logged-in/mobile/region-specific behavior needs separate acceptance testing. YeetNest is independently branded and is not affiliated with Pump.fun.

## What Works Now

- Public online demo with dark neutral surfaces and mint-green accents.
- Coin discovery/search, watchlists, creator-uploaded demo artwork, demo launches and simulated buy/sell accounting.
- Terminal with new-pair, approaching-graduation and graduated columns; filtering and token detail navigation. Its stages use available curve progress, not a protocol-wide indexer.
- Token leaderboard sorted by loaded volume, capitalization or price change. This is not a trader profitability leaderboard.
- Browser-local profile and coin discussion with escaped text, deletion and local reports. These are explicitly demo-only, not shared community features or operational moderation.
- Node backend: signed-wallet shared profiles and comments, owner-only comment deletion, rate-limited writes and private recorded reports. A PostgreSQL adapter and initial migration are implemented; the database has not been provisioned or integration-tested. Without a database URL these use single-process durable JSON. Reports do not have a moderator dashboard or operator service.
- In the Node-server version: Phantom/Solflare, balance reads, Raydium SOL launch/curve transactions and fee claims, Jupiter swaps, public metadata uploads, pool registration, indexed market candles and wallet history. Real funded acceptance testing remains outstanding.

The published Sites build deliberately does not contain the mainnet SDK or connect to the Node API. Real transactions are not enabled merely because the website is public. The existing launch engine is Raydium, not Pump/PumpSwap.

## Hosting And Data

You need a continuously hosted backend for shared sign-in, user content, uploads, token registration, indexing, moderation and provider-key protection. Render is one option; a VM or compatible managed Node host also works. The static demo does not need a Node server and stays online independently of your computer.

For a real multi-user launchpad, use PostgreSQL for app-owned data. Solana remains authoritative for token ownership, balances, program state and transaction settlement. Cache/index chain data in the database but never treat an edited database balance as spendable money.

Suggested records: users (internal ID, display name, bio), wallets (unique public key, linked user), challenges (nonce hash, expiry, used-at), sessions (hashed token, expiry, revoked-at), coins (mint, program, creator, metadata URI, pool), upload references, comments, follows, watchlists, reports, moderation actions, streams, fee receipts, trades and indexing checkpoints. Enforce foreign keys, unique constraints, authorization and indexes. Store integer token amounts as decimal strings or sufficiently wide NUMERIC fields; do not use floating-point money. Only wallet profiles, comments and reports currently have a PostgreSQL adapter/schema; the remaining entities are still recommendations.

Store images/video in object storage or a metadata provider, not database blobs or ephemeral service folders. Store secrets in hosting environment variables. Never collect wallet seed phrases/private keys. Do not collect real names, addresses, email or other personal data without a product need and appropriate privacy controls. Wallet addresses and activity can still identify people; limit logs, retention and staff access.

The current JSON catalogue with a persistent disk is a single-instance pilot only. Shared profiles/comments are implemented in the Node API, but sessions, catalogue writes and rate limits are not multi-instance safe. An event indexer is still missing. Render's default filesystem is ephemeral; an unmounted `data/` folder is not durable.

## Concrete Next Steps

### 1. Deploy The Existing Node App

1. Put the selected source revision in a repository accessible to your hosting account. Do not commit `.env`, `data/`, provider settings or credentials.
2. Create a Render Node Web Service. Build: `npm ci && npm run build`. Start: `npm start`. Do not use `build:hosted`: it intentionally disables the backend.
3. For the current pilot, use one service instance, mount persistent storage at `/var/data`, and set `DATA_DIR=/var/data`. The added `render.yaml` is an optional pilot blueprint, not an already provisioned service.
4. Set `SOLANA_RPC_URL`, `JUPITER_API_KEY`, and either `PINATA_JWT` or `PUBLIC_BASE_URL` in Render. Use the actual deployed HTTPS origin for self-hosted metadata. Production local-setup routes are disabled.
5. Verify `/healthz`, `/readyz`, provider checks, public artwork/metadata, wallet connection and all acceptance flows. Point a domain to the hosting service if desired; the provider URL can work without buying one.
6. Budget for production hosting and provider usage. The configuration does not purchase hosting or create accounts.

### 2. Add PostgreSQL And Migrate Persistence

1. Provision managed PostgreSQL in the backend's region. Add its connection string as a server-only `DATABASE_URL`, with TLS and connection pooling appropriate to the provider.
2. Run `npm run db:migrate` with `DATABASE_URL` configured to install `server/migrations/001-community.sql`. Start the normal Node build and test shared profile/comment persistence with two wallets. No real PostgreSQL instance has been exercised yet. The initial migration is idempotent; future schema changes need new versioned migrations. Existing JSON community data is not imported automatically: back it up and explicitly validate/import it before switching.
3. Add migrations for the remaining entities above; separate authentication records from public profiles and add uniqueness on wallet keys, mint addresses, signatures and event indices.
4. Replace filesystem catalogue writes/upload references and in-memory sessions/challenges with parameterized database operations. Use transactions and row locking for multi-step writes; attaching a database URL only switches community storage, not the whole app.
5. Import existing confirmed catalogue records, verify creator ownership on-chain, and reconcile metadata. Keep a backup of the JSON files during migration.
6. Test concurrent writes, duplicate/replayed requests, revoked sessions, ownership changes, retention and rollback. Establish encrypted backups, restore drills and least-privilege database roles.

### 3. Shared Identity, Profiles And Social Features

1. Retain signature-based wallet login with origin/domain-bound expiring nonces, one-time use and explicit sign-in messages. Add Wallet Standard/mobile coverage.
2. Link each validated public key to a user record; require a second verified signature to link another wallet. Add session revocation and account export/deletion.
3. The Node version implements authenticated profiles and discussions with session-derived ownership. Add synced watchlists, follows, account linking and export/deletion. A typed display name is not proof of identity.
4. Move browser-local demo content only with an explicit user import action. Add server-side text validation, pagination, spam limits, reporting, blocking and moderator roles.
5. Test with two separate browsers/accounts to confirm actual shared state, privacy and unauthorized edit rejection.

### 4. Pump Protocol Creation And Trading

1. Decide whether YeetNest remains an independent Raydium launchpad or becomes an interface to Pump's official programs. These are different products; Raydium transaction builders cannot simply be renamed Pump.
2. For Pump integration, pin a reviewed official SDK/IDL revision, verify program IDs/owners and current network configuration, and implement creation, buy/sell, mint/pool decoding and migration with current account layouts.
3. Verify SOL and USDC pairing support against current deployed program state. Handle quote decimals, token account initialization, Token-2022 where applicable, metadata and immutable mode decisions.
4. Obtain chain-derived fee/economic previews, expected output, slippage bounds, network/rent costs and explicit wallet review. Rebuild/re-simulate stale quotes rather than silently changing the signed transaction.
5. Test rejected signatures, insufficient funds, expired blockhashes, duplicate submissions, program upgrades, partial creation/initial-buy outcomes and confirmations with an operator-controlled funded wallet.
6. Do not copy historical fees or quote assumptions. Current public docs include evolving holder-reward flags and signed virtual quote reserves; use the current SDK/IDL rather than implementing old unsigned reserve arithmetic.

### 5. Full Discovery, Charts, Holders And Graduation

1. Provision a reputable RPC/indexing service with websocket/webhook or transaction-stream access and sufficient quota.
2. Run a separate indexer worker. Verify program-owned events; save signature plus event index uniquely, finality status and a durable checkpoint.
3. Backfill historical launches/trades, handle retries/reorganizations, reconcile pool states and mint supply, and track actual migration destinations.
4. Aggregate trade candles by interval, holders/concentration and liquidity. Define how bots, dust, transfers and missing prices affect analytics; do not present unpriced holdings as zero value.
5. Serve paginated discovery and realtime updates over SSE/websockets, with reconnect cursors and stale-data indicators. The current 60-second polling is not a tick feed.

### 6. Leaderboards And Trader P&L

1. Define ranking windows, eligible assets, valuation sources, realized/unrealized P&L, transfer accounting and exclusion policies.
2. Reconstruct positions from indexed trades and transfers, not just current wallet balances. Account for fees, missing cost basis and external transactions.
3. Materialize rankings in PostgreSQL, cache popular queries, expose methodology and test against known wallets. Keep the existing token-metric ranking separate from trader performance.

### 7. Creator Fees, Sharing And Ownership Changes

1. Use the chosen protocol's actual creator-vault and fee-sharing contracts. Validate recipient keys, shares, fee-owner authority and allowed update paths.
2. Add reviewed claim/configuration transactions and prevent signing on a changed account or expired preview.
3. Index accrual/claim/distribution receipts for revenue history. Show quote denomination and distinguish wrapped SOL from native SOL.
4. Test split recipients, ownership changes, duplicate claims, missing accounts and rejected signatures. A database percentage cannot enforce an on-chain fee split.

### 8. Holder Rewards And Legacy Cashback

1. Select the supported reward mode at creation and verify protocol rules. Pump's current public docs deprecate creation of new cashback coins; do not advertise it as a new launch option.
2. For official Pump rewards, implement current flags/status and supported reward access/claim surfaces. Do not promise control over payouts managed by Pump.
3. For independent YeetNest rewards, design eligibility, snapshots, budgets, custody, claim proofs and audited contracts before implementing any scheduler.
4. Index entitlements and payout receipts, prevent duplicate claims and test dust, transfers, late joins, failed payouts and operator recovery. Commission independent security review.

### 9. Initial Buys, Advanced Trading And Orders

1. Add explicit optional initial-buy previews using the selected SDK, with supply/fees/slippage and honest sequential-versus-atomic transaction semantics.
2. Implement failure recovery so a successful creation is not lost when a subsequent buy fails. Require a separate confirmation for changes to buy size.
3. For limit/stop orders or one-click execution, select a supported execution provider/delegation model, bound permissions and document custody/revocation.
4. Add idempotent job handling, cancellation, expiry, execution receipts and stress tests. Never store a wallet seed phrase to make unattended trading easier.

### 10. Livestreams, Chat And Safety

1. Provision a video service for ingest/transcoding/playback; issue short-lived stream keys only to authenticated creators.
2. Add stream/session metadata and chat persistence, presence, message pagination and realtime fan-out. Budget for video egress and connection concurrency.
3. Build reporting, blocklists, age/region controls where appropriate, moderator tooling, takedown workflows and retention rules before opening broadcasts.
4. Test stream interruptions, token expiry, viewer scaling and abuse. Human moderation/on-call staffing is an operational requirement, not something a static UI supplies.

### 11. GO, Mayhem, Charity And Platform-Token Features

1. Obtain authoritative product/protocol specifications and confirm which functionality a third-party interface can access. Visible navigation is not enough to reproduce private backend behavior.
2. For special launch modes, integrate only supported deployed instructions/configurations and show their real risk/economics. Do not invent simulations and label them production modes.
3. For charity routing, verify beneficiaries, approval/permission flows and settlement receipts; obtain appropriate legal/accounting review before soliciting donations.
4. A YeetNest platform token, treasury, buybacks or staking would be a separate contract/economic product, not a copy of $PUMP. Define governance/authority, independently audit contracts and publish verifiable receipts.

### 12. Mobile, Payments And Onboarding

1. Add Wallet Standard and tested mobile wallet deep links, or a reputable embedded non-custodial wallet provider with documented recovery/security behavior.
2. A native mobile app needs its own app-store releases, signing, deep-link configuration and device testing; the responsive site is not a native app.
3. If fiat purchases are required, integrate an approved on-ramp provider, signed webhooks and provider-required compliance flows. Do not store card data in YeetNest.

### 13. Production Hardening And Launch Gate

1. Add distributed rate limiting/cache/queues (Redis-compatible service), object-storage quotas and image moderation. Avoid assuming a single process's in-memory limiter protects multiple instances.
2. Add error monitoring, tracing, provider-budget alerts, indexing-lag alarms, backups, restore drills and an incident runbook.
3. Complete dependency review, penetration testing, wallet-transaction review and independent contract/security audits for new contract behavior.
4. Obtain appropriate jurisdiction-specific privacy, terms, financial-product and content-moderation review. Deploy operator-approved policies rather than copying Pump's legal text.
5. Require successful funded launch/buy/sell/claim/graduation acceptance tests, shared-account tests and recovery/load tests before calling the site a production launchpad.

## Sources

- Pump public website: https://pump.fun/
- Pump official protocol/SDK documentation: https://github.com/pump-fun/pump-public-docs
- Pump current fees: https://pump.fun/docs/fees
- Render service types: https://render.com/docs/service-types
- Render persistent disk behavior: https://render.com/docs/disks
- Render PostgreSQL: https://render.com/docs/postgresql

The implementation sequence above is an engineering plan for YeetNest, not an assertion that Pump's private infrastructure uses these exact services.
