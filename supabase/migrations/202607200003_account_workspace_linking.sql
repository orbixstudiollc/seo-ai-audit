-- Phase 5: atomically attach the current anonymous workspace to a verified
-- Supabase Auth user. The application supplies SHA-256 owner hashes; raw
-- browser tokens and user IDs are never stored in these tables.

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
    owner_hash, audit_id, provider, provider_task_id, status, request,
    result_meta, created_at, updated_at
  )
  select p_user_hash, audit_id, provider, provider_task_id, status, request,
    result_meta, created_at, updated_at
  from provider_tasks where owner_hash = p_device_hash
  on conflict (owner_hash, audit_id, provider) do update set
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

  delete from usage_ledger where owner_hash = p_device_hash;
  delete from device_settings where owner_hash = p_device_hash;
  delete from audit_runs where owner_hash = p_device_hash;
end;
$$;

revoke all on function public.claim_anonymous_workspace(text, text) from public, anon, authenticated;
grant execute on function public.claim_anonymous_workspace(text, text) to service_role;
