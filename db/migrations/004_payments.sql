-- 004_payments.sql

alter table if exists claim_requests
  add column if not exists payment_status text,
  add column if not exists payment_amount_cents integer,
  add column if not exists payment_currency text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists paid_at timestamptz;

create table if not exists claim_payments (
  id uuid primary key default gen_random_uuid(),
  claim_id text not null references claim_requests(claim_id) on delete cascade,
  provider text not null default 'stripe',
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  amount_cents integer not null,
  currency text not null default 'usd',
  status text not null,
  metadata_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_claim_payments_claim_id on claim_payments(claim_id);
create index if not exists idx_claim_payments_status on claim_payments(status);
create index if not exists idx_claim_payments_checkout_session_id on claim_payments(stripe_checkout_session_id);
