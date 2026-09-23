# Supabase (plan Free)

## 1. Crear el proyecto
1. https://supabase.com → **New project** → región **South America (São Paulo)** (la más cercana a Lima).
2. Guarda la contraseña de la base de datos en un lugar seguro.
3. **Project Settings → API**: copia
   - `Project URL` → `PUBLIC_SUPABASE_URL` y `SUPABASE_URL`
   - `anon` / *publishable* key → `PUBLIC_SUPABASE_ANON_KEY` (pública)
   - `service_role` / *secret* key → `SUPABASE_SERVICE_ROLE_KEY` (**secreta**, solo en Cloudflare)

## 2. Crear las tablas (migración)
Opción A — **SQL Editor** (sin instalar nada):
1. SQL Editor → New query → pega el contenido de `supabase/migrations/20260923000001_init.sql` → **Run**.
2. Nueva query → pega `supabase/seed.sql` → **Run** (contenido inicial real: servicios, proyectos, productos, planes, contacto).

Opción B — **Supabase CLI**: `npx supabase link --project-ref TU_REF` y `npx supabase db push`, luego ejecuta `supabase/seed.sql`.

> Las migraciones viven en el repositorio (`supabase/migrations/`). No hagas cambios de estructura solo desde el panel de Supabase: crea un nuevo archivo de migración.

## 3. Autenticación (solo administradores)
1. **Authentication → Sign In / Providers → Email**: activado.
2. **Authentication → Settings → "Allow new users to sign up": DESACTIVADO** (nadie puede registrarse solo).
3. **Authentication → Users → Add user → Create new user**: correo + contraseña del administrador (marca *Auto Confirm User*).
4. Dale el rol de administrador (SQL Editor):
   ```sql
   update public.profiles set role = 'admin', full_name = 'Nombre Apellido'
   where id = (select id from auth.users where email = 'correo@del-admin.com');
   ```
   Todo usuario nuevo nace con `role = 'pending'` y **no puede ver ni editar nada** hasta este paso.
5. **Authentication → URL Configuration → Site URL**: la URL pública de la web.

## 4. Qué se creó

| Tabla | Para qué | Lectura pública | Escritura |
|---|---|---|---|
| `profiles` | administradores (`role`: admin / pending) | no (cada uno ve el suyo) | solo admin |
| `leads` | solicitudes de cotización (CRM) | **no** | inserta la Function `/api/lead` (service role); admin edita/borra |
| `services` | servicios + precios | solo `is_active = true` | solo admin |
| `projects` | proyectos (galería, antes/después) | solo `is_published = true` | solo admin |
| `products` / `categories` | catálogo | solo `is_published = true` | solo admin |
| `blog_posts` | artículos | solo publicados y con fecha ≤ hoy | solo admin |
| `site_settings` | contacto, redes, planes de precios | solo `is_public = true` | solo admin |
| `redirects` | 301 automáticos al cambiar un slug | sí | solo admin |

- **RLS activado en todas las tablas.** El rol `anon` además no tiene permisos de INSERT/UPDATE/DELETE en ninguna tabla ni ningún permiso sobre `leads`.
- Funciones: `is_admin()` (usada por las políticas) y `admin_lead_stats(days)` (todas las métricas del dashboard en 1 llamada).
- Índices: `leads(created_at)`, `leads(status)`, `leads(service_id)`, `projects(service_id)`, `products(category_id)`, `blog_posts(is_published, published_at)` y únicos en todos los `slug`.
- **Storage**: buckets públicos `projects`, `products`, `blog` (máx. 5 MB, solo imágenes). Solo un admin puede subir/editar/borrar. El panel comprime cada foto a WebP ≤ 1600 px antes de subirla.

## 5. Uso del plan gratuito
- La web pública **no consulta Supabase**: el contenido se lee solo al publicar (build). Miles de visitas = 0 consultas.
- El panel consulta solo al abrir cada pantalla (sin Realtime, sin polling). Listas paginadas de 20.
- Los leads se insertan uno por envío de formulario.
- Proyectos Free se **pausan tras 7 días sin actividad**: el uso normal del panel lo evita. Si se pausa, la web sigue funcionando (es estática); solo el formulario y el panel fallan hasta reactivarlo desde supabase.com.

## 6. Respaldos
El plan Free no incluye backups descargables automáticos. Recomendado mensualmente:
- **Database → Backups** (si está disponible) o `npx supabase db dump -f backup.sql --db-url "postgresql://…"`.
- Exporta los leads desde **Table editor → leads → Export CSV**.

## 7. Probar sin cuenta (desarrollo)
`npm run test:db` ejecuta las migraciones y 31 pruebas de RLS en un Postgres embebido. `scripts/local-supabase.mjs` levanta un emulador (PGlite + PostgREST) para probar la web y el panel de punta a punta (ver `README.md`).
