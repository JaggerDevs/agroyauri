-- =====================================================================
-- MULTI-SITE + CRM
-- Un solo proyecto Supabase para varias webs (JaggerDev):
--   sites        → cada web (Agroyauri es la primera)
--   site_users   → qué usuarios administran qué web
--   profiles.role: pending (sin acceso) | admin (sus sites) | super_admin (todos)
-- Todo el contenido y los leads llevan site_id; RLS decide el acceso.
-- CRM: estados nuevos, assigned_to y notas en su propia tabla (lead_notes).
-- =====================================================================

-- =====================================================================
-- SITES
-- =====================================================================
create table public.sites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  domain      text check (domain is null or domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger set_updated_at before update on public.sites for each row execute function public.set_updated_at();

-- Primera web. Sin dominio: todavía no está definido.
insert into public.sites (name, slug) values ('Agroyauri SAC', 'agroyauri');

-- =====================================================================
-- PROFILES: nuevo rol super_admin
-- =====================================================================
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('pending', 'admin', 'super_admin'));

-- =====================================================================
-- SITE_USERS (usuario ↔ web)
-- =====================================================================
create table public.site_users (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.sites (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        text not null default 'admin' check (role in ('admin')),
  created_at  timestamptz not null default now(),
  unique (site_id, user_id)
);
create index site_users_user_idx on public.site_users (user_id);

-- =====================================================================
-- FUNCIONES DE ACCESO (security definer: evitan recursión de RLS)
-- =====================================================================
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'super_admin'
  );
$$;

-- ¿El usuario actual puede administrar esta web?
-- super_admin → todas. admin → solo las asignadas en site_users.
-- Un perfil 'pending' no accede aunque tenga filas en site_users (sirve para desactivar).
create or replace function public.can_access_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_site_id is not null and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and (
        p.role = 'super_admin'
        or (p.role = 'admin' and exists (
          select 1 from public.site_users su
          where su.site_id = p_site_id and su.user_id = p.id
        ))
      )
  );
$$;

-- ¿El otro usuario comparte alguna web conmigo? (para listar compañeros al asignar leads)
create or replace function public.shares_site(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.site_users mine
    join public.site_users theirs on theirs.site_id = mine.site_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
  );
$$;

revoke execute on function public.is_super_admin(), public.can_access_site(uuid), public.shares_site(uuid) from public;
-- anon las necesita porque las políticas de lectura pública las evalúan (devuelven false).
grant execute on function public.is_super_admin(), public.can_access_site(uuid) to anon, authenticated;
grant execute on function public.shares_site(uuid) to authenticated;

-- =====================================================================
-- site_id EN TODO EL CONTENIDO (los datos existentes pasan a Agroyauri)
-- =====================================================================
do $$
declare
  t text;
  agro uuid := (select id from public.sites where slug = 'agroyauri');
begin
  foreach t in array array['categories','services','projects','products','blog_posts','site_settings','redirects','leads']
  loop
    execute format('alter table public.%I add column site_id uuid references public.sites (id) on delete restrict', t);
    execute format('update public.%I set site_id = %L', t, agro);
    execute format('alter table public.%I alter column site_id set not null', t);
  end loop;
end;
$$;

-- Slugs únicos POR WEB (dos clientes pueden tener /servicios/paisajismo).
alter table public.categories drop constraint categories_slug_key;
alter table public.categories add constraint categories_site_slug_key unique (site_id, slug);
alter table public.services   drop constraint services_slug_key;
alter table public.services   add constraint services_site_slug_key unique (site_id, slug);
alter table public.projects   drop constraint projects_slug_key;
alter table public.projects   add constraint projects_site_slug_key unique (site_id, slug);
alter table public.products   drop constraint products_slug_key;
alter table public.products   add constraint products_site_slug_key unique (site_id, slug);
alter table public.blog_posts drop constraint blog_posts_slug_key;
alter table public.blog_posts add constraint blog_posts_site_slug_key unique (site_id, slug);
alter table public.redirects  drop constraint redirects_from_path_key;
alter table public.redirects  add constraint redirects_site_from_key unique (site_id, from_path);
alter table public.site_settings drop constraint site_settings_pkey;
alter table public.site_settings add primary key (site_id, key);

