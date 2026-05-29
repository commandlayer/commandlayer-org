alter table if exists claim_agents
  add column if not exists agent_ens_name text,
  add column if not exists tenant_signer_kid text,
  add column if not exists tenant_signer_public_key text,
  add column if not exists tenant_signer_canonicalization text not null default 'json.sorted_keys.v1',
  add column if not exists tenant_signer_created_at timestamptz,
  add column if not exists tenant_signer_status text not null default 'generated';

update claim_agents
set agent_ens_name = ens
where agent_ens_name is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'claim_agents_tenant_signer_status_check'
  ) then
    alter table claim_agents
      add constraint claim_agents_tenant_signer_status_check
      check (tenant_signer_status in ('generated', 'records_pending', 'records_published', 'verified'));
  end if;
end $$;
