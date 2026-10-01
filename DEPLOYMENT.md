# YeetNest Deployment

The current release is a single-process launchpad. Do not run multiple replicas against its JSON catalogue. It is not an audited production trading platform.

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
- Test a server restart: catalogue, image files and upload references must persist; creator sessions intentionally require signing in again.
- Provision database/indexing jobs, image moderation, distributed abuse controls, backups, alerting and dependency/security review before public production use.
- Verify graduation with a real pool; indexed candles are not promised for pre-graduation assets.

Remaining product differences are tracked in FEATURE_PARITY.md. Reward tokens, custom quote assets, initial buys/bundles, selectable economics and treasury automation remain unimplemented.

Container and shutdown setup follow the official [Node image](https://github.com/nodejs/docker-node) and [Express health-check guidance](https://expressjs.com/en/advanced/healthcheck-graceful-shutdown/).
