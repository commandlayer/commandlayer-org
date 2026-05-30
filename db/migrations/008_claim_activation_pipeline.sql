alter table if exists claim_requests
  add column if not exists tenant_signer_ens text,
  add column if not exists tenant_signer_public_key text,
  add column if not exists tenant_signer_kid text,
  add column if not exists tenant_signer_canonicalization text,
  add column if not exists tenant_signer_record_status text default 'records_pending',
  add column if not exists tenant_signer_records_verified_at timestamptz,
  add column if not exists tenant_signer_records_network text,
  add column if not exists tenant_signer_verification_error text,
  add column if not exists tenant_signer_txt_records jsonb,
  add column if not exists managed_ens_publication_status text default 'not_started',
  add column if not exists managed_ens_parent_namespace text,
  add column if not exists managed_ens_parent_authority_audited boolean default false,
  add column if not exists tenant_proof_status text default 'not_submitted',
  add column if not exists tenant_proof_signer text,
  add column if not exists tenant_proof_verified_at timestamptz;

alter table if exists claim_agents
  add column if not exists card_json jsonb,
  add column if not exists published_card_json jsonb,
  add column if not exists source_json jsonb,
  add column if not exists updated_at timestamptz default now();

create index if not exists idx_claim_requests_tenant_signer_ens on claim_requests(tenant_signer_ens);
create index if not exists idx_claim_requests_tenant_signer_record_status on claim_requests(tenant_signer_record_status);
