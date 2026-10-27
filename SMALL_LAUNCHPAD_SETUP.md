# MemePop Small Launchpad Setup

The new targeted indexing and shared RPC control require migration **014**. Follow [SMALL_LAUNCHPAD_CAPACITY.md](SMALL_LAUNCHPAD_CAPACITY.md) for deployment order and updated settings; it supersedes older global-indexing settings below.

This is a single-instance pilot, not Pump.fun-scale certification. Do not open unrestricted trading until the funded acceptance tests and independent security review are complete. No hosting purchase, deployment or funded transaction was performed by this guide.

## 1. Keep The Existing Services

Open https://dashboard.render.com and locate your existing web service, PostgreSQL database and worker. Do not create duplicates if these already exist. Use the same region for all three. Keep one web instance and one worker. Select an always-on paid web/worker plan; choose database storage, backup retention and compute based on your measured usage. Review the total before confirming purchases. An inexpensive initial plan is a starting point, not a capacity guarantee.

The existing `render.yaml` keeps the old service names deliberately. A worker whose name contains LaunchLab can still run Pump with `INDEXER_PROTOCOL=pump`. The Blueprint now prompts for a dedicated RPC URL. Editing YAML does not automatically update a manually created service.

## 2. Prepare Provider Accounts

1. Open your Solana RPC provider dashboard (for example, your existing Helius account). Select the mainnet project and copy the HTTPS RPC URL privately. Set request/spend alerts and check archive/history availability. Never paste the URL's API key into chat or Git. A free provider tier may be usable for tests but must have enough capacity for both web traffic and indexing.
2. Open your Pinata dashboard. Obtain a server JWT with only the upload permissions the app needs. Keep it private. Configure storage/spend alerts.
3. Open your Jupiter developer account and obtain its API key for supported market-token routes. Keep it server-side. An API key does not complete the project's unfinished broad route-security policy.
4. Rotate any credentials previously exposed. Never supply personal wallet private keys or recovery phrases to the web service. The optional automation Cron Job uses only its separate limited-funds signing key, as described below.

## 3. Connect PostgreSQL

1. In Render, open your PostgreSQL database and its connection details.
2. Copy the **Internal Database URL** for services in the same region/private network.
3. Open the web service -> **Environment** -> **Add Environment Variable**. Enter `DATABASE_URL` and paste the internal URL into Value.
4. Repeat for the worker, using the same database.
5. For local commands only, use the External Database URL privately in your local `.env`. Do not replace that with an internal hostname your laptop cannot resolve.
6. Check backup retention in the database's dashboard and take a backup before migration. Test restoring to a separate database before relying on backups.

## 4. Set The Web Service

Open your web service -> **Settings**. Edit these fields and save:

| Field | Value |
| --- | --- |
| Root Directory | Leave blank if package.json is in the repository root |
| Build Command | `npm ci && npm run build` |
| Pre-Deploy Command | `npm run db:migrate` |
| Start Command | `npm start` |
| Health Check Path | `/readyz` |

Pre-deploy is available for paid services. If you cannot use it, the pilot Start Command can be `npm run db:migrate && npm start`. Do not put migrations in the build command. Run the migration command without changing applied SQL files; it applies pending migrations, including 013.

Under **Environment**, add or edit:

| Key | Value |
| --- | --- |
| NODE_ENV | `production` |
| TRUST_PROXY_HOPS | `1` on Render |
| DATABASE_URL | Internal PostgreSQL connection URL |
| SOLANA_RPC_URL | Dedicated mainnet HTTPS RPC URL |
| PINATA_JWT | Private Pinata JWT |
| JUPITER_API_KEY | Private Jupiter API key |
| INDEXER_PROTOCOL | `pump` |
| IPFS_GATEWAY | `https://gateway.pinata.cloud/ipfs/` |
| MODERATOR_WALLETS | Your moderator wallet public address, not its private key |

Render supplies PORT. Leave INDEXER_ONCE unset. With Pinata, PUBLIC_BASE_URL is not required for uploads. The existing Blueprint disk can be retained; local filesystem uploads require persistent storage and a correct PUBLIC_BASE_URL. Do not remove existing media or disks.

