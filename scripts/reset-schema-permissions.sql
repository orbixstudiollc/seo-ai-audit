-- Reset the public schema and restore Supabase-standard permissions.
-- Paste into the Supabase dashboard SQL editor and run.
--
-- Use this when the public schema's grants have drifted and you want a clean,
-- default permission set (e.g. after ad-hoc DDL, a bad migration, or a manual
-- GRANT that over-provisioned anon/authenticated). This drops everything in
-- public, so it doubles as a full wipe — see scripts/db-wipe.sql and decision
-- D-009 for the v1 "no persistence" context.
--
-- Security note: anon and authenticated get USAGE only, never CREATE. Granting
-- ALL ON SCHEMA (= USAGE + CREATE) to those roles would let anonymous/logged-in
-- API callers create arbitrary objects in public. CREATE stays with the
-- privileged roles (postgres, service_role), matching the Supabase default.

-- 1. Drop everything in public (tables, sequences, functions), then recreate it.
drop schema public cascade;
create schema public;

-- 2. Restore Supabase's standard grants on the fresh schema.
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all   on schema public to postgres, service_role;
alter default privileges in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
comment on schema public is 'standard public schema';

-- 3. Drizzle keeps its migration bookkeeping in a separate "drizzle" schema;
--    drop it too so a future migrate starts from a truly clean state.
drop schema if exists drizzle cascade;
