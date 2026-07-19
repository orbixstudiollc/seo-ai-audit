-- Cloud Phase 2: one reusable DataForSEO technical crawl per saved audit.
-- The API reserves this row before contacting the paid provider, so concurrent
-- clicks or server instances cannot create duplicate billable tasks.

create unique index if not exists provider_tasks_owner_audit_provider_unique
  on public.provider_tasks (owner_hash, audit_id, provider);

create unique index if not exists usage_ledger_owner_audit_operation_unique
  on public.usage_ledger (owner_hash, audit_id, provider, operation);