Click **Save, rebuild, and deploy** if offered, or save and use **Manual Deploy -> Deploy latest commit**. Check Logs for a successful migration and server startup. Confirm the deployed commit is the one containing your latest fixes.

## 5. Set The Worker

### If You Have Not Created A Worker Yet

1. Push the latest project changes to the branch used by your Render web service. Check the GitHub page contains `server/indexer.js` and migration 013.
2. Open https://dashboard.render.com -> **New +** -> **Background Worker**. Do not select Web Service, Cron Job or Key Value.
3. Under the Git provider option, connect/select the same GitHub repository as the web service. For a private repository, authorize Render's GitHub access; do not use the Public Git Repository field.
4. Enter Name `memepop-pump-indexer`, Language/Runtime **Node**, the same deployment branch, and the same region as your PostgreSQL database. Leave Root Directory blank if package.json is at the repository root.
5. Set Build Command `npm ci` and Start Command `npm run db:migrate && npm run indexer` for the initial setup. This startup command applies pending migrations before indexing. Do not run npm start: that starts the web server, not the worker.
6. Select an always-on paid worker instance (start with an available 512 MB option for a small pilot and measure memory/queue lag). Review displayed pricing before creating it. This is not a Pump-scale capacity guarantee.
7. In Environment Variables (expand Advanced if necessary), enter the following individually. Do not bulk-copy every secret from .env:

   | Key | Value |
   | --- | --- |
   | NODE_ENV | `production` |
   | DATABASE_URL | Same Render Internal Database URL used by the web service |
   | SOLANA_RPC_URL | Same dedicated mainnet RPC URL used by the web service |
   | INDEXER_PROTOCOL | `pump` |
   | INDEXER_ROLE | `all` |
   | INDEXER_CONCURRENCY | `4` |
   | INDEXER_PAGE_SIZE | `100` |
   | INDEXER_SCAN_INTERVAL_MS | `2000` |
   | INDEXER_MAX_PENDING | `10000` |

8. Leave INDEXER_ONCE unset. No PORT, wallet key, PINATA_JWT, JUPITER_API_KEY, Redis/Key Value service or public worker URL is required. This queue is already PostgreSQL-backed.
9. Click **Create Background Worker** (or the equivalent Deploy button). Open **Logs** and wait for the build, migrations and worker startup. If a missing-table error occurs, confirm it is connected to the intended database and migrations succeeded. On HTTP 429, inspect the RPC quota before increasing concurrency.
10. Open your website's `/api/indexer/status`. Confirm `jobs.workers` has a recent heartbeat. Recheck after a minute: cursors should advance or show caught-up scanning, and queued jobs should process. A worker with no public URL is normal.
11. After the initial successful deploy, you may move `npm run db:migrate` to **Settings -> Pre-Deploy Command** and set Start Command to `npm run indexer`. If that field is unavailable, keep the combined startup command. No worker Health Check Path is needed.
12. In your web service's Environment, also set INDEXER_PROTOCOL=pump and redeploy the latest commit. Automatic provider chart fallback works without a worker, but local finalized Pump/PumpSwap charts and broader indexed discovery need the worker. Provider coverage still limits external history.

Open the existing background worker -> **Settings**:

| Field | Value |
| --- | --- |
| Build Command | `npm ci` |
| Pre-Deploy Command | `npm run db:migrate` |
| Start Command | `npm run indexer` |

Under **Environment**, set NODE_ENV=production, the same DATABASE_URL and SOLANA_RPC_URL, INDEXER_PROTOCOL=pump and INDEXER_ROLE=all. Keep the bounded settings in `.env.example` initially. Remove INDEXER_ONCE rather than setting it true. The worker does not need wallet keys, Pinata or Jupiter keys. Redeploy after the schema is ready. Worker health uses heartbeats, not an HTTP health-check path.

## 6. Check The Deployment

Open these addresses using your actual public site hostname:

1. `/readyz`: must return `ready: true`. This is storage/process readiness, not proof of working trading providers.
2. `/api/status`: review mainnet RPC, database and upload configuration. Confirm no provider error is shown in Integrations.
3. `/api/indexer/status`: look for a recent worker heartbeat, advancing scan cursors, and a queue that is processing. A growing backlog or persistent failures require investigation; a green web health check is not enough.
4. Open token details on desktop and a phone. Check images, charts, wallet connection and balances. A provider embed alone does not prove buying or selling works.

