# Small Launchpad Capacity Policy

This implementation limits work for a small pilot. It does not guarantee zero failures or certify a sustained visitor/trade rate. No production migration, provider purchase, live job reset or funded transaction was performed.

## Deployment Order

1. Back up PostgreSQL and push the changes. Do not edit migrations already recorded in the migration ledger.
2. Run `npm run db:migrate` against the intended Render database, through **014**. Both web and worker now require the control tables; use pre-deploy migrations or your existing combined startup commands. Do not start the new code before migration succeeds.
3. Set these variables on **both web and worker**:

   ```text
   INDEXER_PROTOCOL=pump
   INDEXER_SCOPE=targeted
   RPC_SHARED_INTERVAL_MS=500
   ```

   They must share DATABASE_URL and the exact same SOLANA_RPC_URL for coordination. The quota scope is a one-way hash of that endpoint, never its credential. Different URL spellings, API keys, other databases or external tools are not coordinated even if the provider shares their account quota. 500 ms permits at most roughly two request starts/second across these services; select a budget below your provider's actual allowance.

4. Set the worker:

   ```text
   INDEXER_ROLE=all
   INDEXER_BACKFILL=false
   INDEXER_CONCURRENCY=1
   INDEXER_PAGE_SIZE=25
   INDEXER_SCAN_INTERVAL_MS=15000
   INDEXER_RPC_INTERVAL_MS=1000
   ```

   Leave INDEXER_ONCE unset. Restore `all` from temporary `process` mode so tracked coins can be scanned. Worker-local pacing and shared pacing both apply. These conservative settings trade latency for lower RPC usage; measure before increasing speed.

5. Deploy both services. Verify `/readyz`, `/api/indexer/status`, recent worker heartbeat and logs. `/api/indexer/status` includes `jobs.scope`, `completedLastMinute`, `oldestPendingAgeMs` and `failuresByCode`.
6. Existing failed and pending global jobs are retained, not deleted or declared successful. Old queued work has priority zero. Use the existing bounded retry and exact-status commands for legacy generic errors; automatic recovery does not guess that PROCESSING_ERROR was transient.

## Indexing Scope And Scheduling

Targeted mode scans canonical Pump curve and PumpSwap addresses, not both global programs. Registered MemePop Pump mints have priority 3; mints whose charts users request have priority 2 for one hour. Target selection is bounded to 100 mints per cycle, registered first, with five mints scanned per pass in round-robin order. More than 100 registered/active tokens requires capacity-policy tuning. Interest rows expire and excess entries are pruned; this is a bounded pilot watch set, not every market token.

Chart/market API reads register interest; trading normally follows opening that token. Registration itself includes new MemePop launches. Unsupported external markets retain provider charts and are not interpreted as supported Pump curves. Complete all-market discovery and history are deliberately not promised. The dashboard's existing global archive flags remain conservative; targeted history does not imply global history completeness.

New targeted activity outranks backfill and old global backlog. Historical backfill is off by default; enable INDEXER_BACKFILL=true deliberately only when quota is available. It is suspended once pending work exceeds 100, alongside existing maximum-queue backpressure. Disabling backfill does not delete existing candles. New scans establish a recent baseline; unrequested old history is not invented.

## RPC Efficiency And Coordination

Within the worker, global-account reads are deduplicated/cached for 30 seconds and pool account reads for two seconds, bounded to 200 keys. Failed reads evict their entry. This cache is not used by wallet quote, simulation or signing paths. Indexing uses execution events for historical trades and present account snapshots for current coin state; these are not exact historical pool snapshots.

PostgreSQL atomically allocates RPC request starts across web requests and workers. HTTP 429 publishes a shared cooldown; acquisition waits are bounded and shutdown-aware. Existing local pacing also observes Retry-After cooldowns. The shared budget is conservative rather than automatic throughput tuning; there is no guarantee of fair web/worker bandwidth reservation. Monthly credits, method-specific provider quotas and providers returning throttling in HTTP-200 JSON can still need additional policy. Monitor account usage and retain an incident response plan.

## Failure Recovery And Alerts

Rate-limit, network and timeout jobs defer for a minute without exhausting the permanent attempt allowance. Ownership/discriminator/PDA validation failures are quarantined after one failure. Unsupported supported-policy modes are skipped by the decoders; other errors remain bounded retries rather than being silently declared done.

Known transient exhausted jobs are automatically recovered in batches of ten only when pending jobs are below 100, after a five-minute cooldown. Legacy generic failures, unavailable history and auth/validation errors require review. An extended outage can leave transient work deferred indefinitely, so a lack of failed jobs is not proof of health.

Worker logs emit backlog alerts for failed work or queue age over five minutes. API exposes completion rate, age and grouped failures. Configure Render log/service notifications and external monitoring separately; no paid alert provider, email delivery or pager integration was provisioned.

## Verification And Limits

`npm test` verifies existing functionality. `npm run test:pilot` includes safe unit checks and an integration test that requires YEETNEST_TEST_DATABASE_URL. That test creates and removes its own isolated PostgreSQL schema; it exercises live-first claims, duplicates, concurrent workers, temporary errors, exhausted leases, burst queues, recovery, shared pacing, cooldown and shutdown. It does not mutate production job rows.

These are controlled overload/failure tests, not a sustained load benchmark. Archive completeness, multi-hour outage recovery, account/provider-wide quotas, anti-abuse rules for target interest and an independently reviewed trading policy remain release gates. Do not advertise Pump-scale capacity from these changes.
