# Cloudflare Pages (plan Free)

## 1. Conectar el repositorio
1. https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → repositorio `JaggerDevs/agroyauri`.
2. Configuración de build:
   - **Framework preset:** Astro
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Production branch:** `main`
   - **Root directory:** vacío
   - **Node 22:** lo toma del archivo `.node-version` del repositorio. No pongas nada de Node en el *Build command*; si quieres forzarlo, agrega la variable de entorno `NODE_VERSION` = `22`.
3. La carpeta `functions/` se detecta sola: `/api/lead` y `/api/rebuild` quedan como Pages Functions.

## 2. Variables de entorno
**Settings → Environment variables → Production** (y Preview si la usas):

| Variable | Tipo | Valor |
|---|---|---|
| `PUBLIC_SITE_URL` | texto | `https://agroyauri.pages.dev` o tu dominio |
| `PUBLIC_SITE_SLUG` | texto | `agroyauri` (web de este proyecto en la tabla `sites`) |
| `PUBLIC_SUPABASE_URL` | texto | URL del proyecto Supabase |
| `PUBLIC_SUPABASE_ANON_KEY` | texto | clave anon (pública) |
| `PUBLIC_GA_ID` | texto | opcional, `G-…` |
| `PUBLIC_GSC_VERIFICATION` | texto | opcional |
| `PUBLIC_TURNSTILE_SITE_KEY` | texto | opcional |
| `SUPABASE_URL` | **Secret** | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | clave service_role (NUNCA pública) |
| `CF_DEPLOY_HOOK_URL` | **Secret** | ver paso 3 |
| `TURNSTILE_SECRET_KEY` | **Secret** | opcional |

Tras cambiar variables, haz **Retry deployment** para aplicarlas.

## 3. Deploy hook (botón “Publicar cambios” del panel)
1. **Settings → Builds → Deploy hooks → Add deploy hook** → nombre `panel-admin`, rama de producción.
2. Copia la URL generada en la variable secreta `CF_DEPLOY_HOOK_URL`.
3. Desde el panel, “Publicar cambios” llama a `/api/rebuild`, que verifica que el usuario sea admin y dispara este hook. La web se actualiza en 1–3 minutos.

> Plan Free: 500 builds/mes. Por eso el panel publica con un botón (acumulando cambios) y no en cada guardado.

## 4. Turnstile (antispam opcional, gratuito)
Si aparecen leads basura: **Turnstile → Add site** (modo *Managed*), copia site key → `PUBLIC_TURNSTILE_SITE_KEY` y secret → `TURNSTILE_SECRET_KEY`. El widget solo se carga cuando el visitante empieza a escribir en el formulario (no afecta la velocidad). Sin estas variables, el antispam es: campo trampa + tiempo mínimo + límite de 3 envíos por correo/teléfono cada 10 min + validación de origen.

## 5. Dominio propio (cuando exista)
**Custom domains → Set up a domain** → sigue los pasos DNS. Luego cambia `PUBLIC_SITE_URL` y vuelve a desplegar (canonical y sitemap usan esa URL). En Supabase actualiza *Site URL*.

## 6. Caché y cabeceras
`public/_headers` define:
- `/_astro/*` y `/fonts/*` (archivos con hash): caché de 1 año, `immutable`.
- HTML: caché corta por defecto de Cloudflare (se renueva en cada deploy).
- `/admin`: `noindex` y `no-store`.
- Cabeceras de seguridad básicas (nosniff, referrer policy, frame, permissions).

`_redirects` se genera en cada build: redirecciones 301 de slugs cambiados en el panel (solo de esta web) y la regla `/admin/* /admin 200` para las rutas del panel.

## 7. Otra web en el mismo Supabase (multi-site)
Cada web tiene su propio proyecto de Cloudflare Pages (su repo, su dominio, su deploy hook) con las MISMAS claves de Supabase y su propio `PUBLIC_SITE_SLUG`. El formulario de cada despliegue solo puede crear leads de su web.