Local terminal, from the project folder:

```powershell
npm run build
npm run pilot:check
```

The preflight prints presence/configuration checks, never secret values. It does not connect to services or certify production. Local NODE_ENV may remain development. Run `npm run db:migrate` separately only against the database you intend to update, after backing it up.

## 7. Prove Buying And Selling

1. Use a separate test wallet and agree a maximum spending, transaction-fee and slippage budget before testing. Do not use a main savings wallet.
2. Connect it to your HTTPS deployment and compare the displayed address and SOL balance with the wallet.
3. Create one standard SOL Pump coin, upload artwork, review the simulation and approve only if it succeeds. Verify the mint and confirmed signature on Solscan.
4. Buy a small amount with a separate approval. Confirm the token balance after refresh.
5. Sell part of it. Check the resulting SOL and token balances against confirmed transactions and fees.
6. Test cancelling an approval and an expired quote. Neither should create a duplicate transaction. If submission status is unknown, check its signature before retrying.
7. Test collected creator fees when available. Never override a failed-simulation warning.
8. Test an already migrated supported PumpSwap coin separately; do not spend large amounts merely to force your test coin to graduate. Migration-state transitions still require independent acceptance testing.
9. Record results and signatures (public information), but no private keys. Obtain independent security review before inviting users to risk funds. Restrict or disable unsupported/Jupiter routes until their security policy is validated.

### Launch confirmation recovery

Deploy the web service containing the latest launch fixes (both the frontend build and server RPC allowlist), then reload the site. No database migration is required for these transaction recovery changes.

Pump launches and trades now include a priority fee selected from recent RPC samples, with a fallback and a maximum of 0.0001 SOL at the configured 400,000 compute-unit limit. The network fee estimate shown for review includes this fee. This improves transaction scheduling but does not guarantee inclusion.

If confirmation times out, open Creator Studio -> Transaction recovery -> Recover transactions. Newly submitted transactions retain their signed payload, blockhash and expiry height in this browser. Recovery may resend exactly that transaction; it does not request another signature or build a replacement. A finalized height past expiry plus repeated historical status/transaction checks can mark an absent transaction expired. RPC failures and processed transactions remain unresolved. Older records without expiry metadata cannot be automatically declared expired.

Use Check creation and recover listing only to register a coin that already exists on-chain. It verifies the curve and creator first. A rejected creation no longer leaves a purchase request behind; a submitted creation with unknown confirmation retains its launch signature and intended purchase for recovery. Never clear browser storage to bypass an unresolved signature.

## 8. Operate The Pilot

### RPC Rate-Limit Recovery

After deploying the fixes and confirming the RPC quota is stable, `npm run indexer:jobs -- retry-failed 10` requeues only ten exhausted jobs (maximum 100 per command). It does not delete history or submit on-chain transactions. Monitor their processing before repeating; requeueing reduces the failed count immediately, not only on success. `npm run indexer:jobs -- status SIGNATURE` gives the exact pending/processing/done/failed state. `node server/diagnose-indexer.js SIGNATURE` performs a read-only decoding check without writing to PostgreSQL. A successful decode does not prove database writes or every failed job will succeed.

The worker now paces all its RPC calls with `INDEXER_RPC_INTERVAL_MS` (default 1000 milliseconds) and observes bounded HTTP 429 cooldowns. This is per worker process, not a shared quota across web/worker replicas. In Render worker Environment, start recovery with INDEXER_CONCURRENCY=1, INDEXER_PAGE_SIZE=25, INDEXER_SCAN_INTERVAL_MS=15000 and INDEXER_RPC_INTERVAL_MS=2000. Save and deploy the latest code. Watch RPC quota usage and `/api/indexer/status` before requeueing failed jobs. Slower settings reduce requests but increase catch-up time and cannot fix exhausted daily credits. Check the provider plan and account usage, including traffic from the web service using the same key. After the cause is resolved, use `npm run indexer:jobs -- failed`, then `npm run indexer:jobs -- retry SIGNATURE` for a small sample in Render worker Shell. Never delete checkpoints or blanket-retry thousands of jobs while rate-limited.

