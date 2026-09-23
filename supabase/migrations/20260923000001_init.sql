-- =====================================================================
-- AGROYAURI SAC — esquema inicial
-- Tablas: profiles, categories, services, projects, products,
--         blog_posts, site_settings, leads, redirects
-- Todo con Row Level Security. Solo administradores escriben.
-- =====================================================================

-- ---------- utilidades ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- PROFILES (administradores)
-- Un usuario nuevo de Auth recibe role = 'pending' (sin acceso).
-- Se promueve a admin manualmente (ver docs/SUPABASE.md).
-- =====================================================================
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  role        text not null default 'pending' check (role in ('admin', 'pending')),
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ¿El usuario actual es administrador?  (security definer: evita recursión RLS)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- anon la necesita porque las políticas de lectura pública la evalúan (devuelve false).
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- =====================================================================
-- CATEGORIES (catálogo de productos)
-- =====================================================================
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- =====================================================================
-- SERVICES
-- price_type: fixed = precio fijo | from = "desde S/" | per_m2 = por m²
--             quote = solo "solicitar cotización"
-- =====================================================================
create table public.services (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(name) between 2 and 120),
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  short_description  text check (char_length(short_description) <= 300),
  description        text,
  image_url          text,
  icon               text,
  price_type         text not null default 'quote' check (price_type in ('fixed', 'from', 'per_m2', 'quote')),
  price_from         numeric(12, 2) check (price_from is null or price_from >= 0),
  price_unit         text check (char_length(price_unit) <= 30),
  show_price         boolean not null default false,
  show_in_home       boolean not null default true,
  sort_order         int not null default 0,
  is_active          boolean not null default true,
  seo_title          text check (char_length(seo_title) <= 70),
  seo_description    text check (char_length(seo_description) <= 170),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- =====================================================================
