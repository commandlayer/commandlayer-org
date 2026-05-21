# Webhook Auto-Verification Example

This example shows automatic verification. No manual paste is required.

## Flow

1. Runtime signs receipt.
2. Webhook receives receipt.
3. Server posts receipt to verifier.
4. Valid receipt returns accepted.
5. Tampered receipt returns rejected.

## Commands

```bash
cd examples/webhook-auto-verify
npm install
npm run check
npm run generate:samples
npm start
```

In another terminal:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  --data @sample-canonical-shape-webhook.json

curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  --data @sample-canonical-shape-tampered-webhook.json
```

Expected:
- valid -> 200 accepted
- tampered -> 400 rejected

## Environment variables

- `COMMANDLAYER_VERIFY_URL`
- `COMMANDLAYER_SIGN_URL`
- `PORT`

## Trust boundaries

- Runtime signs.
- Verifier validates.
- MCP bridges.
- SDK wraps.
- Schema-valid alone is not verified.
- Verification requires hash and signature checks.
- Webhook sender authentication is separate from receipt verification.


## Note on sample files

If your environment can reach `https://runtime.commandlayer.org`, run `npm run generate:samples` to create real live samples (`sample-valid-webhook.json` and `sample-tampered-webhook.json`).
In offline or restricted environments, the committed `sample-canonical-shape-*.json` files are structure-only placeholders and are not verifiable runtime receipts.