Check Render Logs/Metrics, database storage/connections, RPC quotas and worker queue daily. Enable service-failure notifications, provider quota/spend alerts and external uptime monitoring of `/readyz`. Keep an incident contact and user-visible support channel. If transaction construction/simulation behaves unexpectedly, pause new user onboarding and investigate; do not ask users to sign unsafe transactions.

Test a controlled service/worker restart and a database restore. Set moderation, terms, privacy, retention and jurisdiction-appropriate legal policies. Larger visitor counts require shared caches, scalable updates and measured load tests; do not increase all concurrency settings blindly.

## Official References

- Render service setup: https://render.com/docs/web-services
- Environment variables: https://render.com/docs/configure-environment-variables
- Pre-deploy commands: https://render.com/docs/deploys
- Health checks: https://render.com/docs/health-checks
- Compute plans: https://render.com/docs/compute-plans

## Daily launches

The browser schedule now prepares **five coins every day, including weekends, from 9:15 a.m. Asia/Singapore**. Open Creator Studio -> Daily launches. The ten animal portraits rotate in two sets of five on alternating calendar days, with matching names and tickers. Saved descriptions and social links are preserved.

Select Connect Phantom and enable to use the existing approval-based flow. Keep the website open and visible; each launch still requires Sign and launch plus Phantom approval. Missed dates are skipped. Scheduled launches have no initial purchase. All five templates must be saved if animal rotation is disabled. Existing two-slot schedules are expanded to five slots without clearing attempt history.

Unattended server signing is implemented but disabled by default. The approved cap is 0.01 SOL per day with no initial token purchases. Follow the Cron Job setup below; a dedicated automation wallet, migration 015, and operational database/hosting are required.

Templates and attempt history are browser-local. Use one browser/device. Rejected or unresolved attempts are held rather than replaced automatically. Use Transaction recovery and Launch recovery; never clear browser storage to retry. Pause stops future browser submissions. No new database migration is required for the browser schedule changes.

## Unattended daily creation: 0.01 SOL maximum, no buys

The server implementation targets five standard Pump creations every day from **9:15 a.m. Singapore time**. It uses the ten bundled animal portraits and matching names/tickers. It never requests an initial buy, adds liquidity, or calls a trade builder. **Five creations are a target, not a guarantee: rent, fees, unavailable providers or failed simulation can stop the day early. The 0.01 SOL limit takes priority.**

### Before enabling

1. Keep PostgreSQL operational: upgrade or migrate the expiring Render database first. Back up and restore-test the intended database, then apply migration **015** with `npm run db:migrate`. Do not edit earlier applied SQL files. Migration 015 has been applied to the locally configured database after a private snapshot backup and typed temporary-table restore check. Confirm Render uses that same database; otherwise back up and migrate its destination separately. No funded transaction has been performed.
2. Use the chosen Phantom Solana account as the automation account: set its public address as `AUTOLAUNCH_WALLET` and privately configure its exported account signing key as `AUTOLAUNCH_SECRET_KEY` on the Cron Job only. Do not share that key in chat or use a recovery phrase. Exporting an account key gives the worker control of that account; the daily budget is enforced by this implementation, not by a restriction on the key itself. As an alternative, create a separate limited-funds wallet locally with `npm run autolaunch:wallet`. It creates `data/automation-wallet.json` with exclusive creation and prints only the public address. Existing wallet files are never overwritten. Keep this ignored file private and backed up. The locally generated wallet is not automatically substituted for your selected Phantom account. Never supply a recovery phrase.
3. In Creator Studio, pause any existing browser schedule before switching. On the Render **web service**, set `AUTOLAUNCH_ENABLED=true` and deploy the updated frontend/server. This flag displays the server-mode notice and disables browser scheduling. The web service must NOT receive the automation signing secret.
4. Create one Render **Cron Job** from this repository, using the same region and deployment branch. Review its displayed hosting cost before creation. Build: `npm ci`. Command: `npm run autolaunch`. Schedule: **`15 1 * * *`**, which is 01:15 UTC / 09:15 Singapore every day. Leave it disabled until the settings below and your wallet funding are ready. The cron runs once, polls pending signatures for up to approximately ten minutes, and exits. It is not an always-running daemon. If a transaction remains pending, rerun the same job that day to recover its identical saved transaction; do not clear its journal.
5. Give the Cron Job only these environment variables:

