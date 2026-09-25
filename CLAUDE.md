# AGROYAURI SAC — Web corporativa (Astro + Supabase + Cloudflare)

## Contexto
- Repo en la organización **JaggerDevs** (`JaggerDevs/agroyauri`, transferido desde neechan15 el 24-09-2026). Se trabaja en **`main`** (esta carpeta es el repo git). El 24-09-2026 la antigua rama `v2` pasó a ser `main` y se borró; la web estática anterior (v1) quedó en la etiqueta **`v1-estatica`**. GitHub Pages está DESACTIVADO: la web se publica solo en Cloudflare Pages. Encargo completo: "prompt de 52 puntos" (CMS+CRM, SEO, leads, Supabase Free, Cloudflare Pages Free).
- Diseño APROBADO (incluye el rediseño del 24-09-2026 descrito abajo): no cambiar hero, colores, tipografías ni orden del Home (Header → Hero curvo → Servicios → Proyectos → Contacto → Footer). Misión/Visión solo en /nosotros.
- Datos reales solo del brochure (`documentos/Brochure_Agroyauri_2026.pdf`): tel 931-637-047 / 991-554-666, eyauri@agroyauri.com, Pachacamac - Lima, RUC 20614909189. Redes sociales: NO hay URLs reales (se ocultan si están vacías).
- git: `C:\Program Files\Git\cmd\git.exe`, identidad neechan15 / 58159260+neechan15@users.noreply.github.com. `gh` autenticado.
- **Sin precios en la web pública** (decisión del cliente, sept 2026): se quitó la sección Costos/planes del Home, el enlace "Costos" del menú, los planes del formulario y los precios de servicios/productos. Los campos de precio siguen en la BD y en el panel, pero no se muestran.
- Página de servicio (`src/pages/servicios/[slug].astro`): intro + foto, "Qué incluye" en tarjetas (cada `## Título` de la descripción cuyo cuerpo sea solo una lista se muestra así; ver `serviceSections` en `src/lib/site.ts`), pasos, productos (si hay categoría con el mismo slug), proyectos y otros servicios.
- Cambios de diseño pedidos por el cliente (sept 2026): se quitó el texto "Espacios que transforman vidas" del hero del inicio.
- Rediseño 24-09-2026 (según imagen de referencia del usuario): **header TRANSPARENTE** sobre el hero (logo `logo_claro.png` verde claro + texto blanco, enlaces blancos con subrayado lima en el activo, botón verde `btn-green` "Solicita una cotización", línea fina abajo); al hacer scroll se fija con fondo verde oscuro translúcido. En 404 (fondo claro) el header es verde sólido (`body:has(.notfound)`). Móvil: transparente con menú redondo verde. **Hero del inicio CENTRADO** (título 2 líneas, texto, 2 botones; se quitaron los 3 beneficios). `btn-green` = #15854a (contraste 4.68 con blanco; no aclararlo). Se mantuvo "Nosotros" en el menú.
- **Formulario corto** (24-09-2026): Nombre*, Teléfono/WhatsApp*, Servicio de interés*, Mensaje (opcional). Sin correo, distrito, empresa ni área (las columnas siguen en `leads`). `/api/lead`: correo opcional (si viene se valida), distrito opcional, límite 429 por teléfono si no hay correo. Migración `20260924000002_leads_email_optional.sql` (email nullable).
- Precios: el panel los edita; la web solo los muestra si `show_price = true` (hoy todos en false → "Solicitar cotización").
- Encargo vigente (sept 2026): lista de 9 fases del usuario con **MULTI-SITE** para JaggerDev (un Supabase para varias webs). Supabase FREE y Cloudflare Pages FREE. No rehacer diseño ni migrar de framework.

## Publicación (Cloudflare Pages)
- Proyecto `agroyauri` → **https://agroyauri.pages.dev** (cuenta Cloudflare jcorcuer4@gmail.com). CONECTADO A GIT desde el 24-09-2026 (`JaggerDevs/agroyauri`, rama de producción `main`: cada push a main se publica solo; build `npm run build`, salida `dist`, vars `PUBLIC_SITE_URL` y `PUBLIC_SITE_SLUG=agroyauri`). La app "Cloudflare Workers and Pages" está instalada en la org JaggerDevs con repos seleccionados: agroyauri debe estar en la lista.
- (El primer proyecto se creó por Direct Upload con wrangler y se borró el 24-09-2026 para recrearlo conectado a Git: un Direct Upload no se puede convertir.)
- Sin Supabase todavía: usa seed.json; el formulario responde 503 y el botón WhatsApp funciona.

