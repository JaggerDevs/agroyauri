# AGROYAURI SAC — Web corporativa

Web pública rápida y orientada a SEO, captación de leads y un panel de administración (CMS + CRM).
**Stack:** Astro 7 (estático) · Cloudflare Pages + Functions (Free) · Supabase (Free: Postgres, Auth, Storage, RLS).
**Multi-site:** el mismo proyecto Supabase puede servir a varias webs (JaggerDev). Cada web es una fila de `sites`; cada despliegue de Cloudflare sabe cuál es la suya por `PUBLIC_SITE_SLUG`.

## Arquitectura

```
Visitante ──► Cloudflare CDN ──► HTML/CSS/imagenes ESTÁTICOS (sin consultas a Supabase)
    │
    └─ formulario ──► /api/lead (Cloudflare Function) ──valida/antispam──► Supabase.leads
                          site_id = el de PUBLIC_SITE_SLUG   (service role: solo en el servidor)

Administrador ──► /admin (Supabase Auth + RLS por web: site_users / super_admin)
    ├─ lee/edita leads, servicios, precios, proyectos, productos, blog, configuración
    ├─ sube imágenes (comprimidas a WebP en el navegador) ──► Supabase Storage
    └─ "Publicar cambios" ──► /api/rebuild (verifica acceso a ESTA web) ──► Deploy hook ──► nuevo build
                                                                  │
                         build: Astro lee Supabase (clave anon) ◄─┘ y regenera las páginas
```

- **Contenido público estático y prerenderizado.** Supabase solo se consulta durante el build → cero consultas por visita, ideal para el plan Free.
- **JavaScript mínimo** en la web pública: menú, carrusel y formulario (~5 KB). `supabase-js` solo se carga en `/admin`.
- **Imágenes** AVIF/WebP/JPG con `srcset`, `width`/`height` y lazy loading; el hero es la imagen LCP con `fetchpriority="high"`.
- **Fuentes** locales: 5 archivos WOFF2 (Lora 700, Poppins 400/500/600, Caveat 600).
- Si Supabase falla durante un build, el build falla y Cloudflare mantiene la versión anterior publicada.

## Rutas

| Ruta | Contenido |
|---|---|
| `/` | Inicio (diseño aprobado): hero, servicios, proyectos, contacto |
| `/nosotros` | Quiénes somos, presentación, misión, visión, valores, proyectos, CTA |
| `/servicios`, `/servicios/[slug]` | Servicios: presentación, "qué incluye", pasos, precio solo si `show_price`, productos/proyectos relacionados y formulario preseleccionado |
| `/proyectos`, `/proyectos/[slug]` | Proyectos reales con galería y antes/después |
| `/productos` | Catálogo con “Consultar por WhatsApp” (sin carrito) |
| `/blog`, `/blog/[slug]` | Artículos (el índice queda `noindex` mientras no haya publicados) |
| `/contacto` | Datos de contacto + formulario |
| `/admin`, `/admin/leads`, `/admin/leads/[id]`… | Panel (noindex, requiere login). Cloudflare sirve `/admin` para `/admin/*` (regla 200 en `_redirects`) |
| `/sitemap.xml`, `/robots.txt`, `404` | SEO técnico |
| `/api/lead`, `/api/rebuild` | Cloudflare Functions |

## Base de datos
Ver **[docs/SUPABASE.md](docs/SUPABASE.md)** (tablas, RLS, buckets, creación del admin, respaldos).
Migraciones: `supabase/migrations/`. Contenido inicial: `src/data/seed.json` → `npm run seed:sql` → `supabase/seed.sql`.

Estados de lead (la BD guarda el valor; el panel muestra el texto): `new` Nuevo · `contacted` Contactado · `qualified` Calificado · `quoted` Cotizado · `won` Ganado · `lost` Perdido.
Cada lead guarda `site_id`, `source` (`website`, `whatsapp`, `google`, `google_ads`, `facebook`, `instagram`, `meta_ads` u otro `utm_source`; si no se puede deducir: `website`), `landing_page` (primera página de la visita), `referrer`, `utm_source/medium/campaign/content/term` y `assigned_to`. Las notas van en `lead_notes` (historial con autor y fecha).

