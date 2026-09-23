// Lo mínimo de Supabase para ejecutar las migraciones reales en PGlite:
// roles, auth.users, auth.uid() y storage.buckets/objects.
// SOLO para pruebas locales; en producción esto ya lo provee Supabase.
import { readFileSync, readdirSync } from "node:fs";

export const STUB_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create role authenticator noinherit login;
  grant anon, authenticated, service_role to authenticator;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id), name text);
  alter table storage.objects enable row level security;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  grant all on storage.objects to anon, authenticated, service_role;
`;

export async function applySchema(db, { seed = true } = {}) {
  const root = new URL("../../supabase/", import.meta.url);
  await db.exec(STUB_SQL);
  for (const f of readdirSync(new URL("migrations/", root)).sort()) {
    await db.exec(readFileSync(new URL(`migrations/${f}`, root), "utf8"));
  }
  if (seed) await db.exec(readFileSync(new URL("seed.sql", root), "utf8"));
}