-- PROJECTS
-- =====================================================================
create table public.projects (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (char_length(title) between 2 and 160),
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  client             text check (char_length(client) <= 120),
  location           text check (char_length(location) <= 120),
  service_id         uuid references public.services (id) on delete set null,
  short_description  text check (char_length(short_description) <= 300),
  description        text,
  featured_image     text,
  gallery            text[] not null default '{}',
  before_image       text,
  after_image        text,
  is_featured        boolean not null default false,
  is_published       boolean not null default false,
  sort_order         int not null default 0,
  seo_title          text check (char_length(seo_title) <= 70),
  seo_description    text check (char_length(seo_description) <= 170),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- =====================================================================
-- PRODUCTS (catálogo, sin carrito todavía)
-- =====================================================================
create table public.products (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 2 and 120),
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category_id      uuid references public.categories (id) on delete set null,
  description      text,
  image_url        text,
  price            numeric(12, 2) check (price is null or price >= 0),
  price_unit       text check (char_length(price_unit) <= 30),
  show_price       boolean not null default false,
  available        boolean not null default true,
  featured         boolean not null default false,
  is_published     boolean not null default false,
  sort_order       int not null default 0,
  seo_title        text check (char_length(seo_title) <= 70),
  seo_description  text check (char_length(seo_description) <= 170),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- =====================================================================
-- BLOG
-- =====================================================================
create table public.blog_posts (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(title) between 2 and 180),
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  excerpt          text check (char_length(excerpt) <= 400),
  content          text,
  featured_image   text,
  author           text,
  published_at     timestamptz,
  is_published     boolean not null default false,
  seo_title        text check (char_length(seo_title) <= 70),
  seo_description  text check (char_length(seo_description) <= 170),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- =====================================================================
-- SITE SETTINGS (clave → JSON). Contacto, redes, planes de precios…
-- =====================================================================
create table public.site_settings (
  key         text primary key check (key ~ '^[a-z0-9_]+$'),
  value       jsonb not null,
  is_public   boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- =====================================================================
-- REDIRECTS (301 generados al cambiar un slug)
-- =====================================================================
create table public.redirects (
  id          uuid primary key default gen_random_uuid(),
  from_path   text not null unique check (from_path ~ '^/[a-z0-9/-]*$'),
  to_path     text not null check (to_path ~ '^/[a-z0-9/-]*$'),
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- LEADS
-- Los visitantes NO escriben directo: el formulario va a la Cloudflare
-- Function /api/lead, que valida y usa la service role key (servidor).
-- =====================================================================
create table public.leads (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 2 and 120),
  company       text check (char_length(company) <= 120),
  phone         text not null check (char_length(phone) between 6 and 30),
  email         text not null check (char_length(email) <= 160 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  service_id    uuid references public.services (id) on delete set null,
  service_label text check (char_length(service_label) <= 120),
  district      text check (char_length(district) <= 120),
  location      text check (char_length(location) <= 200),
  area_m2       numeric(12, 2) check (area_m2 is null or (area_m2 > 0 and area_m2 < 100000000)),
  message       text check (char_length(message) <= 3000),
  source        text check (char_length(source) <= 60),
  landing_page  text check (char_length(landing_page) <= 300),
  referrer      text check (char_length(referrer) <= 300),
  utm_source    text check (char_length(utm_source) <= 120),
  utm_medium    text check (char_length(utm_medium) <= 120),
  utm_campaign  text check (char_length(utm_campaign) <= 160),
  utm_content   text check (char_length(utm_content) <= 160),
  utm_term      text check (char_length(utm_term) <= 160),
  status        text not null default 'new'
                check (status in ('new', 'contacted', 'quotation_sent', 'negotiating', 'won', 'lost')),
  admin_notes   text check (char_length(admin_notes) <= 5000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- índices ----------
create index leads_created_at_idx on public.leads (created_at desc);
create index leads_status_idx     on public.leads (status);
create index leads_service_idx    on public.leads (service_id);
create index projects_service_idx on public.projects (service_id);
create index products_category_idx on public.products (category_id);
create index blog_posts_published_idx on public.blog_posts (is_published, published_at desc);
-- (los slug ya tienen índice por la restricción UNIQUE)

-- ---------- triggers updated_at ----------
create trigger set_updated_at before update on public.categories    for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.services      for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.projects      for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.products      for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.blog_posts    for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.site_settings for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.leads         for each row execute function public.set_updated_at();

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles      enable row level security;
alter table public.categories    enable row level security;
alter table public.services      enable row level security;
alter table public.projects      enable row level security;
alter table public.products      enable row level security;
alter table public.blog_posts    enable row level security;
alter table public.site_settings enable row level security;
alter table public.redirects     enable row level security;
alter table public.leads         enable row level security;

-- Defensa en profundidad: el rol anónimo solo puede LEER contenido.
revoke insert, update, delete, truncate on
  public.profiles, public.categories, public.services, public.projects,
  public.products, public.blog_posts, public.site_settings, public.redirects
  from anon;
revoke all on public.leads from anon;

-- ---------- profiles ----------
create policy "profiles: ver el propio o admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles: admin actualiza" on public.profiles
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- contenido público (lectura condicionada) ----------
create policy "categories: lectura pública" on public.categories
  for select to anon, authenticated using (true);

create policy "services: lectura activos" on public.services
  for select to anon, authenticated
  using (is_active or (select public.is_admin()));

create policy "projects: lectura publicados" on public.projects
  for select to anon, authenticated
  using (is_published or (select public.is_admin()));

create policy "products: lectura publicados" on public.products
  for select to anon, authenticated
  using (is_published or (select public.is_admin()));

create policy "blog: lectura publicados" on public.blog_posts
  for select to anon, authenticated
  using ((is_published and published_at <= now()) or (select public.is_admin()));

create policy "settings: lectura públicos" on public.site_settings
  for select to anon, authenticated
  using (is_public or (select public.is_admin()));

create policy "redirects: lectura pública" on public.redirects
  for select to anon, authenticated using (true);

-- ---------- escritura: solo administradores ----------
do $$
declare t text;
begin
  foreach t in array array['categories','services','projects','products','blog_posts','site_settings','redirects']
  loop
    execute format('create policy "%1$s: admin inserta" on public.%1$I for insert to authenticated with check ((select public.is_admin()))', t);
    execute format('create policy "%1$s: admin actualiza" on public.%1$I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('create policy "%1$s: admin elimina" on public.%1$I for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
end;
$$;

-- ---------- leads: solo administradores (lectura / edición / borrado) ----------
create policy "leads: admin lee" on public.leads
  for select to authenticated using ((select public.is_admin()));
create policy "leads: admin actualiza" on public.leads
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "leads: admin elimina" on public.leads
  for delete to authenticated using ((select public.is_admin()));
-- Sin política INSERT: solo la service role (Cloudflare Function) inserta.

-- =====================================================================
-- MÉTRICAS DEL DASHBOARD (una sola llamada)
-- security invoker → respeta RLS: un no-admin obtiene ceros.
-- =====================================================================
create or replace function public.admin_lead_stats(days int default 30)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      (date_trunc('day',   now() at time zone 'America/Lima')) at time zone 'America/Lima' as day_start,
      (date_trunc('week',  now() at time zone 'America/Lima')) at time zone 'America/Lima' as week_start,
      (date_trunc('month', now() at time zone 'America/Lima')) at time zone 'America/Lima' as month_start
  ),
  series as (
    select d::date as day
    from generate_series(
      (now() at time zone 'America/Lima')::date - (least(greatest(days, 1), 366) - 1),
      (now() at time zone 'America/Lima')::date,
      interval '1 day') as d
  ),
  daily as (
    select (l.created_at at time zone 'America/Lima')::date as day, count(*) as n
    from public.leads l
    where l.created_at >= now() - make_interval(days => least(greatest(days, 1), 366) + 1)
    group by 1
  )
  select jsonb_build_object(
    'today',          (select count(*) from public.leads, bounds where created_at >= bounds.day_start),
    'week',           (select count(*) from public.leads, bounds where created_at >= bounds.week_start),
    'month',          (select count(*) from public.leads, bounds where created_at >= bounds.month_start),
    'new',            (select count(*) from public.leads where status = 'new'),
    'quotation_sent', (select count(*) from public.leads where status = 'quotation_sent'),
    'won',            (select count(*) from public.leads where status = 'won'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', s.day, 'n', coalesce(d.n, 0)) order by s.day), '[]'::jsonb)
              from series s left join daily d on d.day = s.day)
  );
$$;

revoke execute on function public.admin_lead_stats(int) from public, anon;
grant execute on function public.admin_lead_stats(int) to authenticated;

-- =====================================================================
-- STORAGE: buckets públicos de lectura, escritura solo admin
-- Límite 5 MB por archivo, solo imágenes.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('projects', 'projects', true, 5242880, array['image/webp', 'image/jpeg', 'image/png', 'image/avif']),
  ('products', 'products', true, 5242880, array['image/webp', 'image/jpeg', 'image/png', 'image/avif']),
  ('blog',     'blog',     true, 5242880, array['image/webp', 'image/jpeg', 'image/png', 'image/avif'])
on conflict (id) do nothing;

create policy "storage: admin lista" on storage.objects
  for select to authenticated
  using (bucket_id in ('projects', 'products', 'blog') and (select public.is_admin()));
create policy "storage: admin sube" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('projects', 'products', 'blog') and (select public.is_admin()));
create policy "storage: admin actualiza" on storage.objects
  for update to authenticated
  using (bucket_id in ('projects', 'products', 'blog') and (select public.is_admin()));
create policy "storage: admin elimina" on storage.objects
  for delete to authenticated
  using (bucket_id in ('projects', 'products', 'blog') and (select public.is_admin()));
-- Los buckets son públicos: las imágenes se sirven por URL pública sin política SELECT.
