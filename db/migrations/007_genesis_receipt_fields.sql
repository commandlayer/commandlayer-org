alter table if exists claim_requests
  add column if not exists genesis_receipt_json jsonb,
  add column if not exists genesis_receipt_hash text,
  add column if not exists genesis_receipt_id text,
  add column if not exists genesis_generated_at timestamptz,
  add column if not exists receipt_chain_root text;