## Multi-site (migración `20260924000001_multisite_crm.sql`)
- `sites` (Agroyauri = slug `agroyauri`), `site_users` (usuario ↔ web), `profiles.role`: pending | admin | super_admin.
- TODO el contenido y los leads tienen `site_id`; slugs únicos por (site_id, slug); FK compuestas (service_id, site_id) / (category_id, site_id).
- RLS: `can_access_site(site_id)` (super_admin → todo; admin → sus sites; pending → nada). `can_access_lead`, `shares_site`, `admin_sites()`, `admin_lead_stats(p_site_id, days)`.
- Leads: estados new/contacted/qualified/quoted/won/lost; `assigned_to` (trigger: solo miembros de la web o super_admin); notas en `lead_notes` (se eliminó `admin_notes`). `source`: website|whatsapp|google|google_ads|facebook|instagram|meta_ads (lógica en `functions/api/lead.ts`).
- Despliegue ↔ web: `PUBLIC_SITE_SLUG` (build, panel y Functions). `/api/lead` fija el site_id del servidor e ignora el del navegador. `/api/rebuild` exige `can_access_site` de ESA web.
- Storage: `<bucket>/<site_id>/…` (política por carpeta).
- Panel: rutas reales `/admin/<sección>` (regla `/admin/* /admin 200` en `_redirects`, `src/admin/nav.ts`); web actual en `src/admin/site.ts`; selector de web si hay más de una; "Publicar" solo para la web de este despliegue.

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
- [x] **Fases 3-6 Panel /admin** — HECHO. `src/pages/admin.astro` + `src/admin/{app,ui,crud,entities,images,publish,supabase}.ts` + `views/{dashboard,leads,prices,settings}.ts` + `src/styles/admin.css` + `src/pages/admin-media.json.ts` + `functions/api/rebuild.ts` + `public/_headers`. **`node scripts/e2e-admin.mjs` → 41/41 OK** (login/rol, KPIs, gráfico SVG, leads paginados/filtros/búsqueda en BD, estado+notas, WhatsApp/tel/mail, precios servicios+planes, proyecto con subida WebP a Storage, galería, 301 al cambiar slug, blog con preview Markdown, borrar con ELIMINAR, configuración, publicar → deploy hook, /api/rebuild 401/403, móvil). Verificado que tras publicar el build refleja precios, planes, slug nuevo+301, blog, redes e imágenes de Storage optimizadas (AVIF/WebP/JPG).
- [x] **Fase 7 SEO técnico** — `node scripts/audit-seo.mjs` (tras build) → sin observaciones: title ≤70 y description 50–170 únicos (helpers `seoTitle`/`seoDescription` en `src/lib/site.ts`), canonical limpio, 1 H1, OG, JSON-LD válido (LocalBusiness, Service, ItemList, CreativeWork, Article, BreadcrumbList), alt + width/height, 0 enlaces rotos, sitemap sin /admin, robots OK. GA4/GSC solo si `PUBLIC_GA_ID`/`PUBLIC_GSC_VERIFICATION` existen (verificado; nunca en /admin).
- [x] **Fase 8 Performance** — Lighthouse móvil (local, sin CDN): inicio perf 96 / a11y 100 / BP 100 / SEO 100, LCP 2.5 s, CLS 0, 626 KB (v1: perf 67, LCP 7.9 s, 2.3 MB); página de servicio perf 100, LCP 1.7 s, 198 KB. JS público ≤ ~3.5 KB/página; `marked` y `supabase-js` solo en /admin. Logo con densities 1x/2x. CSS externo (inline solo ganaba 0.1 s).
- [x] **Fase 9 Auditoría + docs** — `README.md` (arquitectura, rutas, env, despliegue, credenciales a crear, checklists Search Console/GA4), `docs/SUPABASE.md`, `docs/CLOUDFLARE.md`, `.env.example`. Regresión OK: test:db 31/31, e2e-leads 18/18, e2e-admin 41/41, audit-seo limpio, build sin credenciales (seed) OK, 0 secretos en dist. Comparación visual final v1 vs v2: idéntica salvo íconos de redes ocultos (sin URLs reales) y línea de privacidad del formulario.
- [x] **Multi-site + CRM (sept 2026)** — test:db 59/59, e2e-leads 24/24 (27/27 tras formulario corto; Lighthouse inicio móvil 98/100/100/100, LCP 2,3 s), e2e-admin 71/71 (incluye admin de otra web y super_admin), audit-seo limpio, tsc sin errores, JS público 3,8 KB sin Supabase, solo la clave anon en dist. Lighthouse móvil página de servicio: 99/100/100/100.
  - RESUELTO (24-09-2026): el inicio daba "NO_LCP" (rendimiento 0) porque el carrusel con scroll-snap y padding lateral 2px se auto-ajustaba al cargar; Chrome lo contaba como scroll y dejaba de medir LCP. Arreglo: `scroll-padding-inline: 2px` en `.car-track` y `.cards-6` móvil. Ahora inicio: móvil 99 (LCP 2,0 s), escritorio 100. Regla: todo scroller con scroll-snap y padding necesita scroll-padding igual.
