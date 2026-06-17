'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../lib/db');
const prepare = require('../api/admin/prepare-managed-ens-publication');
const verify = require('../api/admin/verify-managed-ens-publication');
const status = require('../api/claims/status');
const { buildManagedEnsPublicationPackage } = require('../lib/claims/managed-ens-publication');
const { hashClaimAccessToken } = require('../lib/claims/access-token');

function makeRes(){return {statusCode:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(p){this.body=p;return this;}};}
const token = 'tok';
const tokenHash = hashClaimAccessToken(token);
function claim(overrides={}){return {claim_id:'c1',claim_access_token_hash:tokenHash,tenant:'acme',activation_mode:'managed_namespace',tenant_signer_ens:'acme.attestagent.eth',tenant_signer_public_key:'ed25519:pub',tenant_signer_kid:'kid1',tenant_signer_canonicalization:'json.sorted_keys.v1',request_json:{'cl.receipt.signer':'acme.attestagent.eth'},...overrides};}

test('managed claim can prepare publication package', async()=>{
  process.env.ADMIN_API_KEY='admin'; let updated=false;
  db.query=async(q)=> q.includes('select * from claim_requests') ? {rows:[claim()]} : (updated=true,{rows:[],rowCount:1});
  const res=makeRes(); await prepare({method:'POST',headers:{'x-admin-api-key':'admin'},body:{claimId:'c1'}},res);
  assert.equal(res.statusCode,200); assert.equal(updated,true); assert.equal(res.body.publication.signer_ens,'acme.attestagent.eth'); assert.equal(res.body.publication.required_txt_records['cl.receipt.signer'],'acme.attestagent.eth');
});

test('BYO/root signer claim is rejected by managed helper',()=>{assert.throws(()=>buildManagedEnsPublicationPackage(claim({activation_mode:'bring_your_own_ens'})),/only available/);});
test('missing tenant_signer_ens rejected',()=>{assert.throws(()=>buildManagedEnsPublicationPackage(claim({tenant_signer_ens:''})),/tenant_signer_ens/);});
test('tenant root ENS rejected in managed mode',()=>{assert.throws(()=>buildManagedEnsPublicationPackage(claim({tenant_signer_ens:'acme.eth'})),/approved managed parent|root ENS/);});
test('unapproved parent namespace rejected',()=>{assert.throws(()=>buildManagedEnsPublicationPackage(claim({tenant_signer_ens:'acme.badagent.eth'})),/approved managed parent/);});
test('mismatched cl.receipt.signer rejected',()=>{assert.throws(()=>buildManagedEnsPublicationPackage(claim({request_json:{'cl.receipt.signer':'other.attestagent.eth'}})),/must match/);});

test('successful verification updates managed ENS and signer statuses', async()=>{
  process.env.ADMIN_API_KEY='admin'; const updates=[];
  db.query=async(q,params)=>{ if(q.includes('select * from claim_requests')) return {rows:[claim()]}; updates.push({q,params}); return {rows:[],rowCount:1}; };
  const resolver=async(_ens,key)=>({'cl.sig.pub':'ed25519:pub','cl.sig.kid':'kid1','cl.sig.canonical':'json.sorted_keys.v1','cl.receipt.signer':'acme.attestagent.eth'}[key]);
  const res=makeRes(); await verify({method:'POST',headers:{'x-admin-api-key':'admin'},body:{claimId:'c1'},verifyOptions:{textResolver:resolver}},res);
  assert.equal(res.statusCode,200); assert.equal(res.body.verification.ok,true); assert.ok(updates[0].q.includes("tenant_signer_record_status = 'records_verified'"));
});

test('failed verification stores error and does not mark signer verified', async()=>{
  process.env.ADMIN_API_KEY='admin'; const updates=[];
  db.query=async(q,params)=>{ if(q.includes('select * from claim_requests')) return {rows:[claim()]}; updates.push({q,params}); return {rows:[],rowCount:1}; };
  const resolver=async(_ens,key)=> key === 'cl.sig.pub' ? 'wrong' : ({'cl.sig.kid':'kid1','cl.sig.canonical':'json.sorted_keys.v1','cl.receipt.signer':'acme.attestagent.eth'}[key]);
  const res=makeRes(); await verify({method:'POST',headers:{'x-admin-api-key':'admin'},body:{claimId:'c1'},verifyOptions:{textResolver:resolver}},res);
  assert.equal(res.statusCode,200); assert.equal(res.body.verification.ok,false); assert.ok(!updates[0].q.includes("tenant_signer_record_status = 'records_verified'")); assert.equal(updates[0].params[2],'required_txt_record_mismatch');
});

test('public claim status includes managed ENS publication status', async()=>{
  db.query=async(q)=>{ if(q.includes('from claim_requests')) return {rows:[claim({managed_ens_publication_status:'ready_to_publish',managed_ens_required_txt_records:{'cl.sig.kid':'kid1'}})]}; if(q.includes('from agent_cards')) return {rows:[]}; return {rows:[]}; };
  const res=makeRes(); await status({method:'GET',query:{claimId:'c1'},headers:{'x-claim-access-token':token}},res);
  assert.equal(res.statusCode,200); assert.equal(res.body.pipeline.managed_ens_publication,'ready_to_publish'); assert.equal(res.body.claim.managed_ens_publication.helper_copy.includes('operator must publish'),true); assert.deepEqual(res.body.claim.managed_ens_publication.record_names,['cl.sig.kid']);
});
