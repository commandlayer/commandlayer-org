create extension if not exists pgcrypto;

create table if not exists claim_requests (
  id uuid primary key default gen_random_uuid(),
  claim_id text unique not null,
  authenticated_address text not null,
  tenant text not null,
  activation_mode text not null,
  pack_id text not null,
  public_key text not null,
  kid text not null,
  runtime text not null,
  verifier text not null,
  schema_version text not null,
  status text not null default 'created',
  request_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists claim_agents (
  id uuid primary key default gen_random_uuid(),
  claim_id text not null references claim_requests(claim_id) on delete cascade,
  ens text not null,
  capability text not null,
  canonical_parent text not null,
  skill text not null,
  skill_family text not null,
  status text not null default 'created',
  created_at timestamptz not null default now()
);

create table if not exists claim_events (
  id uuid primary key default gen_random_uuid(),
  claim_id text not null references claim_requests(claim_id) on delete cascade,
  event_type text not null,
  message text not null,
  metadata_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_claim_requests_claim_id on claim_requests(claim_id);
create index if not exists idx_claim_requests_tenant on claim_requests(tenant);
create index if not exists idx_claim_requests_wallet on claim_requests(authenticated_address);
create index if not exists idx_claim_agents_claim_id on claim_agents(claim_id);
create index if not exists idx_claim_events_claim_id on claim_events(claim_id);
