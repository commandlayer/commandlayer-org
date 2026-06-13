alter table if exists claim_requests
  add column if not exists first_action_receipt_json jsonb,
  add column if not exists first_action_receipt_id text,
  add column if not exists first_action_receipt_hash text,
  add column if not exists first_action_receipt_status text default 'not_generated',
  add column if not exists first_action_receipt_verified_at timestamptz,
  add column if not exists first_action_receipt_error text;

create index if not exists idx_claim_requests_first_action_receipt_status on claim_requests(first_action_receipt_status);
