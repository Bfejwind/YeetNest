# YeetNest Audit Action Guide

Date: October 7, 2026. This translates every remaining-work item and manual check in AUDIT_REPORT.md into an ordered workflow. It does not claim that unfinished engineering has been implemented. No deployment, service purchase or mainnet spending is authorized or performed by this document.

## Read This First

- Operator task: you can do it in VS Code, a service dashboard or the website.
- Engineering task: application changes, tests and review are required. An environment variable alone cannot complete it.
- Funded test: moves real SOL/tokens and may incur irreversible fees. Requires a separate explicit budget/approval. Do not share wallet seed phrases or private keys.
- Keep Raydium LaunchLab as the current architecture unless you deliberately choose a separate Pump integration. Renaming the interface does not change contracts or who receives protocol fees.
- Deploying online is not certification for unrestricted public trading. Do not invite public deposits/trading until security and funded acceptance gates pass. The current app has no built-in private-beta access gate; an obscure URL is not access control.

## Coverage Map

| Audit report remaining-work item | Guide section | Owner |
| --- | --- | --- |
| 1. Deploy revision | 1-4 | Operator |
| 2. Real acceptance | 5, 10-12 | Operator plus blockchain reviewer |
| 3. Full transaction policy | 6 | Blockchain engineer/security reviewer |
| 4. Blockhash/idempotency recovery | 7 | Backend/blockchain engineer |
| 5. Creation initial buy | 8 | Blockchain/frontend engineer |
| 6. Indexer | 9 | Backend/blockchain engineer plus operator |
| 7. Shared auth/quotas | 13 | Backend engineer plus operator |
| 8. Storage/moderation | 3, 14 | Operator/backend engineer |
| 9. Operational hardening | 15 | Operator/engineer/security reviewer |
| 10. Pump-only features | 16 | Product owner/blockchain engineer |
| 11. Optional systems | 17 | Product owner and relevant engineers |

Recommended order: setup/deploy -> non-funded verification -> transaction policy/recovery -> approved funded acceptance -> indexing/operations -> optional parity features. Before unrestricted public access, finish all applicable security, indexing and operational gates. Keep one server instance until section 13 passes.

## 1. Secure Credentials And Prepare The Repository

1. Rotate previously exposed Helius/RPC, Jupiter and Pinata credentials in their respective dashboards. Update local `.env` and Render independently. Revoke the old credentials after confirming replacements work; avoid leaving both active indefinitely.
2. In VS Code, open the terminal at `C:\UnityProj\YeetNest`.
3. Run these read-only Git checks separately:

```powershell
git status --short
git check-ignore .env data/provider-settings.json
git ls-files .env
```

4. The ignore check should list `.env` and provider settings. `git ls-files .env` should produce no path. This does not certify that secrets were never committed in past history. If secrets were committed, revoke them first and arrange a reviewed history cleanup; deleting the latest file is not enough.
5. Run local checks separately:

```powershell
npm ci
npm test
npm run build
```

6. For browser tests, keep a local Vite server running in one terminal with `npm run dev -- --port 5174`. In another terminal run `npm run test:ui`. The current configuration requires installed Microsoft Edge. If port 5174 is occupied by the existing YeetNest server, reuse that server rather than launching another app on a different port without updating the test configuration.
7. In Source Control review and stage relevant code, tests, docs, migrations, `.env.example`, `package.json` and `package-lock.json`. Do not blindly stage all files: leave `.env`, runtime data, credentials and unnecessary screenshots out.
8. Commit and push the branch Render actually uses. Compare the GitHub commit with Render's service branch/settings. Do not assume it is `main` without checking.

Pass: tests/build pass, intended commit is on GitHub, no secrets staged. These commands do not deploy or spend funds.

## 2. Configure PostgreSQL And Render

1. Open Render > your PostgreSQL database. Confirm it is available, its region matches the web service, and you have a backup/recovery arrangement. Use a suitable paid database for durable production operation; review your actual plan's retention/expiry terms.
2. Obtain the database's Internal Database URL for the Render service. Use the External Database URL only for authorized local access where needed. Keep both private.
3. Open Render > YeetNest Web Service > Environment and enter:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `TRUST_PROXY_HOPS` | `1` for the expected single trusted Render reverse proxy |
| `DATABASE_URL` | Database connection string from step 2 |
| `SOLANA_RPC_URL` | Your provider's Solana mainnet HTTPS RPC URL |
| `JUPITER_API_KEY` | Your rotated Jupiter API key |
| `PINATA_JWT` | Your rotated JWT with public file upload access |
| `IPFS_GATEWAY` | `https://gateway.pinata.cloud/ipfs/` or your verified compatible gateway |
| `DATA_DIR` | `./data` for PostgreSQL + Pinata |

