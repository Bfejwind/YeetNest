# MemePop Pump/PumpSwap Rollout

October 9, 2026. Implemented code is not equivalent to audited or funded acceptance. No paid subscription, public deployment or wallet transaction was made by this agent.

## Protocol Change

New launches use the official `@pump-fun/pump-sdk` 4.0.0; graduated trading uses `@pump-fun/pump-swap-sdk` 2.1.0. Standard SOL launches only. Creation produces a Token-2022 mint, with an optional separately approved initial buy after creation. Initial buy is not atomic with creation. Legacy Raydium coin records and Jupiter market trades remain; existing coins are not migrated or relaunched.

Pump curve completion and PumpSwap migration are distinct states. The adapter refuses trades during the gap and only trades the canonical SOL pool after reserves show migration. The current worker indexes Pump curve events, not the full PumpSwap event stream. Unsupported modes and quotes are deliberately excluded rather than silently interpreted as standard SOL coins.

Official protocol sources:
- [Pump public documentation and current SDK releases](https://github.com/pump-fun/pump-public-docs)
- [Pump SDK](https://github.com/pump-fun/pump-sdk)
- [PumpSwap SDK](https://github.com/pump-fun/pump-swap-sdk)

## Deploy

1. Back up PostgreSQL and existing media. Review changes before committing. Do not commit `.env`, provider tokens or wallet secrets. Rotate previously exposed credentials.
2. Push the reviewed branch connected to Render.
3. Web service: build `npm ci && npm run build`, start `npm start`, pre-deploy `npm run db:migrate`, health `/readyz`. Use Node 20.19+; production build/SDK checks were performed locally on Node 20.19.6.
4. Apply migrations through 012 before the web and workers start. If the pre-deploy field is unavailable, use `npm run db:migrate && npm start` for the web pilot. Never edit SQL recorded in `schema_migrations`.
5. Web environment: `NODE_ENV=production`, `TRUST_PROXY_HOPS=1`, private `DATABASE_URL`, `SOLANA_RPC_URL`, `PINATA_JWT`, and existing `JUPITER_API_KEY` for legacy/market tokens. Set `INDEXER_PROTOCOL=pump`. Keep secrets server-only.
6. Existing worker: start `npm run indexer`; same database/RPC, `INDEXER_PROTOCOL=pump`, `INDEXER_ROLE=all`, bounded defaults in `.env.example`. Leave `INDEXER_ONCE` unset. Existing Render worker names containing LaunchLab need not be renamed; changing its environment selects the new protocol.
7. Only add a separate `INDEXER_PROTOCOL=raydium` worker if legacy history needs continued scanning. Its queue, cursor and scanner lock are independent. Account for its additional hosting/RPC/database cost before adding it.
8. Check `/readyz`, `/api/status`, `/api/indexer/status`, Integrations and Creator Studio. Check queue latency and failed jobs; complete archive history is not assumed. The worker reads transaction versions 0 and 1; wallet builders still construct reviewed version-0 transactions.
9. Use a staging HTTPS deployment and a separately approved funded test plan before opening access to real users' funds. No automated funded test is included or performed.

## Cloudflare Broadcast Setup

Cloudflare was selected for a straightforward dashboard-created live input plus managed player. This is a provider integration, not a free hosting promise.

1. Sign in to [Cloudflare dashboard](https://dash.cloudflare.com/). Open your account, then **Stream**, then **Live inputs**. Enable Stream/billing as required by Cloudflare; review charges before accepting.
2. Click **Create live input**, enter the channel/coin name, and create it. Use automatic recording/player settings appropriate to your retention policy. Restrict allowed playback origins to your production/staging hosts when available.
3. Select the input. Copy its **Embed** player URL: `https://customer-CODE.cloudflarestream.com/INPUT_ID/iframe`. Use the live input ID so the same page follows future broadcasts.
4. In Render web service **Environment**, set `CLOUDFLARE_STREAM_CUSTOMER_CODE` to CODE only. Save and redeploy. This code is public, not an API token.
5. In MemePop Live mode, connect/sign in with the registered coin creator wallet. Open the coin, click the video icon **Manage broadcast**, enter that player URL and click **Save broadcast**. The backend checks ownership and the configured Cloudflare hostname. Clear the field and save to remove it.
6. In Cloudflare, give the broadcaster the input's RTMPS server URL and stream key through a private channel. In OBS, open **Settings > Stream**, select **Custom**, enter those private ingest values, and click **Start Streaming**. Never put stream keys in Git, public metadata, chat or the player URL.
7. Check playback on desktop/mobile. Stop the broadcast in OBS. Disable/delete the input in Cloudflare when it must be revoked. Removing the MemePop link does not revoke a previously shared player URL or delete recordings.
8. Cloudflare account administrators currently provision inputs and control costs. Automated per-creator ingest credential provisioning, content takedown workflow, live chat, signed private viewer access and moderation staffing remain unfinished.

References: [Start a live stream](https://developers.cloudflare.com/stream/stream-live/start-stream-live/), [Watch by live input ID](https://developers.cloudflare.com/stream/stream-live/watch-live-stream/).

## Remaining Engineering

These items are not complete and are not solved by configuring Render:

| Feature | Required implementation and acceptance |
| --- | --- |
| Holder rewards | Add explicit permanent-mode consent, verify original creator via confirmed create events, implement eligibility/payout receipts and reward-authority integration; audit and funded tests. Standard launch currently sets holderReward=false. |
| Fee sharing and sweeps | Add canonical curve/pool sweep and sharing-config state validation, exact recipient basis points, one-time locking warnings, distribution/claim receipts and recovery. Pump's distribution configuration can become permanent. Do not enable a partially validated builder. |
| USDC and other quotes | Resolve active quote controls/global enablement, quote token programs/decimals/reserves, quote-specific vaults and creator claims, then prove creation/trade/migration acceptance. No fake USDC mode or SOL-decimal reuse. |
| Advanced modes/orders | Define GO/Mayhem behavior, risk disclosures and supported contracts. Implement expiry/cancellation, durable execution intents, a noncustodial order execution service and adversarial/funded tests. |
| PumpSwap index/reconciliation | Decode finalized AMM events, verify canonical migrated pools, track signed effective quote reserves and fee buckets, reconcile migrations independently and deduplicate cross-protocol events. |
| Complete holders/P&L/rankings | Index token transfers/account ownership and balances; define unique-owner counts, provenance and cost-basis rules; reconcile deposits/transfers and realized/unrealized P&L. Current largest token accounts and loaded-coin rankings are not these metrics. |
| Cross-device recovery | Store authenticated, idempotent intents and reconcile chain signatures before new submissions. Preserve local journals until shared recovery is proven. |
| Live chat/onboarding | Implement bounded chat persistence/fanout/moderation. Select embedded wallet/native onboarding services with wallet-consent/security review; current phone handoff is not remote desktop pairing. |
| Large-scale traffic | Shared caches, scalable replay/fanout, candle preaggregation/partitioning, realistic load/failure tests, CDN/WAF and quota/latency alerts. Current SSE is capped at 100 clients per process. No Pump-scale capacity claim. |
| Legacy Jupiter security | Decode and verify route economics/accounts/programs for supported routers, including auxiliary instructions; reject unsupported routes. Message binding alone is not sufficient. |

## External Release Gates

1. Independent security review of creation/trading/claims, SDK comparison policy, origin/auth controls and account deletion races/retention. Current tests are not a certification.
2. Resolve or formally assess remaining dependency advisories. The tested TOML 4.2.0 override removes Anchor's high-severity advisories; five moderate Solana/Jayson advisories remain. Do not blindly force major upgrades of financial SDKs.
3. Approve a maximum test budget, wallet and fee/slippage caps; run create -> separate initial buy -> sell -> migration -> PumpSwap trade -> collected creator claim. Include rejection, unknown broadcast, expired quote, changed wallet and duplicate-submission cases. Migration may require more liquidity than a tiny test budget.
4. Demonstrate deployed HTTPS desktop/mobile behavior, private-key-free wallet signing, provider outages, server/worker restarts, database backup restore and bounded abuse handling.
5. Set provider spending limits/alerts, archival RPC coverage, backups and staffing. Adopt a reviewed privacy/content/terms policy. App deletion retains public chain/coin/IPFS records, moderation reports and provider backups until retention expiry.

There is no valid way to label all remaining work complete using local tests alone. Use this checklist to track separate engineering work and externally verified release gates.
