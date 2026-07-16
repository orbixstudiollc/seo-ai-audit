-- Full backend reset for the v1 pivot (anonymous tool, no persistence).
-- Paste into the Supabase dashboard SQL editor and run.
--
-- Context: the pre-rewrite app created 7 tables in public (user, session,
-- account, verification, api_keys, audits, documents). All verified EMPTY
-- (0 rows) on 2026-07-17 before the pivot. Schema DDL is preserved in
-- db/migrations on the backup/pre-rewrite branch, so this is fully
-- reversible by re-running those migrations.

-- 1. Drop everything in public (tables, sequences, functions).
drop schema public cascade;
create schema public;

-- 2. Restore Supabase's standard grants on the fresh schema.
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
comment on schema public is 'standard public schema';

-- 3. Drizzle keeps its migration bookkeeping in a separate "drizzle" schema;
--    drop it too so a future Phase-5 migrate starts from a truly clean state.
drop schema if exists drizzle cascade;
