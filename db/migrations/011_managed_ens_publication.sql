alter table if exists claim_requests
  add column if not exists managed_ens_publication_status text default 'not_started',
  add column if not exists managed_ens_parent_namespace text,
  add column if not exists managed_ens_publication_instructions jsonb,
  add column if not exists managed_ens_required_txt_records jsonb,
  add column if not exists managed_ens_verified_at timestamptz,
  add column if not exists managed_ens_publication_error text;
