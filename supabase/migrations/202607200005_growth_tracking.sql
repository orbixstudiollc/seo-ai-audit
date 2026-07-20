-- G2 growth tracking: tracked sites + free daily DET snapshots (D-019).
-- Same posture as every phase-1+ table: RLS enabled, zero public grants,
-- server-secret access only, and the account-claim RPC updated IN THE SAME
-- migration (202607200004 precedent — shipping them apart silently breaks
-- workspace linking).

create table if not exists public.tracked_sites (
  owner_hash text not null,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Drives both the least-recently-run round-robin and the CAS claim that
  -- makes overlapping cron invocations skip each other's work.
  last_run_at timestamptz,
  primary key (owner_hash, url)
);

create table if not exists public.site_snapshots (
  owner_hash text not null,
  url text not null,
  captured_on date not null,
  -- Record<DetSignalId, DetSignalResult-score-only>; null = fetch failed.
  det_scores jsonb,
  -- Record<Lens, number> from estimateRescore; null before first full audit.
  lens_estimate jsonb,
  -- SIGNALS_VERSION stamp so charts can annotate engine-version discontinuities.
  signals_version text not null,
  -- sha256 of the parsed plainText; powers the "page changed" badge.
  content_hash text,
  fetch_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Uniqueness per (owner, url, day) AND the only index the 90-day query needs.
  primary key (owner_hash, url, captured_on)
);

alter table public.tracked_sites enable row level security;
alter table public.site_snapshots enable row level security;
revoke all on public.tracked_sites from public, anon, authenticated;
revoke all on public.site_snapshots from public, anon, authenticated;

-- Account claim: merge device-owned tracking rows into the verified account
-- workspace, then delete the device rows (these tables have no FK cascade
-- from audit_runs — snapshots outlive audits deliberately).

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

  delete from site_snapshots where owner_hash = p_device_hash;
  delete from tracked_sites where owner_hash = p_device_hash;
  delete from usage_ledger where owner_hash = p_device_hash;
  delete from device_settings where owner_hash = p_device_hash;
  delete from audit_runs where owner_hash = p_device_hash;
end;
$$;

revoke all on function public.claim_anonymous_workspace(text, text) from public, anon, authenticated;
grant execute on function public.claim_anonymous_workspace(text, text) to service_role;
