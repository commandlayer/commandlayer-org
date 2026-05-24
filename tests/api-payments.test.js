'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

function makeRes(){return{statusCode:200,headers:{},body:null,setHeader(n,v){this.headers[n.toLowerCase()]=v;},status(c){this.statusCode=c;return this;},json(p){this.body=p;return this;}}}
function normalizeRows(r){if(Array.isArray(r))return r;if(r&&Array.isArray(r.rows))return r.rows;return []}

function loadCheckout(mockQuery, stripeMock){
  const p = require.resolve('../api/admin/create-checkout-session');
  const dbp = require.resolve('../lib/db');
  delete require.cache[p]; delete require.cache[dbp];
  require.cache[dbp]={exports:{query:mockQuery,normalizeRows,getDatabaseUrl:()=>process.env.DATABASE_URL}};
  const sp=require.resolve('../lib/stripe-client'); delete require.cache[sp]; require.cache[sp]={exports:stripeMock};
  return require('../api/admin/create-checkout-session');
}
function loadWebhook(mockQuery, stripeMock){
  const p = require.resolve('../api/stripe/webhook');
  const dbp = require.resolve('../lib/db');
  delete require.cache[p]; delete require.cache[dbp];
  require.cache[dbp]={exports:{query:mockQuery,normalizeRows,getDatabaseUrl:()=>process.env.DATABASE_URL}};
  const sp=require.resolve('../lib/stripe-client'); delete require.cache[sp]; require.cache[sp]={exports:stripeMock};
  return require('../api/stripe/webhook');
}

const StripeMock = function(){return{checkout:{sessions:{create:async()=>({id:'cs_1',url:'https://checkout.stripe.test/cs_1'})}},webhooks:{constructEvent:()=>({})}}};

test('missing STRIPE_SECRET_KEY returns STRIPE_NOT_CONFIGURED', async()=>{delete process.env.STRIPE_SECRET_KEY; process.env.ADMIN_API_KEY='k'; const h=loadCheckout(()=>[],()=>{const e=new Error('missing');e.code='STRIPE_NOT_CONFIGURED';throw e;}); const r=makeRes(); await h({method:'POST',headers:{authorization:'Bearer k'},body:{claimId:'clm_1'}},r); assert.equal(r.statusCode,503); assert.equal(r.body.status,'STRIPE_NOT_CONFIGURED');});
test('pk_ STRIPE_SECRET_KEY returns STRIPE_SECRET_KEY_INVALID', async()=>{process.env.ADMIN_API_KEY='k'; const h=loadCheckout(()=>[],()=>{const e=new Error('bad');e.code='STRIPE_SECRET_KEY_INVALID';throw e;}); const r=makeRes(); await h({method:'POST',headers:{authorization:'Bearer k'},body:{claimId:'clm_1'}},r); assert.equal(r.statusCode,503); assert.equal(r.body.status,'STRIPE_SECRET_KEY_INVALID');});
test('unauthorized admin checkout rejected', async()=>{process.env.STRIPE_SECRET_KEY='sk';process.env.ADMIN_API_KEY='k'; const h=loadCheckout(async()=>[],StripeMock); const r=makeRes(); await h({method:'POST',headers:{},body:{claimId:'clm_1'}},r); assert.equal(r.statusCode,401);});
test('claim not cards_published rejected', async()=>{process.env.STRIPE_SECRET_KEY='sk';process.env.ADMIN_API_KEY='k'; const h=loadCheckout(async(q)=>String(q).includes('from claim_requests')?[{claim_id:'clm_1',status:'approved'}]:[],StripeMock); const r=makeRes(); await h({method:'POST',headers:{authorization:'Bearer k'},body:{claimId:'clm_1'}},r); assert.equal(r.body.status,'CLAIM_NOT_READY_FOR_PAYMENT');});
test('stripe session creation failure does not update claim status', async()=>{process.env.STRIPE_SECRET_KEY='sk';process.env.ADMIN_API_KEY='k'; const calls=[]; const h=loadCheckout(async(q)=>{calls.push(String(q)); if(String(q).includes('from claim_requests')) return [{claim_id:'clm_1',status:'cards_published',tenant:'commandlayer',pack_id:'founding'}]; return [];},function(){return{checkout:{sessions:{create:async()=>{const e=new Error('boom');e.code='api_error';throw e;}}}}}); const r=makeRes(); await h({method:'POST',headers:{authorization:'Bearer k'},body:{claimId:'clm_1'}},r); assert.equal(r.body.status,'CHECKOUT_SESSION_CREATE_FAILED'); assert.equal(calls.some(c=>c.includes("set status = 'payment_pending'")),false);});
test('cards_published claim creates checkout and returns checkoutUrl', async()=>{process.env.STRIPE_SECRET_KEY='sk';process.env.ADMIN_API_KEY='k'; const calls=[]; const h=loadCheckout(async(q,p)=>{calls.push(String(q)); if(String(q).includes('from claim_requests')) return [{claim_id:'clm_1',status:'cards_published',tenant:'commandlayer',pack_id:'founding'}]; return [];},StripeMock); const r=makeRes(); await h({method:'POST',headers:{authorization:'Bearer k'},body:{claimId:'clm_1'}},r); assert.equal(r.body.status,'CHECKOUT_SESSION_CREATED'); assert.equal(r.body.checkoutUrl,'https://checkout.stripe.test/cs_1'); assert.ok(calls.some(c=>c.includes("set status = 'payment_pending'"))); assert.ok(calls.some(c=>c.includes('payment.checkout_created'))); assert.ok(calls.some(c=>c.includes('cards_published')&&c.includes('payment_pending')));});

test('webhook invalid signature rejected', async()=>{process.env.STRIPE_SECRET_KEY='sk';process.env.STRIPE_WEBHOOK_SECRET='wh'; const Bad=function(){return{webhooks:{constructEvent:()=>{throw new Error('bad')}}}}; const h=loadWebhook(async()=>[],Bad); const r=makeRes(); await h({method:'POST',headers:{'stripe-signature':'x'},body:'{}'},r); assert.equal(r.body.status,'WEBHOOK_SIGNATURE_INVALID');});

test('checkout.session.completed marks claim paid + idempotent', async()=>{process.env.STRIPE_SECRET_KEY='sk';process.env.STRIPE_WEBHOOK_SECRET='wh'; let paid=false; const calls=[]; const Stripe=function(){return{webhooks:{constructEvent:()=>({type:'checkout.session.completed',data:{object:{id:'cs_1',payment_intent:'pi_1',metadata:{claimId:'clm_1'}}}})}}}; const h=loadWebhook(async(q)=>{calls.push(String(q)); if(String(q).includes('from claim_requests')) return [paid?{claim_id:'clm_1',status:'paid',payment_status:'paid'}:{claim_id:'clm_1',status:'payment_pending'}]; if(String(q).includes("set status = 'paid'")) paid=true; return [];},Stripe); let r=makeRes(); await h({method:'POST',headers:{'stripe-signature':'x'},body:'{}'},r); assert.equal(r.body.ok,true); assert.ok(calls.some(c=>c.includes('payment.completed')));
 r=makeRes(); await h({method:'POST',headers:{'stripe-signature':'x'},body:'{}'},r); assert.equal(r.body.ok,true);
});
