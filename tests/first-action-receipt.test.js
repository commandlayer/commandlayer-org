'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const db = require('../lib/db');
const adminGenerate = require('../api/admin/generate-first-action-receipt');
const submitReceipt = require('../api/claims/submit-first-action-receipt');
const { buildFirstActionReceiptChallenge, executionPayload } = require('../lib/receipts/first-action-receipt');
const { canonicalize, sha256Hex } = require('../lib/receiptSigning');
const { hashClaimAccessToken } = require('../lib/claims/access-token');
const { resetRateLimitForTests } = require('../lib/rateLimit');

function makeRes(){return {statusCode:200,headers:{},body:null,setHeader(n,v){this.headers[n.toLowerCase()]=v;},status(c){this.statusCode=c;return this;},json(p){this.body=p;return this;}};}
const token='claim-token';
const tokenHash=hashClaimAccessToken(token);

async function keypair(){
  const kp=await webcrypto.subtle.generateKey({name:'Ed25519'}, true, ['sign','verify']);
  const raw=Buffer.from(await webcrypto.subtle.exportKey('raw', kp.publicKey)).toString('base64');
  return { kp, publicKey:`ed25519:${raw}` };
}
async function signedReceipt(claim, kp, mutate){
  const receipt=await buildFirstActionReceiptChallenge({claim, agents:[{capability:'verify'}], now:new Date('2026-01-01T00:00:00Z')});
  if (mutate) mutate(receipt);
  const hash=await sha256Hex(canonicalize(executionPayload(receipt)));
  const sig=await webcrypto.subtle.sign({name:'Ed25519'}, kp.privateKey, new TextEncoder().encode(hash));
  receipt.proofs[0].signature.value=Buffer.from(sig).toString('base64');
  return receipt;
}
function claim(overrides={}){return {claim_id:'c1',claim_access_token_hash:tokenHash,status:'paid',payment_status:'paid',paid_at:'2026-01-01T00:00:00Z',tenant:'acme',tenant_signer_ens:'acme.eth',tenant_signer_kid:'kid1',tenant_signer_public_key:'',tenant_signer_record_status:'records_verified',tenant_proof_status:'verified',genesis_receipt_id:'genesis1',...overrides};}

test('cannot generate first action challenge before signer ENS exists', async()=>{
  process.env.ADMIN_API_KEY='k';
  db.query=async(q)=> q.includes('from claim_requests') ? {rows:[claim({tenant_signer_ens:null})]} : {rows:[]};
  const res=makeRes();
  await adminGenerate({method:'POST',headers:{'x-admin-api-key':'k'},body:{claimId:'c1'}},res);
  assert.equal(res.statusCode,400); assert.equal(res.body.status,'TENANT_SIGNER_ENS_REQUIRED');
});

test('cannot generate or verify if signer records are not verified', async()=>{
  resetRateLimitForTests(); process.env.ADMIN_API_KEY='k';
  const c=claim({tenant_signer_record_status:'records_pending'});
  db.query=async(q)=> q.includes('from claim_requests') ? {rows:[c]} : {rows:[]};
  let res=makeRes(); await adminGenerate({method:'POST',headers:{'x-admin-api-key':'k'},body:{claimId:'c1'}},res);
  assert.equal(res.body.status,'TENANT_SIGNER_RECORDS_NOT_VERIFIED');
  res=makeRes(); await submitReceipt({method:'POST',headers:{'x-claim-access-token':token},body:{claimId:'c1',receipt:{}}},res);
  assert.equal(res.body.status,'TENANT_SIGNER_RECORDS_NOT_VERIFIED');
});

test('challenge receipt has correct schema and exact execution covers', async()=>{
  const r=await buildFirstActionReceiptChallenge({claim:claim({tenant_signer_public_key:'ed25519:AA=='}), agents:[{capability:'attest'}], now:new Date('2026-01-01T00:00:00Z')});
  assert.equal(r.schema,'clas.execution.receipt.v1');
  assert.deepEqual(r.proofs[0].covers,['receipt_id','verb','agent','action']);
  assert.equal(r.proofs[0].type,'execution');
});

test('submitted signed receipt validates signer, tamper, settlement-only and bad covers; success stores verified', async()=>{
  resetRateLimitForTests();
  const {kp, publicKey}=await keypair();
  const c=claim({tenant_signer_public_key:publicKey});
  const updates=[];
  db.query=async(q,params)=>{ if(q.includes('from claim_requests')) return {rows:[c]}; if(q.includes('update claim_requests')) {updates.push({q,params}); return {rows:[],rowCount:1};} return {rows:[]}; };
  let bad=await signedReceipt(c,kp,(r)=>{r.agent.ens='evil.eth';});
  let res=makeRes(); await submitReceipt({method:'POST',headers:{'x-claim-access-token':token},body:{claimId:'c1',receipt:bad}},res);
  assert.equal(res.statusCode,400); assert.equal(res.body.status,'SIGNER_MISMATCH');
  bad=await signedReceipt(c,kp); bad.action.output_hash='sha256:tampered';
  res=makeRes(); await submitReceipt({method:'POST',headers:{'x-claim-access-token':token},body:{claimId:'c1',receipt:bad}},res);
  assert.equal(res.body.status,'SIGNATURE_INVALID');
  bad=await signedReceipt(c,kp,(r)=>{r.proofs[0].type='settlement';});
  res=makeRes(); await submitReceipt({method:'POST',headers:{'x-claim-access-token':token},body:{claimId:'c1',receipt:bad}},res);
  assert.equal(res.body.status,'INVALID_PROOF_TYPE');
  bad=await signedReceipt(c,kp,(r)=>{r.proofs[0].covers=['receipt_id','verb','agent','action','settlement'];});
  res=makeRes(); await submitReceipt({method:'POST',headers:{'x-claim-access-token':token},body:{claimId:'c1',receipt:bad}},res);
  assert.equal(res.body.status,'INVALID_PROOF_COVERS');
  const good=await signedReceipt(c,kp);
  res=makeRes(); await submitReceipt({method:'POST',headers:{'x-claim-access-token':token},body:{claimId:'c1',receipt:good}},res);
  assert.equal(res.statusCode,200); assert.equal(res.body.status,'verified');
  assert.ok(updates.some(u=>u.q.includes("first_action_receipt_status = 'verified'")));
});
