alter table if exists agent_cards
  add column if not exists card_cid text,
  add column if not exists card_ipfs_uri text,
  add column if not exists card_gateway_url text,
  add column if not exists card_sha256 text,
  add column if not exists card_pinned_at timestamptz,
  add column if not exists pinning_provider text,
  add column if not exists pin_status text,
  add column if not exists pin_error text;
