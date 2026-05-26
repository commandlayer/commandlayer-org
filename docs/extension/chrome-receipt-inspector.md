# Chrome Receipt Inspector (Developer Preview Foundation)

Status: planned / developer preview. Not published to Chrome Web Store.

## Goal
Provide a browser-side helper that can detect potential CommandLayer receipt IDs on pages and help users verify receipts using the public verifier API.

## Detection
The extension content script scans page text for IDs matching:

- `clrcpt_[a-f0-9]{32}`

## Verification path
- Verify endpoint: `https://www.commandlayer.org/api/verify`
- Method: `POST` with JSON body containing a receipt object.

## CORS requirement
`/api/verify` must allow:
- Origins:
  - `https://www.commandlayer.org`
  - `https://commandlayer.org`
  - `chrome-extension://*`
- Methods: `POST`, `OPTIONS`
- Headers: `Content-Type`

## Receipt lookup options
1. Preferred (when implemented): fetch by ID via:
   - `/receipts/{receiptId}.json`
2. Current fallback: popup requires users to paste full receipt JSON.

## Security and scope
- No private keys in extension code.
- No admin or payment endpoints.
- No claims about production store release until launch readiness.