4. Let Render supply `PORT`. No `VITE_` secret, wallet secret or separate browser API host is required. Local `.env` does not upload itself to Render. Production setup is through server environment variables, not the website's disabled local setup form.
5. Open Settings. Runtime Node; Root Directory blank when package.json is at repository root; Build Command `npm ci && npm run build`; Start Command `npm start`; Health Check Path `/readyz`; one instance.
6. Paid service: Pre-Deploy Command `npm run db:migrate`. Free pilot without that field: Start Command `npm run db:migrate && npm start`. Never use `build:hosted` for this service. Migrations create both `001-community.sql` and `002-app-records.sql` tables.
7. Preserve/import old data before switching storage if necessary; follow section 3. Then save settings and select Manual Deploy > Deploy latest commit.
8. Inspect logs. Expect application migration completion and server startup. If `relation ... does not exist`, confirm the migration ran against the exact database used by the service; do not delete/recreate the database as a shortcut.
9. Verify Render shows the intended commit. Restarting the old commit is not deploying the new commit.

Pass: latest intended revision is live and readiness succeeds. Render controls hosting independently of your computer. Pre-deploy availability and deploy controls: [Render deployments](https://render.com/docs/deploys).

## 3. Durable Media And Existing Data

1. For the simplest current configuration use PostgreSQL for app data and Pinata for images/metadata. In Pinata create/rotate credentials with the permissions required by its public file upload API; restrict privileges where supported. Put the JWT only in Render/local server settings. [Pinata upload documentation](https://docs.pinata.cloud/files/uploading-files).
2. Self-hosted media alternative: provision a persistent disk, mount `/var/data`, set `DATA_DIR=/var/data` and `PUBLIC_BASE_URL=https://yeetnest.onrender.com`. Existing media URLs must remain served. A public URL alone does not preserve files.
3. If there is old JSON data, securely back up `coins.json`, `upload-references.json`, `community.json` and any `public/` media before switching or redeploying an ephemeral service. Provider settings may contain secrets; never put the backup in Git/public storage.
4. Point local `DATA_DIR` in `.env` at the trusted export. Configure the destination database URL privately. Back up that database too.
5. Run the read-only catalogue check:

```powershell
npm run db:import-catalogue
```

6. Check that the reported coin/reference counts match your export. It checks mainnet pool ownership. An unexpected zero count means stop and confirm the export folder; do not assume old records were migrated.
7. After reviewing and approving the import, run:

```powershell
npm run db:import-catalogue -- --apply
```

8. This writes missing catalogue/upload records, does not overwrite existing records, and does not submit blockchain transactions. The command is not a community importer: a developer must map community JSON into the existing profile/post/report tables, preserve IDs/ownership, use parameterized SQL and test duplicates/rollback against a restored test database first.
9. Keep originals until database records and public media URLs have been verified. Restoring PostgreSQL cannot restore missing self-hosted image files.

Pass: coin/reference records persist after app restart; anonymous media links still work. Automatic import or automatic cross-device transaction-journal migration is not implemented.

## 4. Public Readiness And Diagnostics

1. Open `https://yeetnest.onrender.com/healthz`; expect process status `ok`.
2. Open `/readyz`; expect `ready: true` and scope `process-and-application-storage` for this revision.
3. Open `/api/status`; expect `mainnet-beta`, configured providers, `communityStorage: postgres` and `catalogueStorage: postgres`. Status says configured, not financially verified.
4. Open the website > Integrations > Test connections. RPC must identify mainnet; Jupiter must respond; Pinata auth and application/community schema checks must succeed.
5. Open the HTTPS website on another laptop and a phone. In desktop Developer Tools > Network, verify requests go to the same Render origin under `/api/`, not localhost or ChatGPT Sites. Failed requests should show unavailable/error states.
6. Verify desktop and narrow mobile layouts have no horizontal overflow or overlapping controls. Record browser/version, commit and screenshot when reporting failures.

Pass: public frontend/API reach the intended revision; diagnostics pass. Provider checks do not upload a real file or prove trading.

## 5. Non-Funded Wallet And Community Checks

1. On the HTTPS site choose Live > Connect wallet. Test Phantom/Solflare in an enabled extension, then Solflare Web without relying on an extension. The latter still needs genuine provider-managed approval; a mocked test does not verify it.
2. Test phone QR handoff. It must open YeetNest in the phone wallet browser; the desktop must not pretend that phone approval connected it remotely.
3. Reject connection and message-signing requests once. No success or protected write should occur.
4. Connect wallet A. Open Profile, save a harmless name/bio, and approve only the explicit sign-in message. It is not a transaction and should not require a blockchain fee.
5. Save a watchlist coin, navigate to Watchlist and use Sync watchlist. Add/delete a harmless comment on a live token.
6. Open a second browser with wallet A, sign in and sync. Confirm profile/comments/watchlist are shared. Do not export wallet seed phrases to accomplish this; use supported wallet access under your own control.
7. Connect wallet B. It must not edit wallet A's profile or delete its comment; watchlists must be isolated. A developer should repeat these checks at the API level, not just rely on hidden buttons.
8. Switch/disconnect accounts and verify old holdings/protected session clear. Restart Render and confirm sign-in is required again while app records remain.
9. Prepare a live creation form and upload harmless artwork. Inspect the `/api/metadata` response in Developer Tools; open its public image/metadata URLs in an anonymous browser. This consumes upload-provider quota but should not create a token. Preparing may fail simulation when the wallet cannot cover required costs.
10. Do not click Sign and launch yet. Where a wallet transaction preview is reachable, reject it and verify no launch success is displayed. Already-uploaded metadata may remain stored even though you reject a launch.

Pass: real connection/message approval, privacy/ownership and public media work. Financial transactions remain unverified.

## 6. Complete Transaction Policy (Engineering Required)

1. Review `src/chain.js`, `src/transaction-validation.js`, `server/api.js` and the exact SDK/IDL revision. Inventory launch, curve buy/sell, claim and each Jupiter router supported by the deployment.
2. Resolve all address lookup tables before reviewing/signing. Decode each instruction with the corresponding supported layout; an allowlisted program ID alone is insufficient.
3. For each operation define permitted programs/instruction types, payer/signers, mints/token programs, canonical vaults/PDAs, wallet-owned accounts, output recipient, authority behavior and allowable ancillary instructions.
4. Bind raw input, min output/max spend, fee/rent/priority caps and slippage to an immutable review object. Reject any mismatch, hidden approval/delegation, unexpected account close destination or unsupported router/instruction.
5. Apply policy before requesting any wallet signature. Keep the after-sign message and signature checks too; those checks only detect a changed message, not a malicious original quote.
6. Add malicious fixtures: altered amount/minimum, substituted recipient/vault/mint, excessive transfer/compute fee, foreign fee payer, stale/missing lookup table, authority changes and unexpected routes. Verify no signing prompt opens for rejected fixtures.
7. Validate actual SDK-generated creation/claim/curve and allowed Jupiter transactions against policy; do not only test a hand-constructed fixture.
8. Obtain independent Solana security review. Fix findings, rerun tests and record the reviewed commit/SDK revision. This is a production gate, not a Render setting.

Pass: all enabled financial paths have tested deny-by-default policies and review sign-off. Current curve checks are a starting point; current creation/claim/Jupiter policies do not meet this complete gate.

## 7. Durable Transaction Recovery (Engineering Required)

1. Add versioned migrations for wallet-scoped transaction intents, attempts/signatures, operation/mint/pool, reviewed amounts, blockhash/last-valid-block-height, timestamps and state. Store raw quantities as decimal strings/NUMERIC, not floats; never store private keys.
2. Enforce unique intent IDs and signatures. Use database transactions/locks to admit one in-flight attempt per intent. Bind authorization and review hash to the intent.
3. Persist an intent before signing and signature/blockhash information before broadcast. Review privacy and retention before storing signed transaction payloads; they must not be logged or exposed publicly.
4. Reconcile submitted/unknown outcomes with signature history and finalized chain data. Missing status is not failure. Check expiry using appropriate block-height/commitment semantics and history reconciliation; do not permit a replacement solely because a timer elapsed.
5. Model partial multi-transaction creation explicitly. Resume listing/recovery without making a second mint or assuming every step succeeded.
6. Add wallet-authorized cross-device recovery API/UI. Preserve the existing browser journal as a convenience, not the sole authority.
7. Test simultaneous clicks/requests, reconnects, restart after broadcast, missing provider response, failure, definitive expiry and partial creation. Replay must not double-submit; unknown must not become success.

Pass: restart/cross-device recovery and global idempotency tests pass. Current Portfolio > Recheck is limited to signatures saved in that browser.

## 8. Initial Purchase At Creation (Engineering Required)

1. Confirm current pinned Raydium SDK supports the intended create-plus-buy mode against the actual SOL configuration. Keep zero/None as the existing default.
2. Add an optional raw SOL amount input and slippage selector; validate affordability including fees/rent. This is code, not an environment variable.
3. Build/quote through the supported SDK. Decode and bind the initial buy to mint, wallet, max debit and minimum output using section 6's policy.
4. Preview launch economics, transaction count and initial-purchase outcome. Simulate dependent transactions correctly; separate simulation against an uncreated pool can be misleading.
5. Persist the intent/mint before signing and handle partial/unknown outcomes using section 7. Do not replace failed/unknown purchase with an automatic new launch.
6. Test no-buy, invalid/insufficient amount, wallet rejection, slippage failure and partial/unknown results with fixtures/local compatible program state before funded acceptance.

Pass: initial purchase is a verified on-chain operation; neither a database token balance nor an unexplained transfer substitutes for it. Current UI intentionally shows None.

## 9. Chain Indexer And Worker (Engineering + Provider Setup)

1. Decide scope: YeetNest-registered LaunchLab assets first, or protocol-wide discovery. Estimate history length, traffic and provider cost before buying subscriptions.
2. Choose a provider with sufficient mainnet historical RPC and streaming/webhook support. Helius documents webhook delivery, but do not assume it decodes every LaunchLab instruction or provides lossless program-wide indexing automatically. [Helius webhooks](https://www.helius.dev/docs/webhooks).
3. Add tables for verified launches/pools, events/trades, finality, checkpoint/cursor, candle buckets and migration destinations. Uniqueness must include signature plus event/instruction index.
4. Implement a worker that independently fetches/verifies transactions, program owners/discriminators/mints, and chain amounts. Authenticate webhook ingress if using it. A webhook notification is a signal to verify, not a database balance authority.
5. Implement historical backfill, pagination, provider quota handling, retries, reconnects, duplicate suppression and finality/reorg reconciliation. Advance checkpoints only after durable verified writes.
6. Derive candles from actual trades and distinct holders from wallet ownership, with explicit dust/transfer rules. Keep unknown prices/history unavailable rather than synthetic.
7. Add paginated API queries and, if needed, authenticated SSE/WebSocket updates with resumable cursors/stale indicators. The current provider polling is not that service.
8. Only after the worker exists, open Render > New > Background Worker, connect the repository/branch, use its documented build/start commands and add its server-only database/RPC credentials. **There is no current `npm run indexer` script to enter.** A webhook receiver needs a publicly reachable web endpoint; a background worker does not itself expose that URL. [Render workers](https://render.com/docs/background-workers).
9. Run against a test database first. Stop/restart it midway through backfill, replay events and simulate provider downtime. Check no duplicates/gaps and verify amounts/signatures against the explorer.

Pass: deterministic backfill/live ingestion/restart tests pass and the UI uses verified indexed data. Merely creating a worker or buying Helius does not finish the indexer.

## 10. Plan Funded Acceptance (Operator Approval Required)

1. Complete transaction-policy review first. Define a written budget for creation, buying, selling, claims, network fees and account rent. Decide stop conditions and record the tested commit.
2. Use a dedicated operator-controlled test wallet with no unrelated valuables. Keep keys inside Phantom/Solflare; transfer only the amount you personally approve. This guide does not select or authorize a spending amount.
3. Confirm chain/network is mainnet everywhere: RPC, wallet transaction target, explorer and launch configuration. Do not assume Pump or LaunchLab test programs are present on devnet.
4. Record wallet address, starting SOL/token balances, provider source, expected operation, minimum output and maximum debit. Store only public evidence in the test log.
5. Assign someone to inspect each wallet preview. Abort on unexpected recipients, programs, approvals, fee caps or unclear instructions. Wallet preview readability alone is not a substitute for section 6.

Pass: explicit budget/approval and reviewed transaction policy exist. The earlier request to show instructions is not permission for the coding agent to spend funds.

## 11. Launch, Buy, Sell, Claim And Recovery Tests

1. Live > Launch a coin: enter name/ticker/description and artwork. Verify public metadata JSON/image. Current live launch is SOL/create-only with no initial buy.
2. Click Prepare live launch. Check reviewed mint, transaction count, creator/wallet and default program economics. Approve Sign and launch only within section 10's authorization.
3. Record every signature. Open explorer and confirm success, expected mint/pool/creator and token format. Check balances/fees. A new listing alone is not proof of a working curve.
4. Refresh Creator Studio and discovery. Restart the app, reconnect/sign in and ensure the same listing/media remains; do not create another coin to test persistence.
5. Open the token > Buy, enter an approved amount and slippage. Check route, input, minimum, fee/rent estimate and wallet. Approve one reviewed transaction, record signature and compare balance deltas after confirmation.
6. Sell only actual holdings within the test plan. Verify minimum SOL output, fee effects, explorer outcome and refreshed holdings. A quote is an estimate, not a guarantee of exact output.
7. Wait past the quote's 45-second validity in a separate test; signing should require a fresh preparation. Test rejected requests separately. Use controlled fixtures for destructive/insufficient/slippage failure cases rather than intentionally burning funds.
8. For a timeout, use Portfolio > Transaction recovery > Recheck and inspect the signature. Never repeat a launch/trade just because a provider response was lost. If a confirmed launch lacks a listing, use Creator Studio > Recover listing with the creator wallet.
9. Creator Studio > Refresh shows SOL-paired creator fees. If none are available, record that result; do not invent activity. If claimable under the approved plan, Claim fees > review > Sign and claim. Verify vault decrease, expected wallet WSOL receipt and network fee in the explorer. This path is not a Pump rewards claim.

Pass: observed chain settlement and correct balance/account effects for each path. Keep failures/unverified cases in the audit; do not mark them passed because an unrelated action succeeded.

## 12. Market Data And Graduation Tests

1. Open a genuinely indexed asset; check price/liquidity/volume, chart timestamps and recent-trade signatures against provider/explorer evidence. Check an unindexed asset shows unavailable data, not a made-up history.
2. Verify largest token accounts against RPC/explorer. Do not call that a unique-holder count; sections 9/17 are needed for richer analytics.
3. Developer tests must cover pool status 0 (curve), 1 (migration unavailable), 2 (post-graduation routing) and unsupported/corrupt states, including no Jupiter route.
4. For real graduation, use an existing relevant migrated asset and read-only state checks where possible. Do not force graduation by spending large sums simply to finish a checklist. An approved real execution test may be separate from this inspection.
5. Verify the actual destination pool and available route before funded post-graduation testing; a database status flag does not prove migration completed.

Pass: fixture routing tests plus documented real chain state/route inspection. Real lifecycle execution remains unverified until actually observed under an approved plan.

## 13. Shared Auth, Quotes And Quotas (Engineering Required)

1. Choose PostgreSQL-backed atomic records first, or add a managed Redis-compatible store where appropriate. Buying Redis does not make current memory Maps durable.
2. Migrate nonce expiry/single-use consumption, hashed sessions/revocation, quote locks and write/IP quotas from `server/api.js` into shared storage. Expiry and atomic consumption must be enforced server-side.
3. Keep domain binding, signature verification and wallet ownership. Add logout revocation, account-change behavior, session cleanup and retention rules.
4. Test two server instances: simultaneous nonce verification, session reuse/revocation, duplicate execution and concurrent quota increments. Repeat with one instance restarted.
5. Confirm safe proxy trust for the actual topology; forwarded headers must not let clients bypass limits. Do not widen `TRUST_PROXY_HOPS` casually.
6. Add profile data export/deletion and documented retention. Only then increase Render's instance count after checking database/provider capacity.

Pass: multi-instance auth/idempotency/abuse tests pass. Current app remains one instance; new Redis environment variable names would need implementation and documentation.

## 14. Content Moderation And Access Controls (Engineering Required)

1. Define allowed content, abuse/report response time and retention/deletion rules. Identify an operator who actually reviews reports.
2. Add upload quarantine/moderation before making new content public. Existing bounded PNG decode/re-encode does not assess scams, prohibited content or harassment.
3. Add database-backed moderator roles, authenticated dashboard, report review and hide/restore/resolve actions with audit records. A wallet display name must not grant admin rights.
4. Add anti-spam measures and sanctions, with tests that ordinary users cannot inspect private reports or perform moderator actions.
5. Define artwork semantics: a YeetNest catalogue image change does not automatically update immutable on-chain metadata or other explorers. Do not promise removal of publicly pinned material everywhere.
6. For controlled online testing, implement/review access controls or a compatible access gateway that preserves HTTPS origin and wallet integration. The current application is not made private by having a hard-to-guess URL.

Pass: abuse operations work, authorization is tested, and content publication has a defined review path.

## 15. Backups, Monitoring, CI And Security Review

1. Review the PostgreSQL plan's recovery/backup facilities in Render. Establish a schedule/retention appropriate to your data and export an additional encrypted backup where needed. [Render backup/recovery documentation](https://render.com/docs/postgresql-backups).
2. Perform a restore drill into a separate database, never over the live database as your first test. Point a separate test app at it and verify profiles, catalogue, references and watchlists. Check media independently.
3. Create a least-privilege app database role. Keep schema-migration/admin credentials separate where the deployment workflow permits; review existing migrations and grants before changing roles.
4. Add uptime/readiness monitoring, alerts to a real recipient, provider quota/failure alerts and sanitized error reporting. Review third-party data collection before enabling tracing/session replay; never capture keys, bearer tokens or signed payloads.
5. Add CI for `npm ci`, unit tests/build and controlled browser tests. Browser CI needs its browser/server provisioned; the current Edge/local-port config is not a turnkey Linux CI workflow. Database integration tests should use an isolated CI database, not your live Render URL.
6. Run `npm audit --omit=dev`, review advisories and choose compatible patched dependencies. Do not run `npm audit fix --force` without reviewing SDK/adapter breakage and retesting transaction builders.
7. Add load/abuse tests against staging with provider quotas controlled. Test pooling, large/invalid uploads, rate limits, origin/auth failures and graceful restart. Do not flood mainnet providers/live users.
8. Record deployment commit, test evidence, security findings and rollback plan. Future migrations require version tracking and backward-compatible rollback strategy, not destructive down-migrations as a default.

Pass: an actual restore was tested, alerts are received, CI is repeatable and security findings have owners/resolution. A healthy endpoint is not the whole operational checklist.

## 16. Pump-Specific Features And Phantom Embedded Login

1. Product decision: retain Raydium, add separately labelled Pump support, or replace the launch engine. Existing Raydium tokens do not become Pump tokens through a frontend change.
2. For Pump, pin a reviewed current official SDK/IDL commit, independently verify deployed program/config accounts, fee recipients, supported quote assets and token modes. Implement separate creation/trade/claim/migration builders, decoding, indexing and policy tests. [Pump public docs](https://github.com/pump-fun/pump-public-docs).
3. Verify holder-reward eligibility/distribution and fee-sharing permissions from current deployed behavior/documentation. Do not treat public flags as proof you can reproduce Pump's private distribution/social services.
4. Repeat sections 6-12 for every supported Pump path. Do not assume a devnet deployment or silently reuse Raydium fee arithmetic/unsigned historical reserves.
5. Phantom embedded desktop onboarding requires valid provider access/App ID and the official integration. Confirm availability directly; current documentation says new Portal app registration is paused. Phone handoff remains a different workflow. Never build a seed-phrase form as a fallback. [Phantom Portal](https://docs.phantom.com/phantom-portal/portal).

Pass: separately reviewed/tested integrations and access exist. These are product/engineering/provider dependencies, not settings currently missing from `.env`.

## 17. Optional Product Systems

1. Trader P&L: finish the indexer, define trade/transfer/cost-basis/fee accounting, pricing windows and missing-price rules; implement/test position reconstruction. Label loaded-token rankings separately.
2. Social graph/account linking: add follows/blocks/linked-wallet schema, privacy/rate limits and authorization. Linking a second wallet requires proof from both identities; a typed address is not authorization.
3. Livestreaming: select a video provider, implement short-lived signed ingest/playback access and server-owned provider keys, creator authorization and operator moderation. Add viewer/chat quotas and reporting before public launch.
4. Notifications: choose opt-in delivery channels, store subscriptions/consent, run a deduplicated background queue with retries/unsubscribe and retention. Never expose all wallet/user addresses through the notification API.
5. Advanced orders/copy trading: define non-custodial permissions or independently audited custody, execution/cancellation semantics and loss/fee limits. Do not store users' private keys or depend on scheduled browser clicks to execute orders.
6. USDC/custom quote/token modes: verify actual program configuration/mint programs/decimals, add supported builders, fees and migration/indexer handling; test independently. Demo dropdown choices do not prove live availability.

Pass: each selected feature has its own specification, infrastructure, implementation and acceptance evidence. Proprietary Pump UI behavior is not automatically supplied by public contract access.

## What To Do Next

Start with sections 1-5. Stop before funded signing until sections 6-7 and a reviewed acceptance budget are in place. Complete applicable production gates before unrestricted public access. Use the coverage map to track work; no audit item is completed merely by this guide being written.
