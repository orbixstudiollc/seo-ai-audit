-- SK3: agent orchestrator run persistence (DATA-CONTRACT §9). One row per
-- agent-mode run: the plan, per-skill results as they land, any pending
-- handoff task ids, and the final action plan. Same posture as every
-- phase-1+ table: RLS enabled, zero public grants, server-secret access
-- only, and the account-claim RPC updated IN THE SAME migration
-- (202607200004/5/202607210006 precedent — shipping them apart silently
-- breaks workspace linking).

create table if not exists public.agent_runs (
  owner_hash text not null,
  id text not null,
  url text not null,
  business_type text not null,
  status text not null check (status in ('running', 'complete', 'failed')),
  plan jsonb not null default '[]'::jsonb,
  skill_results jsonb not null default '{}'::jsonb,
  pending_task_ids jsonb not null default '[]'::jsonb,
  action_plan jsonb,
  est_cost_usd numeric not null default 0,
  actual_cost_usd numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_hash, id)
);

create index if not exists agent_runs_owner_created_idx
  on public.agent_runs (owner_hash, created_at desc);

alter table public.agent_runs enable row level security;
revoke all on public.agent_runs from public, anon, authenticated;

-- Account claim: full body from 202607210006, plus an agent_runs
-- newer-wins merge block (pattern-copied from the audit_runs block) and an
-- agent_runs tail delete (ordered first, before share_links).

create or replace function public.claim_anonymous_workspace(
  p_device_hash text,
  p_user_hash text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_device_hash is null or p_user_hash is null
     or length(p_device_hash) <> 64 or length(p_user_hash) <> 64 then
    raise exception 'invalid owner hash';
  end if;
  if p_device_hash = p_user_hash then return; end if;

  insert into audit_runs (
    owner_hash, id, version, url, final_url, title, mode, created_at, status,
    scores, page_count, details, report_available, updated_at
  )
  select p_user_hash, id, version, url, final_url, title, mode, created_at,
    status, scores, page_count, details, report_available, updated_at
  from audit_runs where owner_hash = p_device_hash
  on conflict (owner_hash, id) do update set
    version = excluded.version, url = excluded.url, final_url = excluded.final_url,
    title = excluded.title, mode = excluded.mode, created_at = excluded.created_at,
    status = excluded.status, scores = excluded.scores,
    page_count = excluded.page_count, details = excluded.details,
    report_available = excluded.report_available, updated_at = excluded.updated_at
  where excluded.updated_at > audit_runs.updated_at;

  insert into agent_runs (
    owner_hash, id, url, business_type, status, plan, skill_results,
    pending_task_ids, action_plan, est_cost_usd, actual_cost_usd, created_at, updated_at
  )
  select p_user_hash, id, url, business_type, status, plan, skill_results,
    pending_task_ids, action_plan, est_cost_usd, actual_cost_usd, created_at, updated_at
  from agent_runs where owner_hash = p_device_hash
  on conflict (owner_hash, id) do update set
    url = excluded.url, business_type = excluded.business_type, status = excluded.status,
    plan = excluded.plan, skill_results = excluded.skill_results,
    pending_task_ids = excluded.pending_task_ids, action_plan = excluded.action_plan,
    est_cost_usd = excluded.est_cost_usd, actual_cost_usd = excluded.actual_cost_usd,
    updated_at = excluded.updated_at
  where excluded.updated_at > agent_runs.updated_at;

  update audit_runs destination
  set report_available = true
  from audit_runs source
  where source.owner_hash = p_device_hash
    and destination.owner_hash = p_user_hash
    and destination.id = source.id
    and source.report_available = true
    and destination.report_available = false;

  insert into audit_reports (owner_hash, audit_id, version, kind, created_at, payload, updated_at)
  select p_user_hash, audit_id, version, kind, created_at, payload, updated_at
  from audit_reports where owner_hash = p_device_hash
  on conflict (owner_hash, audit_id) do update set
    version = excluded.version, kind = excluded.kind, created_at = excluded.created_at,
    payload = excluded.payload, updated_at = excluded.updated_at
  where excluded.updated_at > audit_reports.updated_at;

  insert into device_settings (owner_hash, version, settings, updated_at)
  select p_user_hash, version, settings, updated_at
  from device_settings where owner_hash = p_device_hash
  on conflict (owner_hash) do update set
    version = excluded.version, settings = excluded.settings,
    updated_at = excluded.updated_at
  where excluded.updated_at > device_settings.updated_at;

  insert into provider_tasks (
    owner_hash, audit_id, provider, request_fingerprint, provider_task_id,
    status, request, result_meta, created_at, updated_at
  )
  select p_user_hash, audit_id, provider, request_fingerprint, provider_task_id,
    status, request, result_meta, created_at, updated_at
  from provider_tasks where owner_hash = p_device_hash
  on conflict (owner_hash, audit_id, provider, request_fingerprint) do update set
    provider_task_id = excluded.provider_task_id, status = excluded.status,
    request = excluded.request, result_meta = excluded.result_meta,
    updated_at = excluded.updated_at
  where excluded.updated_at > provider_tasks.updated_at;

  insert into usage_ledger (
    owner_hash, audit_id, provider, operation, estimated_cost_usd,
    actual_cost_usd, metadata, created_at
  )
  select p_user_hash, audit_id, provider, operation, estimated_cost_usd,
    actual_cost_usd, metadata, created_at
  from usage_ledger where owner_hash = p_device_hash
  on conflict (owner_hash, audit_id, provider, operation) do update set
    estimated_cost_usd = excluded.estimated_cost_usd,
    actual_cost_usd = excluded.actual_cost_usd,
    metadata = excluded.metadata;

  insert into tracked_sites (owner_hash, url, created_at, updated_at, last_run_at)
  select p_user_hash, url, created_at, updated_at, last_run_at
  from tracked_sites where owner_hash = p_device_hash
  on conflict (owner_hash, url) do update set
    updated_at = excluded.updated_at, last_run_at = excluded.last_run_at
  where excluded.updated_at > tracked_sites.updated_at;

  insert into site_snapshots (
    owner_hash, url, captured_on, det_scores, lens_estimate, signals_version,
    content_hash, fetch_meta, created_at, updated_at
  )
  select p_user_hash, url, captured_on, det_scores, lens_estimate,
    signals_version, content_hash, fetch_meta, created_at, updated_at
  from site_snapshots where owner_hash = p_device_hash
  on conflict (owner_hash, url, captured_on) do update set
    det_scores = excluded.det_scores, lens_estimate = excluded.lens_estimate,
    signals_version = excluded.signals_version,
    content_hash = excluded.content_hash, fetch_meta = excluded.fetch_meta,
    updated_at = excluded.updated_at
  where excluded.updated_at > site_snapshots.updated_at;

  update share_links moved
  set owner_hash = p_user_hash
  where moved.owner_hash = p_device_hash
    and not exists (
      select 1 from share_links existing
      where existing.owner_hash = p_user_hash
        and existing.audit_id = moved.audit_id
    );

  delete from agent_runs where owner_hash = p_device_hash;
  delete from share_links where owner_hash = p_device_hash;
  delete from site_snapshots where owner_hash = p_device_hash;
  delete from tracked_sites where owner_hash = p_device_hash;
  delete from usage_ledger where owner_hash = p_device_hash;
  delete from device_settings where owner_hash = p_device_hash;
  delete from audit_runs where owner_hash = p_device_hash;
end;
$$;

revoke all on function public.claim_anonymous_workspace(text, text) from public, anon, authenticated;
grant execute on function public.claim_anonymous_workspace(text, text) to service_role;
