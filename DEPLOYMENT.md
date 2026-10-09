# MemePop Deployment

October 9 Pump/PumpSwap rollout: follow [PUMP_ROLLOUT.md](PUMP_ROLLOUT.md) and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). Migrations through 012 and INDEXER_PROTOCOL=pump are required for the new default. Old LaunchLab-only deployment notes below are historical where they conflict. No public deployment or funded acceptance has been performed.

## October 7 Render Configuration

This section supersedes the older pilot instructions below. See [AUDIT_REPORT.md](AUDIT_REPORT.md) for current safety gaps and feature status.

1. Push the reviewed source to the GitHub branch connected to `https://yeetnest.onrender.com`. These local edits are not automatically deployed.
2. Open Render Web Service > Settings. Runtime: Node. Root Directory: blank if `package.json` is at repository root. Build Command: `npm ci && npm run build`. Start Command: `npm start`. Do not use `build:hosted`.
3. Health Check Path: `/readyz`. Paid service Pre-Deploy Command: `npm run db:migrate`. If free hosting does not offer this field, use Start Command `npm run db:migrate && npm start` for the pilot. Do not rely on database access during the build phase.
4. Environment: `NODE_ENV=production`, `TRUST_PROXY_HOPS=1`, `DATABASE_URL`, `SOLANA_RPC_URL`, `JUPITER_API_KEY`, `PINATA_JWT`, optional `IPFS_GATEWAY`. Use PostgreSQL's internal URL when Render services share its private network/region. No secrets belong in `VITE_` variables. Let Render supply `PORT`.
5. Keep one pilot instance until transaction policy and shared IP abuse protection are complete. Nonces, hashed sessions, quote consumption and wallet upload/community limits now use PostgreSQL. Proxy trust assumes one trusted reverse proxy; use `TRUST_PROXY_HOPS=0` for direct local access. Apply migrations 003/004 before deploying this revision; see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the separate indexer worker and current blocker.
6. PostgreSQL now holds catalogue, upload references, watchlists and community records. With Pinata, `DATA_DIR=./data` only needs to be writable. JSON fallback or self-hosted media needs a paid persistent disk at `/var/data`, `DATA_DIR=/var/data`, and backups. `PUBLIC_BASE_URL` alone does not make files durable.
7. Save settings > Manual Deploy > Deploy latest commit. Check migration/start logs, then `/healthz`, `/readyz`, `/api/status`, and Integrations > Test connections. Readiness checks application/community storage and the runtime directory, not upstream trading.

Render supplies HTTPS. API/RPC requests use the browser's current origin. No separate frontend API URL, permissive CORS, cookie configuration or WebSocket URL is required. PostgreSQL-backed bearer sessions survive restarts until their one-hour expiry; only the browser's bearer token remains in memory, so a browser reload can require signing in again.

Migrations through `012-social.sql` were run successfully against the configured destination on October 9. If Render points elsewhere, migrate that database too. The checksum migration ledger tracks applied files; never edit applied SQL, add another numbered migration instead. API pool caps total 33 connections per instance; all-role workers can use another 14. Reserve operational headroom and budget for every replica.

Before switching JSON storage, securely back up `coins.json`, `upload-references.json`, `community.json` and self-hosted `public/` media. Point local `DATA_DIR` to the trusted export and privately configure database/RPC. Run `npm run db:import-catalogue` for a read-only ownership/mainnet-verified dry run. After reviewing counts and backing up PostgreSQL, run `npm run db:import-catalogue -- --apply`; existing database records are never overwritten. Community JSON needs a separately reviewed parameterized import. Retain backups and continue serving existing media URLs. Importing is never automatic.

Official references: [Render Web Services](https://render.com/docs/web-services), [Pre-Deploy Commands](https://render.com/docs/deploys#pre-deploy-command), [Health Checks](https://render.com/docs/health-checks), [Persistent Disks](https://render.com/docs/disks), [PostgreSQL](https://render.com/docs/postgresql).

The PostgreSQL path supports shared catalogue, sessions, quotas, watchlists and indexer coordination. The JSON fallback remains single-process: do not run multiple replicas against it. Shared storage is not proof of Pump.fun-scale throughput or an audited production trading platform.

## Local Provider Setup

Run `npm run dev`, open Integrations, and configure your Solana mainnet RPC, Jupiter API key, and Pinata JWT. Credentials stay server-side in ignored `data/provider-settings.json`. Never provide a seed phrase or private key. Test the connections from Integrations.

Pinata is optional if `PUBLIC_BASE_URL` points to your public HTTPS deployment. Self-hosted metadata must stay available permanently. Localhost metadata is not suitable for launches.

## Deploy

For Node hosting, run `npm ci`, `npm run build`, then `npm start`. Supply server-only environment variables from `.env.example`, mount persistent storage at `DATA_DIR`, and put an HTTPS reverse proxy in front of port 3000. Provider setup endpoints are disabled by the production server.

For Docker hosting, configure environment variables locally and run `docker compose up --build -d`. The container runs as a non-root user, keeps its catalogue and uploads in a named volume, and publishes only on the host's loopback port. Configure your HTTPS reverse proxy to forward to `127.0.0.1:3000`. Docker credentials are environment variables; local development settings are not copied into the image. Back up the volume securely because provider settings may contain secrets.

`/healthz` is process liveness; `/readyz` verifies successful startup with writable storage. Neither endpoint asserts that upstream providers or trading work. `/api/health` performs separate provider checks.

## Acceptance Checklist

- Verify mainnet RPC, provider limits, public image/metadata URLs and TLS.
- Use an operator-controlled wallet to accept/reject a launch, buy, sell, Jupiter swap and creator-fee claim. Confirm balances and signatures in Solscan. No funds have been moved by the coding agent.
- Test a server restart: catalogue, persistent image files, upload references and unexpired PostgreSQL sessions must persist.
- Provision database/indexing jobs, image moderation, distributed abuse controls, backups, alerting and dependency/security review before public production use.
- Verify graduation with a real pool; indexed candles are not promised for pre-graduation assets.

Remaining product differences are tracked in FEATURE_PARITY.md. Reward tokens, custom quote assets, initial buys/bundles, selectable economics and treasury automation remain unimplemented.

Container and shutdown setup follow the official [Node image](https://github.com/nodejs/docker-node) and [Express health-check guidance](https://expressjs.com/en/advanced/healthcheck-graceful-shutdown/).
