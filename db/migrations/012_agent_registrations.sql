create table if not exists public.agent_registrations (
  id uuid primary key default gen_random_uuid(),
  claim_id text not null,
  ens text not null,
  standard text not null default 'erc8004',
  chain_id text not null,
  registry_address text not null,
  agent_id text,
  agent_uri text,
  agent_card_cid text,
  registration_tx_hash text,
  registration_status text not null default 'pending',
  ensip25_status text not null default 'not_checked',
  ensip25_claim_key text,
  ensip25_verified_at timestamptz,
  registered_at timestamptz,
  verified_at timestamptz,
  metadata_json jsonb,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_registrations_claim_id_fkey foreign key (claim_id)
    references public.claim_requests(claim_id) on delete cascade
);

create index if not exists idx_agent_registrations_claim_id on public.agent_registrations(claim_id);
create index if not exists idx_agent_registrations_ens on public.agent_registrations(ens);
create index if not exists idx_agent_registrations_standard on public.agent_registrations(standard);
create index if not exists idx_agent_registrations_registration_status on public.agent_registrations(registration_status);
create index if not exists idx_agent_registrations_agent_id on public.agent_registrations(agent_id);
create unique index if not exists idx_agent_registrations_registry_identity
  on public.agent_registrations(standard, ens, chain_id, registry_address);

create or replace function public.set_agent_registrations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_agent_registrations_updated_at on public.agent_registrations;
create trigger set_agent_registrations_updated_at
before update on public.agent_registrations
for each row execute function public.set_agent_registrations_updated_at();
