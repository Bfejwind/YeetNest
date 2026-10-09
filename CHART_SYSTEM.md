# MemePop Indexed Chart System

October 9, 2026. This is an implementation and rollout guide, not a claim of Pump-scale throughput or complete historical coverage.

## Data Path

The Pump worker now scans Pump and PumpSwap independently, using separate durable cursors and the same leased processing queue. Successful canonical SOL PumpSwap trades are recorded against the original Pump curve identity, preserving one token history across migration. Failed transactions, spoofed program logs, noncanonical pools, non-SOL quotes and unsupported launch modes are excluded. Historical appended event fields are supported through the official SDK event layout.

Migration 013 creates one-minute OHLCV candles. New trades update candles transactionally, with duplicate inserts ignored. Late trades update the appropriate old minute. Existing indexed trades are backfilled by the migration. Prices are realized quote/base execution prices, not indicative spot prices inferred from current pool reserves. Volumes are executed quote volume, excluding the separately stored fees. Same-slot transaction ordering is deterministic by signature, not reconstructed block order.

`GET /api/candles/:mint` accepts `interval=60|300|900|3600|14400|86400`, `days=1|7|30|90`, `currency=SOL|USD`, and `metric=price|fdv`. At most 1500 candles are returned. Small intervals over long ranges show the newest bounded subset, not the entire range. Empty minutes are not filled. Two-second per-process response caching sits above shared PostgreSQL candle storage.

USD uses Coinbase SOL/USD spot samples observed once per minute by the scanner leader. Historical minutes without a recorded conversion rate are excluded, not converted using today's price. This is minute-snapshot conversion, not tick-exact historical FX. FDV is execution price multiplied by Pump's indexed issued token supply; it is not circulating market cap or a liquidity valuation. Fee/share/reward modes remain outside this chart policy.

The token view supports timeframe, history, SOL/USD and Price/FDV selection, candles, volume, crosshair OHLC and fit-to-content. Database-backed SSE triggers debounced five-second refreshes after indexed writes; this is finalized data, not instant unconfirmed ticks. Pump charts use the local endpoint after migration too. Other market tokens retain external providers, with cache, request deduplication, conservative per-process pacing and cooldown. Multiple backend replicas still need shared external-provider quota coordination.

## Render Rollout

### Low-Cost External Charts

Non-Pump pool charts now use GeckoTerminal's official embedded viewer, defaulting to price and five-minute candles. `/api/market/:mint?chart=embed` discovers the highest-liquidity eligible base-token pool through DexScreener, caches its descriptor for five minutes per process, and does not request GeckoTerminal OHLCV through our backend. Pump charts remain local. The original API candle route remains available without `chart=embed`.

No new API key, subscription, worker or migration is required for embeds. Deploy the web changes with `npm ci && npm run build`, then restart the web service. Existing Pump worker, database and RPC costs still apply. Embedded charts load from a third-party origin and expose ordinary visitor connection information to that provider. Browser blockers, provider outages and untracked pools can prevent rendering; direct GeckoTerminal and DexScreener links remain visible. Cross-origin restrictions prevent MemePop from verifying the chart's internal contents. An iframe load event is not proof of available price history. The viewer controls its history range and timezone; this is not a Singapore-midnight-only chart or guaranteed all-token coverage. No synthetic price history is generated.

Official embed instructions: https://about.geckoterminal.com/embed-charts

1. Back up PostgreSQL. Review and push the changes. No wallet credentials belong in Git.
2. Web build: `npm ci && npm run build`. Paid pre-deploy: `npm run db:migrate`; start `npm start`. If pre-deploy is unavailable, start `npm run db:migrate && npm start`.
3. Apply migrations through **013** before starting either service. Local configured-database migration was applied; this does not prove another Render database has been updated.
4. Existing background worker: `npm run indexer`, `INDEXER_PROTOCOL=pump`, `INDEXER_ROLE=all`, same database and mainnet RPC. No additional PumpSwap worker is required. Restart/redeploy the worker with the new code. Leave `INDEXER_ONCE` unset.
5. Check `/readyz` and `/api/indexer/status`. The latter reports the PumpSwap cursor separately. Review queue failures, pending jobs and recent worker heartbeats. Empty provider history is not evidence of complete archive coverage.
6. To prioritize an older coin, run from an authorized terminal with the same environment:

   ```powershell
   npm run charts:backfill -- YOUR_MINT_ADDRESS 5
   ```

   This queues up to five 100-signature pages per existing canonical curve/pool address. Repeat to resume until scanComplete is true. The worker must process the queue afterwards. RPC history retention still bounds coverage. Previously completed signatures in the shared queue are skipped; prune aged completed jobs before replay if additional decoding is needed. No transaction is signed or submitted by this command.

7. Open the coin. Select SOL first; choose USD after rate samples and trades exist in matching minutes. Test history/timeframe changes and a worker restart. Compare public transaction amounts with candles.

## Remaining Release Gates

- Independently verify representative historical PumpSwap trades, migrations, quote/fee semantics and multi-event ordering.
- Archive RPC completeness and rate quotas; sustained worker catch-up and database load/failure tests.
- Long-range historical USD backfill from an approved historical provider; the current sampler cannot recreate past minute prices.
- Shared cache/quota coordination for multiple replicas, higher-capacity fanout and alerting. SSE retains its existing per-process caps.
- Non-SOL quotes, other DEX coverage, unsupported modes and circulating-supply market cap need separate data policies.
- Frontend updates remount after finalized events and preserve historical viewing ranges when scrolled away from the latest candle; this is still debounced refresh, not tick streaming.

No funded trades, public deployment, paid subscription or load-capacity certification were performed as part of this implementation.
