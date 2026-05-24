# Environment configuration (operations)

This document lists production-focused environment variables used by `commandlayer-org` verifier, ENS lookup endpoints, and signing paths.

## Preferred production RPC configuration

For production ENS-related lookups, configure **one explicit mainnet RPC endpoint**:

- Preferred: `ETHEREUM_RPC_URL`
- Backward-compatible alternatives: `MAINNET_RPC_URL`, `ALCHEMY_ETHEREUM_RPC_URL`
- If only `ALCHEMY_API_KEY` is set, the app constructs `https://eth-mainnet.g.alchemy.com/v2/<key>`.
- Default/provider fallback is last resort and can hit shared-rate limits.

## Environment variable table

| Env var | Required | Used by | Production purpose | Safe example placeholder |
|---|---|---|---|---|
| `ETHEREUM_RPC_URL` | Recommended | `api/ens/owned.js` | Primary explicit Ethereum mainnet RPC for ENS reverse lookup without shared default provider throttling. | `https://mainnet.example-rpc.com/v1/<project-id>` |
| `MAINNET_RPC_URL` | Optional | `api/ens/owned.js` | Backward-compatible alternative mainnet RPC variable. | `https://mainnet.example-rpc.com/v1/<project-id>` |
| `ALCHEMY_ETHEREUM_RPC_URL` | Optional | `api/ens/owned.js` | Backward-compatible explicit Alchemy HTTPS RPC URL. | `https://eth-mainnet.g.alchemy.com/v2/<alchemy-key>` |
| `ALCHEMY_API_KEY` | Optional | `api/ens/owned.js` | If set (without explicit RPC URL), converted to an Alchemy mainnet HTTPS RPC URL. | `<alchemy-api-key>` |
| `SIMPLEHASH_API_KEY` | Optional | `api/ens/owned.js` | API key for ENS ownership lookup via SimpleHash NFT owner API (separate from ENS TXT verification). | `<simplehash-api-key>` |
| `COMMANDLAYER_ALLOW_LOCAL_KEY_FALLBACK` | Optional (dangerous in prod) | `lib/verifyReceipt.js` | Enables local test/demo signer-key fallback. **Do not enable in production** unless intentionally running demo fallback behavior. | `false` |
| `COINBASE_WEBHOOK_SECRET` | Required (if Coinbase webhook endpoint enabled) | `api/examples/coinbase-webhook.js`, `lib/coinbaseWebhook.js` | Verifies Coinbase webhook signatures. | `<coinbase-webhook-secret>` |
| `CL_RECEIPT_SIGNER_ID` | Required (for CL-prefixed signing path) | `lib/receiptSigning.js`, webhook/x402 APIs | Canonical signer ID used in receipt proof metadata. | `runtime.commandlayer.eth` |
| `CL_RECEIPT_SIGNING_KID` | Required (for CL-prefixed signing path) | `lib/receiptSigning.js`, webhook/x402 APIs | Key identifier for receipt signature metadata. | `kid_prod_2026_01` |
| `RECEIPT_SIGNING_PRIVATE_KEY_PEM_B64` | Required (legacy/non-CL path) | `lib/receiptSigning.js`, webhook/x402 APIs | Base64-encoded PEM private key used to sign receipts when legacy variable path is used. | `<base64-encoded-pem>` |
| `X402_PROVIDER_VERIFICATION_URL` | Optional (required for provider-verification mode) | `lib/x402ProviderVerification.js`, `api/examples/x402-paid-action.js` | External payment-provider verification endpoint for x402 flow. | `https://provider.example.com/verify` |
| `X402_PROVIDER_API_KEY` | Optional | `lib/x402ProviderVerification.js` | Bearer token for provider-verification endpoint authentication. | `<provider-api-key>` |

## Notes

- ENS TXT verification for receipt keys in `lib/verifyReceipt.js` is resolver-injected and ENS-first; local fallback remains gated.
- `api/ens/owned.js` ownership discovery uses SimpleHash and reverse lookup RPC/provider logic, which is separate from receipt proof verification.