## Variables de entorno
Ver **[.env.example](.env.example)**. Resumen:
- **Públicas** (build y navegador): `PUBLIC_SITE_URL`, `PUBLIC_SITE_SLUG` (web de este despliegue, por defecto `agroyauri`), `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_GA_ID`, `PUBLIC_GSC_VERIFICATION`, `PUBLIC_TURNSTILE_SITE_KEY`.
- **Secretas** (solo Cloudflare Functions): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CF_DEPLOY_HOOK_URL`, `TURNSTILE_SECRET_KEY`.

## Despliegue
1. **Supabase:** crear proyecto, ejecutar las migraciones + seed, crear el super_admin / admin, asignarlo a la web y desactivar registros → [docs/SUPABASE.md](docs/SUPABASE.md).
2. **Cloudflare Pages:** conectar el repo, build `npm run build`, salida `dist`, variables y deploy hook → [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md).
3. Entrar a `https://TU-SITIO/admin`, revisar contenido y pulsar **Publicar cambios**.

### Credenciales que debes crear tú (no se incluyen en el repositorio)
- Cuenta/proyecto de **Supabase** → URL, anon key, service_role key.
- **Usuario administrador** (correo + contraseña) en Supabase Auth.
- Proyecto de **Cloudflare Pages** → deploy hook.
- Opcional: **Google Analytics 4** (ID de medición), **Search Console** (código de verificación), **Turnstile** (site/secret key), **dominio propio**, URLs reales de **Facebook/Instagram/LinkedIn** (se cargan en el panel → Configuración; si están vacías no se muestran íconos).

## Desarrollo local
```bash
npm install
npm run dev          # http://localhost:4321 (sin .env usa src/data/seed.json)
npm run build        # genera dist/
npm run test:db      # migraciones + 59 pruebas de RLS y aislamiento multi-site (Postgres embebido)
node scripts/audit-seo.mjs   # auditoría SEO de dist/
```
Pruebas de punta a punta sin cuenta de Supabase (emulador local con PostgREST real):
```bash
POSTGREST_BIN=/ruta/postgrest node scripts/local-supabase.mjs   # imprime claves y usuarios de prueba (Agroyauri + "Otra Empresa")
# .env  → PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 + PUBLIC_SUPABASE_ANON_KEY local
# .dev.vars → PUBLIC_SITE_SLUG=agroyauri, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY local, CF_DEPLOY_HOOK_URL=http://127.0.0.1:54321/__deploy-hook
npm run build && npx wrangler pages dev dist --port 8788
node scripts/e2e-leads.mjs    # 24 pruebas: formulario, site_id del servidor, origen, UTM, antispam
node scripts/e2e-admin.mjs    # 71 pruebas: panel, CRM, CMS y aislamiento admin / otra web / super_admin
```

## Checklist Google Search Console
1. search.google.com/search-console → **Agregar propiedad** → *Prefijo de URL* con la URL pública.
2. Método **Etiqueta HTML** → copia solo el valor `content` → variable `PUBLIC_GSC_VERIFICATION` → redeploy → **Verificar**.
   (Con dominio propio es mejor la propiedad *Dominio* verificada por DNS en Cloudflare.)
3. **Sitemaps** → enviar `sitemap.xml`.
4. **Inspección de URL** → probar `/`, `/servicios/paisajismo-lima` y un proyecto → *Solicitar indexación*.
5. Revisar en 1–2 semanas: *Páginas* (indexadas / excluidas), *Experiencia* (Core Web Vitals) y *Mejoras* (breadcrumbs).
6. Crear/actualizar el **Perfil de Empresa de Google** (Google Maps) con el mismo nombre, teléfono y dirección que la web (clave para SEO local en Lima).

## Checklist Google Analytics 4
1. analytics.google.com → **Crear propiedad** (zona horaria Lima, moneda PEN) → flujo de datos **Web** con la URL pública.
2. Copia el **ID de medición** `G-XXXXXXXXXX` → variable `PUBLIC_GA_ID` → redeploy.
3. La web envía el evento `generate_lead` (con `method: form` o `whatsapp`) al enviar el formulario. En GA4 → *Administrar → Eventos* márcalo como **evento clave (conversión)**.
4. Vincula GA4 con Search Console (Administrar → Vinculaciones).
5. Para campañas usa enlaces con UTM, por ejemplo:
   `https://TU-SITIO/servicios/riego-tecnificado-lima?utm_source=google&utm_medium=cpc&utm_campaign=riego-lima`
   Los UTM también quedan guardados en cada lead del panel.

## Futuro (preparado, no implementado)
- **Ecommerce:** `products` ya tiene precio, disponibilidad y categorías; faltaría carrito/pedidos.
- **Más roles por web:** ampliar el check de `site_users.role` (p. ej. `editor`) y sus políticas.
- **Nueva web en el mismo Supabase:** insertar la fila en `sites`, cargar su contenido con su `site_id`, asignar usuarios en `site_users` y crear otro proyecto de Cloudflare Pages con su `PUBLIC_SITE_SLUG`.
- **Notificaciones de leads:** un Database Webhook de Supabase o un envío desde `/api/lead`.
