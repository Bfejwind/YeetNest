# StonkFun Feature Parity

This is a gap assessment, not a full audit. Direct reference-site access was unavailable. Launch capabilities are based on published integration documentation, and ecosystem pages must be checked directly before claiming complete parity.

| Feature | YeetNest | Remaining work |
| --- | --- | --- |
| Token discovery and filters | Demo discovery and live Jupiter catalogue/mint search | Dedicated LaunchLab indexer; full launch coverage; stock/pre-IPO classifications; real graduation feed |
| Wallet connection | Phantom and Solflare injected wallets | Mobile Wallet Standard/deep links and broader wallet coverage |
| Wallet balances | Mainnet SOL, SPL and Token-2022 balances | Metadata hydration for every wallet asset, valuation, P&L and trade history |
| Creator-uploaded images | Local demo images; signed public Pinata upload and creator-only catalogue editing | Pinata credentials and live acceptance test; durable storage, moderation and quotas |
| Live swaps | Jupiter Swap V2 order/review/sign/execute | Funded-wallet end-to-end acceptance test and operational monitoring |
| Standard launches | Raydium SOL LaunchLab launch construction/simulation/signing/submission | Live launch acceptance test; StonkFun uses Token-2022 while this first integration uses classic SPL |
| Native bonding curve trades | SOL standard LaunchLab buy/sell, on-chain curve progress | Funded-wallet test; batch indexing; custom/taxed quote handling |
| Graduation | Raydium protocol-managed migration; post-curve Jupiter routes if available | Automatic pool migration tracking, transition UI, retry until liquidity is indexed |
| Quote-asset catalogue | SOL live launches; other demo pairs | Stocks, pre-IPO assets, currencies, leveraged tokens, custom mints, on-chain config checks and quote funding swaps |
| Creator dev buy | No live initial buy | Initial buy transaction, funding preview, explicit economics review and atomic/bundled execution |
| Holder reward mode | Unavailable | Immutable transfer tax, Token-2022 mint/authority setup, tax harvest, payout scheduler, receipts and holder dashboards |
| Creator fees | Creator Studio, live WSOL vault balance and reviewed Raydium claim transactions | Funded claim acceptance test, historical revenue accounting, custom platform configuration |
| Selectable launch fees | Unavailable | YeetNest platform/global configurations with verified rates; terms locking and refresh |
| Buyback-and-burn ecosystem | Unavailable | Treasury/platform-token design, execution jobs, receipts, revenue and burn reporting |
| Charts, holders and activity | DexScreener liquidity/price/trade counts, GeckoTerminal candles, wallet transaction history | Holder analytics, complete per-token trade feed and pre-graduation candle indexer |
| Social metadata | Website/X/Telegram links, validated public metadata and detail links | External explorer propagation is provider-dependent |
| Production infrastructure | Single-process persistent catalogue, deployment recipes, writable storage checks, health endpoints and shutdown handling | Durable multiuser database, indexers, distributed rate limiting, hosted HTTPS deployment and monitoring |

Provider setup is available locally in Integrations. Upload references survive restarts; public artwork can use Pinata or the operator's HTTPS domain. The production server disables the local setup endpoints. No account credentials, hosted domain, funded settlement, or audited production readiness are implied.

## Sources

- [StonkFun launch integration documentation](https://docs.sumo.trade/launch-tokens/stonkfun-launch): quote assets, Token-2022, standard/reward modes, metadata and launch economics. The bundling and wallet-management tooling in this source belongs to Sumo and is not asserted to be a first-party StonkFun feature.
- [StonkFun ecosystem links](https://link.stonkbuilder.com/stonkfun): rewards, flywheel and revenue destinations; an independent link index, not proof of every current first-party behavior.
- [Raydium official LaunchLab code demos](https://github.com/raydium-io/raydium-docs-v1/blob/main/products/launchlab/code-demos.mdx): SDK contracts and launch/buy/sell flows.
- [Jupiter Swap order and execute](https://developers.jup.ag/docs/swap/order-and-execute): quote construction, wallet signing, fees, execution and confirmation.
- [Jupiter rate limits](https://developers.jup.ag/docs/portal/rate-limits): keyless/provider limits.
- [Pinata uploads](https://docs.pinata.cloud/files/uploading-files): public image and metadata persistence.