-- Relaciones dentro de la MISMA web: un proyecto/lead no puede apuntar a un servicio
-- de otra web, ni un producto a una categoría ajena (FK compuestas).
alter table public.services   add constraint services_id_site_key   unique (id, site_id);
alter table public.categories add constraint categories_id_site_key unique (id, site_id);

alter table public.projects drop constraint projects_service_id_fkey;
alter table public.projects add constraint projects_service_fkey
  foreign key (service_id, site_id) references public.services (id, site_id) on delete set null (service_id);
alter table public.products drop constraint products_category_id_fkey;
alter table public.products add constraint products_category_fkey
  foreign key (category_id, site_id) references public.categories (id, site_id) on delete set null (category_id);
alter table public.leads drop constraint leads_service_id_fkey;
alter table public.leads add constraint leads_service_fkey
  foreign key (service_id, site_id) references public.services (id, site_id) on delete set null (service_id);

-- =====================================================================
-- LEADS: estados del CRM, asignación
-- =====================================================================
alter table public.leads drop constraint leads_status_check;
update public.leads set status = 'quoted'    where status = 'quotation_sent';
update public.leads set status = 'qualified' where status = 'negotiating';
alter table public.leads add constraint leads_status_check
  check (status in ('new', 'contacted', 'qualified', 'quoted', 'won', 'lost'));

alter table public.leads add column assigned_to uuid references public.profiles (id) on delete set null;

-- Solo se asigna a alguien que administra ESA web (o a un super_admin).
create or replace function public.check_lead_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.assigned_to
      and (p.role = 'super_admin'
           or (p.role = 'admin' and exists (select 1 from public.site_users su where su.site_id = new.site_id and su.user_id = p.id)))
  ) then
    raise exception 'El usuario asignado no administra esta web' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger check_lead_assignee before insert or update of assigned_to, site_id on public.leads
  for each row execute function public.check_lead_assignee();

-- =====================================================================
-- LEAD_NOTES (historial de notas)
-- =====================================================================
create table public.lead_notes (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null default auth.uid(),
  note        text not null check (char_length(note) between 1 and 5000),
  created_at  timestamptz not null default now()
);

-- Las notas antiguas (un solo campo de texto) pasan al historial.
insert into public.lead_notes (lead_id, user_id, note, created_at)
select id, null, admin_notes, updated_at from public.leads where admin_notes is not null and btrim(admin_notes) <> '';
alter table public.leads drop column admin_notes;

-- ¿El usuario actual puede ver este lead? (para las políticas de lead_notes)
create or replace function public.can_access_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id and public.can_access_site(l.site_id)
  );
$$;
revoke execute on function public.can_access_lead(uuid) from public;
grant execute on function public.can_access_lead(uuid) to authenticated;

-- =====================================================================
-- ÍNDICES
-- Los compuestos (site_id, …) también sirven para filtrar solo por site_id.
-- =====================================================================
drop index public.leads_created_at_idx;
drop index public.leads_status_idx;
create index leads_site_created_idx on public.leads (site_id, created_at desc);
create index leads_site_status_idx  on public.leads (site_id, status, created_at desc);
create index leads_assigned_idx     on public.leads (assigned_to) where assigned_to is not null;
create index lead_notes_lead_idx    on public.lead_notes (lead_id, created_at desc);

drop index public.blog_posts_published_idx;
create index blog_posts_site_published_idx on public.blog_posts (site_id, is_published, published_at desc);
-- services/projects/products/categories/redirects: el UNIQUE (site_id, slug|from_path) ya indexa site_id.

-- =====================================================================
-- ROW LEVEL SECURITY (se reemplazan todas las políticas por versiones por web)
-- =====================================================================
alter table public.sites      enable row level security;
alter table public.site_users enable row level security;
alter table public.lead_notes enable row level security;