| Variable | Value |
| --- | --- |
| NODE_ENV | `production` |
| DATABASE_URL | The same operational PostgreSQL database as web/indexer |
| SOLANA_RPC_URL | Dedicated mainnet RPC URL |
| PINATA_JWT | Upload-only private JWT |
| RPC_SHARED_INTERVAL_MS | Same shared RPC setting as web/indexer, initially `500` |
| AUTOLAUNCH_ENABLED | `true` only when ready to run |
| AUTOLAUNCH_DAILY_BUDGET_SOL | `0.01` |
| AUTOLAUNCH_INITIAL_BUY_SOL | `0` (nonzero values are rejected) |
| AUTOLAUNCH_WALLET | Public address printed by the wallet setup command |
| AUTOLAUNCH_SECRET_KEY | Selected Phantom account export in base58, or dedicated wallet JSON; enter privately into Render, never chat/source/Git |

6. Fund ONLY the dedicated automation wallet with an amount you are willing to allocate. Do not fund the derived daily payer addresses separately. Enable the Cron Job after reviewing the public wallet address and all settings. A browser or Phantom popup is not required.
7. Inspect job logs and run `npm run autolaunch:status` with the intended database configured. Status output includes public wallet/mint/signature addresses, reserved costs and blocked reasons; it never prints private keys or signed transaction payloads. Confirm real outcomes on Solscan. Live acceptance testing remains to be completed with funded transactions.

### How the budget is bounded

The signing wallet makes at most one recorded funding transfer per Singapore date: **0.0099 SOL** to a deterministic daily payer, with the funding fee capped at **0.0001 SOL**. Only that daily payer signs creations; the dedicated root wallet is the on-chain creator and does not pay their transaction fees. Daily funding plus its maximum fee is therefore at most **0.01 SOL**. Network fees, including fees for failed transactions, and account rent come from the daily allowance. The unused funding-fee reserve is not made available for extra launches. Unused SOL stays in that derived payer; it is not automatically swept or reused on another date. Keep the dedicated key backup to retain control of these derived payers and creator fees.

Each creation is simulated, its full payer debit plus a conservative fee margin is reserved, and its signed bytes and signature are stored in PostgreSQL before sending. An unresolved attempt keeps its reservation. Failures and expired attempts consume a slot; the worker never automatically replaces their mint or tops up the daily payer. The worker accepts only its locally built Pump `create_v2` plus bounded compute-budget instructions, with no buy instruction. Metadata uploads are cached for reuse; Pinata/RPC/hosting charges are outside the SOL transaction budget.

Only one worker can hold the database automation lock. Never delete/reset automation journals, switch to an empty database, or restore a stale backup and resume blindly: reconcile the recorded public signatures first. Prior transaction history on an otherwise empty derived payer blocks new funding after a lost journal. All wallets and secrets must stay fixed during a day's run. Older days are checked for status/listing recovery only; no old transaction is rebroadcast and no missed date is funded. A database/RPC failure stops processing. Keep the automation signing key off the public web service and indexer.

To stop future creation, suspend the Cron Job and set its `AUTOLAUNCH_ENABLED=false`. Already submitted on-chain transactions cannot be cancelled by this switch. Keep `AUTOLAUNCH_ENABLED=true` on the web service while investigating so an old browser schedule cannot start additional launches. Changing the web flag alone does not stop the Cron Job. Browser/manual launches are separate actions and are not covered by the server's daily allowance.

Render Cron Job schedules use UTC: https://render.com/docs/cronjobs .

Run `npm run autolaunch:check` in the configured automation environment before enabling the Cron Job. It checks schema, mainnet, public-address/key match and funding without sending transactions. The local generated data/automation-wallet.json is unused when a different Phantom account is selected.

### Current activation progress

The locally configured database has migration 015. Its pre-migration snapshot is in ignored `data/backups/`; verification restored all 21,613 rows into typed temporary tables without changing live data. This is a data restore check, not a full disaster-recovery test of a separate database. `npm run autolaunch:check` confirms database schema, mainnet RPC and Pinata presence. The selected Phantom public address and matching signing key are not configured yet, and automation is disabled. Connect Render to finish Cron Job and web-service settings; enter the selected account key privately only on that Cron Job.
