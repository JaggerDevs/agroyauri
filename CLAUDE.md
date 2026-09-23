# AGROYAURI SAC — Web corporativa (v2: Astro + Supabase + Cloudflare)

## Contexto
- v1 (HTML estático) publicada en GitHub Pages: https://neechan15.github.io/agroyauri/ (rama `main`, repo público `neechan15/agroyauri`). NO tocar `main` hasta terminar v2.
- v2 se trabaja en la rama **`v2`** (esta carpeta es el repo git). Encargo completo: "prompt de 52 puntos" (CMS+CRM, SEO, leads, Supabase Free, Cloudflare Pages Free).
- Diseño APROBADO: no cambiar hero, colores, tipografías ni orden del Home (Header → Hero curvo → Servicios → Proyectos → Costos → Contacto → Footer). Misión/Visión solo en /nosotros.
- Datos reales solo del brochure (`documentos/Brochure_Agroyauri_2026.pdf`): tel 931-637-047 / 991-554-666, eyauri@agroyauri.com, Pachacamac - Lima, RUC 20614909189. Redes sociales: NO hay URLs reales (se ocultan si están vacías).
- git: `C:\Program Files\Git\cmd\git.exe`, identidad neechan15 / 58159260+neechan15@users.noreply.github.com. `gh` autenticado.

## Arquitectura decidida
- **Astro 7 estático** (`output: static`, `build.format: file`, `trailingSlash: never`). El visitante NUNCA consulta Supabase: el build lee Supabase (anon key) y genera HTML. Sin credenciales usa `src/data/seed.json`.
- **Leads**: formulario → Cloudflare Function `functions/api/lead.ts` (valida, honeypot, tiempo mínimo 2.5s, Origin, 429 por repetición, Turnstile opcional) → inserta con SERVICE ROLE (solo secreto de Cloudflare). anon NO puede insertar leads.
- **Actualizar la web**: el admin guarda en Supabase y pulsa "Publicar cambios" → `/api/rebuild` (verifica que sea admin) → Cloudflare deploy hook. (Un botón, no un build por guardado: límite 500 builds/mes.)
- Imágenes: `src/assets/media/**` (locales, se guardan en BD como `/media/...`) o URL de Supabase Storage; `src/lib/media.ts` resuelve ambas; `Img.astro` genera AVIF/WebP + srcset.
- Fuentes self-hosted en `public/fonts` (Lora 700, Poppins 400/500/600, Caveat 600).

## Estado por fase
- [x] **Fase 1** Supabase: `supabase/migrations/20260923000001_init.sql` (tablas profiles, categories, services, projects, products, blog_posts, site_settings, redirects, leads; RLS en todas; `is_admin()`, `admin_lead_stats()`; buckets projects/products/blog 5MB). Seed: `npm run seed:sql` genera `supabase/seed.sql` desde `src/data/seed.json`. **`npm run test:db` → 31 pruebas RLS OK** (PGlite).
- [x] **Fase 2** Leads: `LeadForm.astro` + `src/scripts/lead-form.ts` (UTM + landing_page vía sessionStorage `ay_attr` en `Base.astro`) + `functions/api/lead.ts`. **`node scripts/e2e-leads.mjs` → 18/18 OK**.
- [x] Páginas públicas hechas: `/`, `/nosotros`, `/servicios`, `/servicios/[slug]`, `/proyectos`, `/proyectos/[slug]`, `/productos`, `/blog`, `/blog/[slug]`, `/contacto`, `/404`, `/sitemap.xml`, `/robots.txt`, `_redirects` (integración `src/integrations/redirects.mjs`). Comparación visual con v1: prácticamente idéntica.
- [~] **Fases 3-6 Panel /admin** — EN CURSO. Hecho: `src/admin/ui.ts` (h(), toasts, confirmDialog, labels de estado/origen), `supabase.ts`, `publish.ts`, `images.ts` (compresión WebP ≤1600px en navegador + `/admin-media.json` para previews), `crud.ts` (listado+formulario genérico, aviso y redirección 301 al cambiar slug, borrado con palabra ELIMINAR).
  **FALTA**:
  1. `src/admin/entities.ts` (configs: services [incluye price_type/price_from/price_unit/show_price, icon select: paisajismo, mantenimiento, riego, plagas, saneamiento, insumos, plantas], projects [gallery, before/after, service_id fk], products [category_id fk, bucket products], categories, blog [bucket blog, published_at]).
  2. `src/admin/views/dashboard.ts` (rpc `admin_lead_stats(30)` + últimos 8 leads; gráfico SVG propio), `views/leads.ts` (20 por página, filtros estado/servicio/origen/fecha EN LA BD, búsqueda `or(name/company/phone ilike)`, detalle: cambiar estado, notas, WhatsApp/llamar/correo, borrar con confirmación), `views/prices.ts` (precios de servicios + planes en `site_settings.plans`), `views/settings.ts` (contact, social).
  3. `src/admin/app.ts` (login Supabase Auth, verificar `profiles.role='admin'`, router por hash, menú Dashboard/Leads/Servicios/Proyectos/Productos/Precios/Blog/Configuración, botón "Publicar cambios").
  4. `src/pages/admin.astro` (bare, noindex, `src/styles/admin.css`) + `src/pages/admin-media.json.ts` (mapa /media/... → miniatura) + íconos `i-plus`, `i-upload`, `i-external` en `Sprite.astro`.
  5. `functions/api/rebuild.ts` (verifica JWT con `/auth/v1/user`, rol admin con service role, POST a `CF_DEPLOY_HOOK_URL`).
  6. `public/_headers` (cache inmutable `/_astro/*` y `/fonts/*`, seguridad, `X-Robots-Tag: noindex` en /admin).
