alter table if exists claim_requests
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists approved_at timestamptz,
  add column if not exists admin_notes text,
  add column if not exists last_error text,
  add column if not exists last_error_at timestamptz;

create table if not exists claim_status_transitions (
  id uuid primary key default gen_random_uuid(),
  claim_id text not null references claim_requests(claim_id) on delete cascade,
  from_status text,
  to_status text not null,
  action text not null,
  actor text,
  reason text,
  metadata_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_claim_status_transitions_claim_id
  on claim_status_transitions(claim_id);
