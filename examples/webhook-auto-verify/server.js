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

    if (!verifyResponse.ok && verifyResponse.status !== 200) {
      return res.status(502).json({
        status: "rejected",
        reason: "Verification service returned unexpected status",
      });
    }

    const verifyJson = await verifyResponse.json();
    const verified = Boolean(verifyJson?.ok);

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
      checks: verifyJson?.checks || {},
    });
  } catch (error) {
    return res.status(502).json({
      status: "rejected",
      reason: "Verification service unavailable",
      detail: error && error.message ? error.message : "Unknown error",
    });
  }
});

app.listen(PORT, () => {
  process.stdout.write(`Webhook auto-verify demo listening on port ${PORT}\n`);
});