revoke insert, update, delete, truncate on public.sites, public.site_users from anon;
revoke all on public.lead_notes from anon;

do $$
declare pol record;
begin
  for pol in
    select schemaname, tablename, policyname from pg_policies
    where (schemaname = 'public' and tablename in ('profiles','categories','services','projects','products','blog_posts','site_settings','redirects','leads'))
       or (schemaname = 'storage' and tablename = 'objects' and policyname like 'storage: admin %')
  loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end;
$$;
drop function public.is_admin();

-- ---------- sites ----------
-- La web pública (build con anon key) necesita resolver su slug → id.
create policy "sites: lectura activas" on public.sites
  for select to anon, authenticated
  using (is_active or (select public.can_access_site(id)));
create policy "sites: super_admin inserta" on public.sites
  for insert to authenticated with check ((select public.is_super_admin()));
create policy "sites: super_admin actualiza" on public.sites
  for update to authenticated using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
create policy "sites: super_admin elimina" on public.sites
  for delete to authenticated using ((select public.is_super_admin()));

-- ---------- site_users ----------
create policy "site_users: ver los propios o super_admin" on public.site_users
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.can_access_site(site_id)));
create policy "site_users: super_admin inserta" on public.site_users
  for insert to authenticated with check ((select public.is_super_admin()));
create policy "site_users: super_admin actualiza" on public.site_users
  for update to authenticated using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
create policy "site_users: super_admin elimina" on public.site_users
  for delete to authenticated using ((select public.is_super_admin()));

-- ---------- profiles ----------
create policy "profiles: el propio, compañeros de web o super_admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_super_admin()) or public.shares_site(id));
-- Solo el super_admin cambia roles (nadie se auto-promueve).
create policy "profiles: super_admin actualiza" on public.profiles
  for update to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

-- ---------- contenido: lectura pública condicionada ----------
create policy "categories: lectura pública" on public.categories
  for select to anon, authenticated using (true);
create policy "services: lectura activos" on public.services
  for select to anon, authenticated
  using (is_active or (select public.can_access_site(site_id)));
create policy "projects: lectura publicados" on public.projects
  for select to anon, authenticated
  using (is_published or (select public.can_access_site(site_id)));
create policy "products: lectura publicados" on public.products
  for select to anon, authenticated
  using (is_published or (select public.can_access_site(site_id)));
create policy "blog: lectura publicados" on public.blog_posts
  for select to anon, authenticated
  using ((is_published and published_at <= now()) or (select public.can_access_site(site_id)));
create policy "settings: lectura públicos" on public.site_settings
  for select to anon, authenticated
  using (is_public or (select public.can_access_site(site_id)));
create policy "redirects: lectura pública" on public.redirects
  for select to anon, authenticated using (true);

-- ---------- contenido: escritura solo por administradores de ESA web ----------
do $$
declare t text;
begin
  foreach t in array array['categories','services','projects','products','blog_posts','site_settings','redirects']
  loop
    execute format('create policy "%1$s: admin de la web inserta" on public.%1$I for insert to authenticated with check ((select public.can_access_site(site_id)))', t);
    execute format('create policy "%1$s: admin de la web actualiza" on public.%1$I for update to authenticated using ((select public.can_access_site(site_id))) with check ((select public.can_access_site(site_id)))', t);
    execute format('create policy "%1$s: admin de la web elimina" on public.%1$I for delete to authenticated using ((select public.can_access_site(site_id)))', t);
  end loop;
end;
$$;

-- ---------- leads ----------
create policy "leads: admin de la web lee" on public.leads
  for select to authenticated using ((select public.can_access_site(site_id)));
create policy "leads: admin de la web actualiza" on public.leads
  for update to authenticated
  using ((select public.can_access_site(site_id))) with check ((select public.can_access_site(site_id)));
create policy "leads: admin de la web elimina" on public.leads
  for delete to authenticated using ((select public.can_access_site(site_id)));
