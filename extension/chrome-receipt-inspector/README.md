# VerifyAgent Evidence Verifier — Chrome Extension MVP

A passive Manifest V3 browser extension for verifying agent-related receipts and evidence without changing the pages you browse.

## v0.1 capabilities

- Verifies full CommandLayer / CLAS receipts through `https://www.commandlayer.org/api/verify`.
- Verifies stored `clrcpt_…` receipt IDs through `/api/verify-id`.
- Detects receipt IDs, ENS names, and transaction hashes on the current page.
- Can verify selected text from the page.
- Uses four explicit outcomes: `VERIFIED`, `PARTIAL`, `INVALID`, `UNVERIFIABLE`.
- Never equates cryptographic validity with safety or endorsement.

## Adapter model

`adapters.js` is the extension's compatibility boundary. New receipt/evidence formats should be added as adapters rather than forcing every ecosystem into CLAS.

Current live adapter:

- CLAS / CommandLayer receipt verification

Recognized but not yet fully verified:

- ENS names
- transaction hashes
- unknown JSON receipt formats

Planned adapters:

- ERC-8004 identity / registry evidence
- ENSIP-25/26 agent bindings and endpoints
- Agent Receipts / RFC 8785 JCS
- x402 settlement evidence
- Ethereum/Base transaction verification
- ERC-8217 controller bindings
- W3C Verifiable Credentials / JWS

## Load locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `extension/chrome-receipt-inspector`.
5. Pin **VerifyAgent — Evidence Verifier**.

Paste receipt JSON into the popup or highlight evidence on a webpage and click the extension.
