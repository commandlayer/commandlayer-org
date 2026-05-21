import express from 'express';

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const VERIFY_ENDPOINT = process.env.COMMANDLAYER_VERIFY_URL || 'https://runtime.commandlayer.org/verify';

app.post('/webhook', async (req, res) => {
  const { event, receipt } = req.body || {};

  if (!event || !receipt || typeof receipt !== 'object') {
    return res.status(400).json({
      status: 'rejected',
      reason: 'Missing required event or receipt'
    });
  }

  try {
    const verifyResponse = await fetch(VERIFY_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ receipt })
    });

    const verifyJson = await verifyResponse.json();
    const verifierStatus = verifyJson?.status ?? 'UNKNOWN';
    const checks = verifyJson?.checks ?? {};
    const errors = Array.isArray(verifyJson?.errors) ? verifyJson.errors : [];

    console.log('webhook verify result', {
      event,
      verifier_endpoint: VERIFY_ENDPOINT,
      verifier_status: verifierStatus,
      hash_matches: checks?.hash_matches,
      signature_valid: checks?.signature_valid,
      signer_id: checks?.signer_id,
      kid: checks?.kid
    });

    const accepted = verifyJson?.ok === true || verifierStatus === 'VALID' || verifierStatus === 'VERIFIED';

    if (accepted) {
      return res.status(200).json({
        status: 'accepted',
        event,
        verifier_status: verifierStatus,
        checks
      });
    }

    return res.status(400).json({
      status: 'rejected',
      event,
      reason: 'Receipt verification failed',
      verifier_status: verifierStatus,
      checks,
      errors
    });
  } catch (error) {
    return res.status(502).json({
      status: 'rejected',
      event,
      reason: 'Verifier request failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.listen(PORT, () => {
  console.log(`Webhook auto-verify demo listening on http://localhost:${PORT}`);
  console.log(`Using verifier endpoint: ${VERIFY_ENDPOINT}`);
  console.log('Security note: this is a demo. Production webhooks require sender authentication, replay protection, timestamp checks, rate limiting, and event idempotency.');
  console.log('Receipt verification proves receipt integrity; it does not replace webhook sender authentication.');
});
