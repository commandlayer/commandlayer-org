const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_ENDPOINT = "https://www.commandlayer.org/api/verify";

app.use(express.json({ limit: "1mb" }));

app.post("/webhook", async (req, res) => {
  const { event, receipt } = req.body || {};

  if (!event || !receipt) {
    return res.status(400).json({
      status: "rejected",
      reason: "Missing required fields: event and receipt",
    });
  }

  try {
    const verifyResponse = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ receipt }),
    });

    const verifyJson = await verifyResponse.json();
    const checks = verifyJson?.checks || {};
    const verified = Boolean(verifyJson?.verified);

    console.log("[webhook] verification checks", {
      event,
      schema_valid: checks.schema_valid,
      hash_matched: checks.hash_matched,
      hash_matches: checks.hash_matches,
      signature_valid: checks.signature_valid,
      signer_resolved: checks.signer_resolved,
      ens_resolved: checks.ens_resolved,
      signer_matched: checks.signer_matched,
      trust_verb: checks.trust_verb,
    });

    if (verified) {
      return res.status(200).json({
        status: "accepted",
        event,
      });
    }

    return res.status(400).json({
      status: "rejected",
      event,
      reason: "Receipt verification failed",
      checks,
    });
  } catch (error) {
    console.error("[webhook] verification request failed", error);
    return res.status(502).json({
      status: "rejected",
      reason: "Verification service unavailable",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Webhook auto-verify demo listening on http://localhost:${PORT}`);
});
