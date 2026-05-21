import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SIGN_ENDPOINT = process.env.COMMANDLAYER_SIGN_URL || 'https://runtime.commandlayer.org/trust-verification/sign/v1.0.0';

const body = {
  payload: {
    message: 'hello from webhook auto verify',
    source: 'examples/webhook-auto-verify',
    ts: new Date().toISOString()
  }
};

const response = await fetch(SIGN_ENDPOINT, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
});

if (!response.ok) {
  throw new Error(`Sign request failed: ${response.status} ${response.statusText}`);
}

const json = await response.json();
const receipt = json?.receipt ?? json?.final_receipt;

if (!receipt || typeof receipt !== 'object') {
  throw new Error('No receipt found in sign response (expected response.receipt or response.final_receipt)');
}

if (!receipt?.metadata?.proof) {
  throw new Error('Receipt missing canonical metadata.proof');
}

const validWebhook = {
  event: 'commandlayer.receipt.created',
  receipt
};

const tamperedWebhook = JSON.parse(JSON.stringify(validWebhook));
if (!tamperedWebhook?.receipt?.result?.payload || typeof tamperedWebhook.receipt.result.payload !== 'object') {
  throw new Error('Receipt shape missing receipt.result.payload; cannot produce tampered sample safely');
}
tamperedWebhook.receipt.result.payload.message = 'tampered webhook payload';

await writeFile(resolve('sample-valid-webhook.json'), `${JSON.stringify(validWebhook, null, 2)}\n`, 'utf8');
console.log('SAMPLE 1 VALID WRITTEN');

await writeFile(resolve('sample-tampered-webhook.json'), `${JSON.stringify(tamperedWebhook, null, 2)}\n`, 'utf8');
console.log('SAMPLE 2 TAMPERED WRITTEN');
