alter table if exists claim_requests
  add column if not exists claim_access_token_hash text;

create index if not exists idx_claim_requests_claim_access_token_hash on claim_requests(claim_access_token_hash);
