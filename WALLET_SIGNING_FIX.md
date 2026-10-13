# Wallet Signing Adjustments

Creator claims and swaps now use a shared check for wallet-adjusted messages. This supports blockhash and ComputeBudget limit/price updates only. Economic instruction bytes, ordered recipients/accounts, global signer/writable permissions and address lookup references must remain identical. Extra signers and changes to launch transactions remain blocked.

An adjusted transaction must have a valid blockhash, estimated total network fee no greater than 0.01 SOL, and a successful signed simulation. Creator claims allow at most 400,000 compute units; trades allow at most 1,400,000. Unknown compute instructions and duplicates are rejected.

Unchanged Jupiter transactions retain provider execution. Adjusted, single-signer Jupiter swaps are broadcast through the configured RPC after validation and simulation, because the original managed request was constructed for a different message. Routes requiring other signatures cannot be safely modified and remain rejected. This does not finish the project's broader Jupiter route-economic audit; it preserves the reviewed provider instructions rather than decoding all router semantics.

Deploy both frontend and web backend (including the isBlockhashValid RPC allowlist), then prepare fresh quotes/claims. No new migration is needed for this signing change; pending capacity changes still require their own migration. No funded transaction was submitted during verification.

Focused tests: `node --test tests/claim-message.test.js`; mocked browser signing check: `npx playwright test tests/ui/signed-adjustment.spec.js`. Browser fixtures sign disposable test keys and mock RPC broadcast; they do not prove Phantom mainnet acceptance.