-- Sin política INSERT: solo la service role (Cloudflare Function /api/lead) inserta,
-- y la Function fija el site_id desde su configuración de servidor.

-- ---------- lead_notes ----------
create policy "lead_notes: lectura si ve el lead" on public.lead_notes
  for select to authenticated using (public.can_access_lead(lead_id));
create policy "lead_notes: crear como uno mismo" on public.lead_notes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_access_lead(lead_id));
create policy "lead_notes: borrar las propias o super_admin" on public.lead_notes
  for delete to authenticated
  using (public.can_access_lead(lead_id) and (user_id = (select auth.uid()) or (select public.is_super_admin())));
-- Sin UPDATE: el historial no se reescribe.

-- =====================================================================
-- MÉTRICAS DEL DASHBOARD (una sola llamada por web)
-- security invoker → respeta RLS: sin acceso a la web, todo sale en cero.
-- =====================================================================
drop function public.admin_lead_stats(int);
create or replace function public.admin_lead_stats(p_site_id uuid, days int default 30)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      (date_trunc('day',   now() at time zone 'America/Lima')) at time zone 'America/Lima' as day_start,
      (date_trunc('month', now() at time zone 'America/Lima')) at time zone 'America/Lima' as month_start
  ),
  l as (select status, created_at from public.leads where site_id = p_site_id),
  series as (
    select d::date as day
    from generate_series(
      (now() at time zone 'America/Lima')::date - (least(greatest(days, 1), 366) - 1),
      (now() at time zone 'America/Lima')::date,
      interval '1 day') as d
  ),
  daily as (
    select (created_at at time zone 'America/Lima')::date as day, count(*) as n
    from l
    where created_at >= now() - make_interval(days => least(greatest(days, 1), 366) + 1)
    group by 1
  ),
  totals as (
    select
      count(*) filter (where status = 'new')                          as new,
      count(*) filter (where created_at >= b.day_start)               as today,
      count(*) filter (where created_at >= b.month_start)             as month,
      count(*) filter (where status = 'contacted')                    as contacted,
      count(*) filter (where status = 'won')                          as won,
      count(*) filter (where status not in ('won', 'lost'))           as pending
    from l, bounds b
  )
  select jsonb_build_object(
    'new', t.new, 'today', t.today, 'month', t.month,
    'contacted', t.contacted, 'won', t.won, 'pending', t.pending,
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', s.day, 'n', coalesce(d.n, 0)) order by s.day), '[]'::jsonb)
              from series s left join daily d on d.day = s.day)
  )
  from totals t;
$$;
revoke execute on function public.admin_lead_stats(uuid, int) from public, anon;
grant execute on function public.admin_lead_stats(uuid, int) to authenticated;

-- Webs que el usuario actual puede administrar (selector del panel).
create or replace function public.admin_sites()
returns table (id uuid, name text, slug text)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.name, s.slug from public.sites s
  where public.can_access_site(s.id)
  order by s.name;
$$;
revoke execute on function public.admin_sites() from public, anon;
grant execute on function public.admin_sites() to authenticated;

-- =====================================================================
-- STORAGE: cada web sube en su carpeta  <bucket>/<site_id>/archivo.webp
-- =====================================================================
create or replace function public.storage_site_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;
grant execute on function public.storage_site_id(text) to anon, authenticated;

create policy "storage: admin de la web lista" on storage.objects
  for select to authenticated
  using (bucket_id in ('projects', 'products', 'blog') and (select public.can_access_site(public.storage_site_id(name))));
create policy "storage: admin de la web sube" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('projects', 'products', 'blog') and (select public.can_access_site(public.storage_site_id(name))));
create policy "storage: admin de la web actualiza" on storage.objects
  for update to authenticated
  using (bucket_id in ('projects', 'products', 'blog') and (select public.can_access_site(public.storage_site_id(name))));
create policy "storage: admin de la web elimina" on storage.objects
  for delete to authenticated
  using (bucket_id in ('projects', 'products', 'blog') and (select public.can_access_site(public.storage_site_id(name))));
