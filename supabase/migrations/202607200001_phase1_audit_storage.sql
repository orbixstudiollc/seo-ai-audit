-- Phase 1: durable, anonymous audit storage.
--
-- Browser clients never access these tables directly. The application hashes a
-- random per-device ownership token and performs all reads/writes through
-- server-only Next.js routes using a Supabase secret key. RLS is intentionally
-- enabled without public policies so publishable/anonymous clients are denied.

create table if not exists public.audit_runs (
  owner_hash text not null,
  id text not null,
  version integer not null,
  url text not null,
  final_url text,
  title text not null,
  mode text not null check (mode in ('single', 'site')),
  created_at timestamptz not null,
  status text not null check (status in ('started', 'complete', 'partial', 'failed')),
  scores jsonb,
  page_count integer check (page_count is null or page_count >= 0),
  details jsonb,
  report_available boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_hash, id)
);

create index if not exists audit_runs_owner_created_idx
  on public.audit_runs (owner_hash, created_at desc);

create table if not exists public.audit_reports (
  owner_hash text not null,
  audit_id text not null,
  version integer not null,
  kind text not null check (kind in ('single', 'site')),
  created_at timestamptz not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_hash, audit_id),
  foreign key (owner_hash, audit_id)
    references public.audit_runs (owner_hash, id)
    on delete cascade
);

create table if not exists public.device_settings (
  owner_hash text primary key,
  version integer not null,
  settings jsonb not null,
  updated_at timestamptz not null default now()
);

-- Reserved now so DataForSEO tasks can be attached without another ownership
-- redesign in Phase 2.
create table if not exists public.provider_tasks (
  owner_hash text not null,
  id uuid primary key default gen_random_uuid(),
  audit_id text not null,
  provider text not null,
  provider_task_id text,
  status text not null,
  request jsonb not null default '{}'::jsonb,
  result_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_hash, audit_id)
    references public.audit_runs (owner_hash, id)
    on delete cascade
);

create index if not exists provider_tasks_owner_audit_idx
  on public.provider_tasks (owner_hash, audit_id, created_at desc);

create table if not exists public.usage_ledger (
  owner_hash text not null,
  id uuid primary key default gen_random_uuid(),
  audit_id text,
  provider text not null,
  operation text not null,
  estimated_cost_usd numeric(12, 6),
  actual_cost_usd numeric(12, 6),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_ledger_owner_created_idx
  on public.usage_ledger (owner_hash, created_at desc);

alter table public.audit_runs enable row level security;
alter table public.audit_reports enable row level security;
alter table public.device_settings enable row level security;
alter table public.provider_tasks enable row level security;
alter table public.usage_ledger enable row level security;

revoke all on public.audit_runs from anon, authenticated;
revoke all on public.audit_reports from anon, authenticated;
revoke all on public.device_settings from anon, authenticated;
revoke all on public.provider_tasks from anon, authenticated;
revoke all on public.usage_ledger from anon, authenticated;

