# Creator Claim And Sell Review

Scope: wallet selection/restoration, creator-fee SDK construction, quote/review UI, message binding, wallet fee adjustment, signed simulation, Jupiter/provider execution, direct RPC broadcast and transaction journaling. This is a focused engineering review, not an independent security audit of every financial protocol.

## Verified Observations

- The public MemePop bundle contains adjustment validation but does not yet contain the latest detailed instruction-count diagnostics inspected during this review. A fresh deployment and hard reload are necessary before testing the newer diagnostics.
- A read-only mainnet check for the previously supplied creator address found 0.029361146 SOL in collected fees. The official SDK claim, including fresh-blockhash resimulation, passed. The transaction contains ComputeBudget plus one Pump collect instruction; no token account creation is required. No signature, broadcast or payment was made.
- The user's error reports a non-compute instruction/account difference after signing. It cannot be attributed solely to priority fees, indexing backlog or creator-vault availability from that evidence.
- Focused validator tests and mocked signing tests show identical economic instructions with bounded wallet-added fees can pass; changed economic instructions remain rejected. A mocked wallet is not proof of Phantom acceptance.

## Fixes And Diagnostics

- Plain Pump claims now reserve zero extra account rent; AMM claims reserve token-account rent only for the associated-account creation instructions present, conservatively including idempotent creations. Other operations retain their original reserve policy.
- Wallet owner changes during fee loading/preparation and mismatches with the extension's active account are rejected before signing.
- Rejected modified claims and sells provide copyable public instruction reports: programs, truncated instruction data and public account permissions. Reports contain no signatures, signed-transaction bytes, private keys, API keys or RPC URLs, and are not automatically sent anywhere. Public wallet addresses are included, so share deliberately.
- Fee adjustments remain bounded to Solana's compute ceiling and 0.01 SOL total network fee, with signed simulation and unchanged economic instructions/account permissions. Additional signers/unsafe modifications remain blocked.

## Next Acceptance Step

Deploy the frontend and web backend, hard-refresh, connect the intended Phantom account and prepare a fresh claim. If rejected, use **Copy claim error details** and inspect the report. Identify whether the change is an extra instruction, changed data, payer, recipient or account permissions. Do not broaden validation without that evidence. For sells use **Copy transaction error details** on a signing validation rejection.

`node server/diagnose-creator-claim.js YOUR_PUBLIC_CREATOR_ADDRESS` is a read-only mainnet builder/simulation check. It uses configured RPC credentials privately, incurs provider requests and never broadcasts. A positive result does not complete the wallet acceptance test.

## Unresolved Risks

The exact Phantom-returned modification has not been captured. Broad Jupiter route economic policy is still unfinished; preserving an existing provider message does not independently audit its router semantics. Multisigner provider routes cannot safely accept wallet changes. Unknown broadcast outcomes require signature rechecks, not blind retries. Independent review and funded controlled acceptance remain required before claiming production safety.