- [ ] Fase 7 SEO técnico (revisar metadata/canonical/schema/H1 por página; Search Console/GA4 por env `PUBLIC_GA_ID`, `PUBLIC_GSC_VERIFICATION` ya soportados en `Base.astro`).
- [ ] Fase 8 Performance (Lighthouse móvil; revisar LCP hero con fetchpriority, CLS).
- [ ] Fase 9 Auditoría final (checklist del prompt) + docs: `README.md`, `docs/SUPABASE.md`, `docs/CLOUDFLARE.md`, `.env.example` (públicas: PUBLIC_SITE_URL, PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, PUBLIC_GA_ID, PUBLIC_GSC_VERIFICATION, PUBLIC_TURNSTILE_SITE_KEY; secretas Cloudflare: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TURNSTILE_SECRET_KEY, CF_DEPLOY_HOOK_URL).
- [ ] Al final: push de `v2`, conectar Cloudflare Pages (lo hace el usuario con su cuenta), crear proyecto Supabase, aplicar migración + seed, crear admin (Auth → invitar usuario → `update profiles set role='admin'`), desactivar signups.

## Pruebas locales (sin cuenta Supabase)
- Emulador: `POSTGREST_BIN=<scratchpad>\pgrst\postgrest.exe node scripts/local-supabase.mjs` → API en http://127.0.0.1:54321, admin `admin@agroyauri.test / admin12345`, no-admin `intruso@agroyauri.test / intruso12345`. Claves en `%TEMP%\agroyauri-local-keys.json`. PostgREST 16.3 Windows necesita `LIBPQ.dll` (copiada del wheel psycopg-binary a la carpeta del exe). Si se reinicia el PC hay que volver a descargarlo (scratchpad temporal).
  - Limitación: errores de BD (permiso denegado, duplicados) llegan como 503 en el emulador (pglite-socket); en Supabase real son 401/403/409.
- `.env` y `.dev.vars` locales (gitignored) apuntan al emulador. `npx astro build` luego `npx wrangler pages dev dist --port 8788 --ip 127.0.0.1 --compatibility-date=2026-09-01 --live-reload=false`.
  - Si wrangler se cuelga: matar procesos `workerd` y node con "wrangler" (PowerShell) y relanzar.
- Capturas: Chrome headless `--screenshot`; para móvil usar iframe de 390px (Chrome headless tiene ancho mínimo).

## Lecciones
- Heredocs grandes en Bash con comillas simples/`$` fallan: usar la herramienta Write.
- `.section h2` aplica estilo de título con línea verde a TODO h2 dentro de secciones: para h2 de tarjetas usar clases `card-h`, `post-title`, `aside-title`, `empty-title`, `cat-title` (overrides en `src/styles/pages.css`).
- Pattern HTML con flag v: escapar `( ) -` dentro de clases.
