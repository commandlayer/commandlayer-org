# Wrap your agent

## VerifyAgent.eth callable endpoint

`POST /api/agents/verifyagent`

Example body:

```json
{
  "receipt": { "...": "..." }
}
```

VerifyAgent.eth is a callable verification interface for CommandLayer receipts. It does not execute the original task; it verifies whether a submitted receipt is valid or tampered.
