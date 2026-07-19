-- Transactional verification for claim_anonymous_workspace. Safe to execute
-- in the SQL editor: every synthetic row is rolled back.

begin;

do $$
declare
  device_hash text := repeat('d', 64);
  user_hash text := repeat('u', 64);
  audit_key text := 'account-link-transaction-test';
begin
  insert into audit_runs (
    owner_hash, id, version, url, title, mode, created_at, status,
    scores, page_count, report_available
  ) values (
    device_hash, audit_key, 4, 'https://validation.invalid/', 'Validation',
    'site', now(), 'complete', '{"aeo":80,"geo":80,"citability":80,"aiOverview":80}',
    1, true
  );
  insert into audit_reports (owner_hash, audit_id, version, kind, created_at, payload)
  values (device_hash, audit_key, 1, 'site', now(), '{"synthetic":true}');
  insert into device_settings (owner_hash, version, settings)
  values (device_hash, 1, '{"version":1,"defaultAuditMode":"site","historyLimit":25,"confirmBeforeClear":true,"autoSaveAudits":true,"reducedMotion":"system"}');
  insert into provider_tasks (owner_hash, audit_id, provider, provider_task_id, status)
  values (device_hash, audit_key, 'dataforseo-onpage', 'synthetic-provider-task', 'complete');
  insert into usage_ledger (owner_hash, audit_id, provider, operation, actual_cost_usd)
  values (device_hash, audit_key, 'dataforseo-onpage', 'on_page_task', 0.001);

  perform claim_anonymous_workspace(device_hash, user_hash);

  if (select count(*) from audit_runs where owner_hash = user_hash and id = audit_key) <> 1
     or (select count(*) from audit_reports where owner_hash = user_hash and audit_id = audit_key) <> 1
     or (select count(*) from device_settings where owner_hash = user_hash) <> 1
     or (select count(*) from provider_tasks where owner_hash = user_hash and audit_id = audit_key) <> 1
     or (select count(*) from usage_ledger where owner_hash = user_hash and audit_id = audit_key) <> 1 then
    raise exception 'account workspace copy assertion failed';
  end if;
  if (select count(*) from audit_runs where owner_hash = device_hash) <> 0
     or (select count(*) from audit_reports where owner_hash = device_hash) <> 0
     or (select count(*) from device_settings where owner_hash = device_hash) <> 0
     or (select count(*) from provider_tasks where owner_hash = device_hash) <> 0
     or (select count(*) from usage_ledger where owner_hash = device_hash) <> 0 then
    raise exception 'anonymous workspace cleanup assertion failed';
  end if;
  if has_function_privilege('anon', 'public.claim_anonymous_workspace(text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_anonymous_workspace(text,text)', 'EXECUTE') then
    raise exception 'account linking function is publicly executable';
  end if;
end;
$$;

rollback;

select 'account workspace linking verified' as result;
