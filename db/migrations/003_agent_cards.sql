alter table if exists claim_agents
  add column if not exists card_url text,
  add column if not exists card_status text,
  add column if not exists card_published_at timestamptz;

create table if not exists agent_cards (
  id uuid primary key default gen_random_uuid(),
  claim_id text not null references claim_requests(claim_id) on delete cascade,
  ens text not null,
  card_url text unique not null,
  card_json jsonb not null,
  version text not null default '1.1.0',
  status text not null default 'published',
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agent_cards_claim_id on agent_cards (claim_id);
create index if not exists idx_agent_cards_ens on agent_cards (ens);
create index if not exists idx_agent_cards_card_url on agent_cards (card_url);
