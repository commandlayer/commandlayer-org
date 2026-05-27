'use strict';

const crypto = require('node:crypto');

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function pinJsonToPinata(cardJson) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error('PINATA_JWT_MISSING');
  const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pinataContent: cardJson }),
  });
  if (!response.ok) throw new Error(`PINATA_ERROR_${response.status}`);
  const body = await response.json();
  if (!body || !body.IpfsHash) throw new Error('PINATA_MISSING_CID');
  return body.IpfsHash;
}

module.exports = { stableStringify, sha256Hex, pinJsonToPinata };
