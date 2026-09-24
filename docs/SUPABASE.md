# Supabase (plan Free)

## 1. Crear el proyecto
1. https://supabase.com → **New project** → región **South America (São Paulo)** (la más cercana a Lima).
2. Guarda la contraseña de la base de datos en un lugar seguro.
3. **Project Settings → API**: copia
   - `Project URL` → `PUBLIC_SUPABASE_URL` y `SUPABASE_URL`
   - `anon` / *publishable* key → `PUBLIC_SUPABASE_ANON_KEY` (pública)
   - `service_role` / *secret* key → `SUPABASE_SERVICE_ROLE_KEY` (**secreta**, solo en Cloudflare)

## 2. Crear las tablas (migraciones)
Opción A — **SQL Editor** (sin instalar nada). Ejecuta EN ORDEN, cada uno en una query nueva → **Run**:
1. `supabase/migrations/20260923000001_init.sql` (esquema base)
2. `supabase/migrations/20260924000001_multisite_crm.sql` (multi-site, roles, CRM, RLS por web). Crea la web **Agroyauri SAC** (`slug = agroyauri`).
3. `supabase/seed.sql` (contenido inicial real de Agroyauri: servicios, proyectos, productos, contacto).

Opción B — **Supabase CLI**: `npx supabase link --project-ref TU_REF` y `npx supabase db push`, luego ejecuta `supabase/seed.sql`.

> Las migraciones viven en el repositorio (`supabase/migrations/`). No hagas cambios de estructura solo desde el panel de Supabase: crea un nuevo archivo de migración.

## 3. Autenticación y roles
1. **Authentication → Sign In / Providers → Email**: activado.
2. **Authentication → Settings → "Allow new users to sign up": DESACTIVADO** (nadie puede registrarse solo).
3. **Authentication → Users → Add user → Create new user**: correo + contraseña (marca *Auto Confirm User*).
   Todo usuario nuevo nace con `role = 'pending'` y **no puede ver ni editar nada**.
4. Roles (SQL Editor):
   - **super_admin** (JaggerDev: administra TODAS las webs):
     ```sql
     update public.profiles set role = 'super_admin', full_name = 'JaggerDev'
     where id = (select id from auth.users where email = 'correo@jaggerdev.com');
     ```
   - **admin de Agroyauri** (solo su web):
     ```sql
     update public.profiles set role = 'admin', full_name = 'Nombre Apellido'
     where id = (select id from auth.users where email = 'correo@del-cliente.com');

     insert into public.site_users (site_id, user_id)
     select s.id, u.id from public.sites s, auth.users u
     where s.slug = 'agroyauri' and u.email = 'correo@del-cliente.com';
     ```
   - Para quitarle el acceso a alguien: `update public.profiles set role = 'pending' where …` (o borra su fila de `site_users`).
5. **Authentication → URL Configuration → Site URL**: la URL pública de la web.

## 4. Qué se creó

| Tabla | Para qué | Lectura pública | Escritura |
|---|---|---|---|
| `sites` | cada web administrada (Agroyauri, futuros clientes) | solo activas (id, nombre, slug) | solo super_admin |
| `site_users` | qué usuario administra qué web (`UNIQUE site_id + user_id`) | no | solo super_admin |
| `profiles` | usuarios (`role`: pending / admin / super_admin) | no (el propio, compañeros de web o super_admin) | solo super_admin |
| `leads` | solicitudes de cotización (CRM), con `site_id` y `assigned_to` | **no** | inserta la Function `/api/lead` (service role); admin de la web edita/borra |
| `lead_notes` | historial de notas de cada lead | **no** | admin de la web crea (como sí mismo) y borra las suyas |
| `services` | servicios + precios (`show_price`) | solo `is_active = true` | admin de la web |
| `projects` | proyectos (galería, antes/después) | solo `is_published = true` | admin de la web |
| `products` / `categories` | catálogo | solo `is_published = true` | admin de la web |
| `blog_posts` | artículos | solo publicados y con fecha ≤ hoy | admin de la web |
| `site_settings` | contacto, redes (clave única por web) | solo `is_public = true` | admin de la web |
| `redirects` | 301 automáticos al cambiar un slug | sí | admin de la web |

- **Todo el contenido lleva `site_id`** y los slugs son únicos por web (`site_id + slug`). FK compuestas impiden que un proyecto, producto o lead apunte a un servicio/categoría de otra web.
- **RLS activado en todas las tablas.** La regla central es `can_access_site(site_id)`: super_admin → todas; admin → solo las de `site_users`; pending → ninguna. `anon` no tiene INSERT/UPDATE/DELETE en ninguna tabla ni acceso a `leads`/`lead_notes`.
- **Formulario seguro:** la Function fija `site_id` desde `PUBLIC_SITE_SLUG` (configuración del servidor) e ignora cualquier `site_id` enviado por el navegador. Solo se puede asignar un lead a alguien que administre esa web (trigger).
- Funciones: `is_super_admin()`, `can_access_site(site_id)`, `can_access_lead(lead_id)`, `shares_site(user_id)`, `admin_sites()` (webs del usuario) y `admin_lead_stats(site_id, days)` (todas las métricas del dashboard en 1 llamada: nuevos, hoy, mes, contactados, ganados, pendientes y gráfico).
- Índices: `leads(site_id, created_at)`, `leads(site_id, status, created_at)`, `leads(assigned_to)` parcial, `leads(service_id)`, `lead_notes(lead_id, created_at)`, `site_users(user_id)`, `blog_posts(site_id, is_published, published_at)` y únicos `(site_id, slug)` en todo el contenido.
- `updated_at` con un único trigger reutilizable (`set_updated_at`) en todas las tablas que lo tienen.
- **Storage**: buckets públicos `projects`, `products`, `blog` (máx. 5 MB, solo imágenes). Cada web sube en su carpeta `<site_id>/…`; la política solo deja escribir en carpetas de webs propias. El panel comprime cada foto a WebP ≤ 1600 px antes de subirla.

## 5. Uso del plan gratuito
- La web pública **no consulta Supabase**: el contenido se lee solo al publicar (build). Miles de visitas = 0 consultas.
- El panel consulta solo al abrir cada pantalla (sin Realtime, sin polling). Listas paginadas de 20.
- Los leads se insertan uno por envío de formulario.
- Proyectos Free se **pausan tras 7 días sin actividad**: el uso normal del panel lo evita. Si se pausa, la web sigue funcionando (es estática); solo el formulario y el panel fallan hasta reactivarlo desde supabase.com.

## 6. Respaldos
El plan Free no incluye backups descargables automáticos. Recomendado mensualmente:
- **Database → Backups** (si está disponible) o `npx supabase db dump -f backup.sql --db-url "postgresql://…"`.
- Exporta los leads desde **Table editor → leads → Export CSV** (filtra por `site_id`).

## 7. Probar sin cuenta (desarrollo)
`npm run test:db` ejecuta las migraciones y 59 pruebas de RLS y aislamiento entre webs en un Postgres embebido. `scripts/local-supabase.mjs` levanta un emulador (PGlite + PostgREST) para probar la web y el panel de punta a punta (ver `README.md`).