- [x] **Supabase real creado (24-09-2026)**: proyecto **`jaggerdev-sites`** (org JaggerDev, plan Free, sa-east-1), UN proyecto para todas las webs (multi-site). Se ejecutó en el SQL Editor init + multisite_crm + seed en un solo script (verificado: webs 1, servicios 7, proyectos 9, productos 5, buckets 3). Usuario **`jcorcuer4@gmail.com` = super_admin** ("JaggerDev"), verificado. El CLI `npx supabase` NO tiene login en esta PC (todo se hizo pegando SQL en el dashboard).
  - Cuentas: super_admin = JaggerDev (ve todas las webs). El cliente tendrá su propio usuario `admin` asignado en `site_users` solo a `agroyauri` (SQL en docs/SUPABASE.md §3) — se crea MÁS TARDE, cuando se le entregue el panel.
- [ ] **PENDIENTE EN SUPABASE REAL**: ejecutar en el SQL Editor `supabase/migrations/20260924000002_leads_email_optional.sql` (`alter table public.leads alter column email drop not null;`). Sin esto el formulario corto fallará al insertar.
- [ ] **SIGUIENTE**: confirmar que "Allow new users to sign up" está desactivado; el usuario pasa Project URL + anon key → verificar lectura/RLS desde aquí y build con Supabase → Cloudflare Pages: variables (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, secretos `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CF_DEPLOY_HOOK_URL`) + deploy hook → probar formulario y "Publicar cambios" en producción. La service_role NUNCA por el chat: va directo a Cloudflare.
- [ ] Revisar textos de servicios/productos (redactados desde el brochure). Crear usuario admin del cliente.

## Pruebas locales (sin cuenta Supabase)
- Emulador: `POSTGREST_BIN=<ruta>/postgrest node scripts/local-supabase.mjs` → API en http://127.0.0.1:54321. Usuarios: `super@jaggerdev.test / super12345` (super_admin), `admin@agroyauri.test / admin12345`, `otro@otra-empresa.test / otro12345` (otra web), `intruso@agroyauri.test / intruso12345` (pending). Linux: binario `postgrest-v16.3-linux-static-x86-64` de GitHub releases (no necesita libpq). Claves en `%TEMP%\agroyauri-local-keys.json`. PostgREST 16.3 Windows necesita `LIBPQ.dll` (copiada del wheel psycopg-binary a la carpeta del exe). Si se reinicia el PC hay que volver a descargarlo (scratchpad temporal).
  - Limitación: errores de BD (permiso denegado, duplicados) llegan como 503 en el emulador (pglite-socket); en Supabase real son 401/403/409.
- `.env` y `.dev.vars` locales (gitignored) apuntan al emulador. `npx astro build` luego `npx wrangler pages dev dist --port 8788 --ip 127.0.0.1 --compatibility-date=2026-09-01 --live-reload=false`.
  - Si wrangler se cuelga: matar procesos `workerd` y node con "wrangler" (PowerShell) y relanzar.
- Capturas: Chrome headless `--screenshot`; para móvil usar iframe de 390px (Chrome headless tiene ancho mínimo). En Linux: puppeteer-core con `/usr/bin/google-chrome-stable` (los e2e lo usan por defecto).
- Linux: `pkill -f '<patrón>'` se mata a sí mismo si el patrón aparece en el comando; usar `pgrep` + kill.

## Lecciones
- Heredocs grandes en Bash con comillas simples/`$` fallan: usar la herramienta Write.
- `.section h2` aplica estilo de título con línea verde a TODO h2 dentro de secciones: para h2 de tarjetas usar clases `card-h`, `post-title`, `aside-title`, `empty-title`, `cat-title` (overrides en `src/styles/pages.css`).
- Pattern HTML con flag v: escapar `( ) -` dentro de clases.

## Continuar en otra PC
1. `git clone https://github.com/JaggerDevs/agroyauri.git && cd agroyauri`
2. `npm install` (Node 22+). Si npm bloquea scripts: `npm approve-scripts esbuild workerd sharp`.
3. `npm run dev` (sin .env usa src/data/seed.json) · `npm run build` · `npm run test:db`.
4. NO están en git (copiar a mano si se necesitan): `documentos/` (brochure), `referencias/`, `assets/` originales, `.env`, `.dev.vars`.
5. Para el emulador local: descargar PostgREST (Windows: zip v16.3 de GitHub releases) y copiar `libpq.dll` del wheel `psycopg-binary` junto al exe como `LIBPQ.dll`.
6. Siguiente paso real: `npx supabase login` → crear proyecto (región sa-east-1) → aplicar migración + seed → crear admin → Cloudflare Pages (conectar Git en el dashboard, variables, deploy hook). Ver docs/.
