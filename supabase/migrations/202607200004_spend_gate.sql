-- F2-BUDGET (D-016): turn usage_ledger from write-only into a spend gate, and
-- generalize provider_tasks idempotency for per-call providers (SERP/keywords/
-- backlinks need many tasks per audit, not one).
--
-- 1. provider_tasks.request_fingerprint: '' for one-task-per-audit providers
--    (the existing on-page crawl keeps its exact behavior); a sha256 of the
--    canonical request JSON for per-call providers. The unique index and the
--    account-claim RPC change together — shipping them separately silently
--    breaks workspace linking (ws2-gaps precedent).

alter table public.provider_tasks
  add column if not exists request_fingerprint text not null default '';

drop index if exists provider_tasks_owner_audit_provider_unique;
create unique index if not exists provider_tasks_owner_audit_provider_fp_unique
  on public.provider_tasks (owner_hash, audit_id, provider, request_fingerprint);

-- 2. reserve_spend: atomic budget check + reservation. Sums the last 24h of
--    coalesce(actual, estimated) spend for the owner and globally, denies when
--    the new estimate would cross either cap, otherwise inserts the
--    reservation row (estimated set, actual null). The app settles actual
--    cost later via its existing usage_ledger upsert; cancel_spend removes an
--    unsettled reservation when the provider call never started.
--
-- ponytail: pg_advisory_xact_lock serializes ALL reservations — correct and
-- plenty at this scale; move to per-owner locks if reservation throughput
-- ever matters.

create or replace function public.reserve_spend(
  p_owner_hash text,
  p_audit_id text,
  p_provider text,
  p_operation text,
  p_est_cost numeric,
  p_owner_cap numeric,
  p_global_cap numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_spent numeric;
  v_global_spent numeric;
begin
  if p_owner_hash is null or length(p_owner_hash) <> 64 then
    raise exception 'invalid owner hash';
  end if;
  if p_est_cost is null or p_est_cost < 0 or p_owner_cap is null or p_global_cap is null then
    raise exception 'invalid budget arguments';
  end if;

  perform pg_advisory_xact_lock(hashtext('spend_gate'));

  select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd, 0)), 0)
    into v_global_spent
    from usage_ledger
    where created_at > now() - interval '24 hours';

  select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd, 0)), 0)
    into v_owner_spent
    from usage_ledger
    where owner_hash = p_owner_hash
      and created_at > now() - interval '24 hours';

  if v_owner_spent + p_est_cost > p_owner_cap then
    return jsonb_build_object('allowed', false, 'reason', 'owner',
      'owner_spent', v_owner_spent, 'global_spent', v_global_spent);
  end if;
  if v_global_spent + p_est_cost > p_global_cap then
    return jsonb_build_object('allowed', false, 'reason', 'global',
      'owner_spent', v_owner_spent, 'global_spent', v_global_spent);
  end if;

  insert into usage_ledger (owner_hash, audit_id, provider, operation, estimated_cost_usd, metadata)
  values (p_owner_hash, p_audit_id, p_provider, p_operation, p_est_cost, '{}'::jsonb)
  on conflict (owner_hash, audit_id, provider, operation) do update
    set estimated_cost_usd = excluded.estimated_cost_usd;

  return jsonb_build_object('allowed', true, 'reason', null,
    'owner_spent', v_owner_spent, 'global_spent', v_global_spent);
end;
$$;

revoke all on function public.reserve_spend(text, text, text, text, numeric, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.reserve_spend(text, text, text, text, numeric, numeric, numeric)
  to service_role;

-- Remove an unsettled reservation (provider call never started). Settled rows
-- (actual_cost_usd present) are real spend and are never deleted here.
create or replace function public.cancel_spend(
  p_owner_hash text,
  p_audit_id text,
  p_provider text,
  p_operation text
) returns void
language sql
security definer
set search_path = public
as $$
  delete from usage_ledger
  where owner_hash = p_owner_hash
    and audit_id = p_audit_id
    and provider = p_provider
    and operation = p_operation
    and actual_cost_usd is null;
$$;

revoke all on function public.cancel_spend(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.cancel_spend(text, text, text, text)
  to service_role;

-- 3. claim_anonymous_workspace: carry request_fingerprint through the
--    device→account merge and match the new conflict target. Everything else
--    is byte-identical to 202607200003.

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

  delete from usage_ledger where owner_hash = p_device_hash;
  delete from device_settings where owner_hash = p_device_hash;
  delete from audit_runs where owner_hash = p_device_hash;
end;
$$;

revoke all on function public.claim_anonymous_workspace(text, text) from public, anon, authenticated;
grant execute on function public.claim_anonymous_workspace(text, text) to service_role;
