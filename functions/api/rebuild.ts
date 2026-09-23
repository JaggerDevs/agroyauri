// POST /api/rebuild — dispara un nuevo build en Cloudflare Pages (deploy hook).
// Solo para administradores: se valida el JWT de Supabase y el rol en profiles.
// La URL del deploy hook es secreta (quien la tenga puede lanzar builds).

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CF_DEPLOY_HOOK_URL: string;
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

  // 2) ¿Es administrador?
  const profRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=role&id=eq.${user.id}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const prof = profRes.ok ? ((await profRes.json()) as { role: string }[]) : [];
  if (prof[0]?.role !== "admin") return json(403, { error: "No tienes permisos de administrador." });

  // 3) Deploy hook
  const hook = await fetch(env.CF_DEPLOY_HOOK_URL, { method: "POST" });
  if (!hook.ok) return json(502, { error: `Cloudflare no aceptó la publicación (HTTP ${hook.status}).` });
  return json(202, { ok: true });
};
