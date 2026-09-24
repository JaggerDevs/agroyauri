// POST /api/rebuild — dispara un nuevo build en Cloudflare Pages (deploy hook).
// Solo para administradores DE ESTA WEB (PUBLIC_SITE_SLUG): se valida el JWT de
// Supabase y el permiso con la misma función que usa RLS (can_access_site).
// La URL del deploy hook es secreta (quien la tenga puede lanzar builds).

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CF_DEPLOY_HOOK_URL: string;
  PUBLIC_SITE_SLUG?: string;
}

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.CF_DEPLOY_HOOK_URL) {
    return json(503, { error: "Publicación no configurada: falta CF_DEPLOY_HOOK_URL o las claves de Supabase en Cloudflare." });
  }
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json(403, { error: "Origen no permitido." });

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Inicia sesión de nuevo." });

  // 1) ¿Token válido? (lo verifica el propio Supabase Auth)
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return json(401, { error: "Sesión inválida o expirada. Vuelve a ingresar." });
  const user = (await userRes.json()) as { id?: string };
  if (!user.id || !/^[0-9a-f-]{36}$/i.test(user.id)) return json(401, { error: "Sesión inválida." });

  // 2) ¿Administra esta web? Se consulta COMO el usuario: decide la misma regla que RLS.
  const slug = (env.PUBLIC_SITE_SLUG || "agroyauri").trim();
  const siteRes = await fetch(`${env.SUPABASE_URL}/rest/v1/sites?select=id&slug=eq.${encodeURIComponent(slug)}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const site = siteRes.ok ? ((await siteRes.json()) as { id: string }[])[0] : undefined;
  if (!site) return json(503, { error: `La web "${slug}" no existe en Supabase.` });
  const accessRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/can_access_site`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_site_id: site.id }),
  });
  if (!accessRes.ok || (await accessRes.json()) !== true) return json(403, { error: "No tienes permisos de administrador en esta web." });

  // 3) Deploy hook
  const hook = await fetch(env.CF_DEPLOY_HOOK_URL, { method: "POST" });
  if (!hook.ok) return json(502, { error: `Cloudflare no aceptó la publicación (HTTP ${hook.status}).` });
  return json(202, { ok: true });
};
