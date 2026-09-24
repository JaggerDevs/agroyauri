// POST /api/lead — Cloudflare Pages Function.
// Valida en servidor, filtra spam y guarda el lead en Supabase con la
// SERVICE ROLE KEY, que existe SOLO como secreto de Cloudflare (nunca en el navegador).
// MULTI-SITE: el site_id sale de la configuración del servidor (PUBLIC_SITE_SLUG de
// este proyecto de Cloudflare). Cualquier site_id que envíe el navegador se ignora.

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  PUBLIC_SITE_SLUG?: string;
  TURNSTILE_SECRET_KEY?: string;
}

const MAX_BODY = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return s ? s.slice(0, max) : null;
};

const path = (v: unknown): string | null => {
  const s = str(v, 300);
  return s && s.startsWith("/") && !s.startsWith("//") ? s : null;
};

const PAID = /^(cpc|ppc|paid|paid[_-]?social|paidsocial|ads?|display|cpm)$/;
const META = /^(facebook|fb|instagram|ig|meta)$/;

/**
 * Origen del lead: whatsapp | google_ads | meta_ads | google | facebook | instagram | website
 * (u otro utm_source tal cual). Si no puede determinarse: website.
 */
function leadSource(b: Record<string, unknown>, host: string): string {
  const utmSource = str(b.utm_source, 120)?.toLowerCase() ?? null;
  const utmMedium = str(b.utm_medium, 120)?.toLowerCase() ?? "";
  const paid = PAID.test(utmMedium);
  if (b.channel === "whatsapp") return "whatsapp";
  if (b.gclid || (utmSource === "google" && paid)) return "google_ads";
  if (utmSource && META.test(utmSource) && paid) return "meta_ads";
  if (utmSource) return META.test(utmSource) ? (utmSource.startsWith("i") ? "instagram" : "facebook") : utmSource.slice(0, 60);
  const referrer = str(b.referrer, 300);
  if (!referrer) return "website";
  try {
    const h = new URL(referrer).hostname.replace(/^www\./, "");
    if (h === host || h.endsWith(`.${host}`)) return "website";
    if (/(^|\.)google\./.test(h)) return "google";
    if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(h)) return "facebook";
    if (/(^|\.)instagram\.com$/.test(h)) return "instagram";
    return "website";
  } catch {
    return "website";
  }
}

/** id de la web de este despliegue (se cachea mientras viva el worker). */
let siteCache: { slug: string; id: string } | null = null;
async function siteId(env: Env, headers: Record<string, string>): Promise<string | null> {
  const slug = (env.PUBLIC_SITE_SLUG || "agroyauri").trim();
  if (siteCache?.slug === slug) return siteCache.id;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/sites?select=id&is_active=eq.true&slug=eq.${encodeURIComponent(slug)}`, { headers });
  if (!r.ok) return null;
  const rows = (await r.json()) as { id: string }[];
  if (!rows[0]) return null;
  siteCache = { slug, id: rows[0].id };
  return siteCache.id;
}

async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean> {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = (await r.json().catch(() => ({}))) as { success?: boolean };
  return data.success === true;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(503, { error: "El formulario no está configurado todavía." });
  }

  // Solo peticiones desde este mismo sitio.
  const reqUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).host !== reqUrl.host) return json(403, { error: "Origen no permitido." });
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) return json(415, { error: "Formato no válido." });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { error: "Solicitud demasiado grande." });
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw);
  } catch {
    return json(400, { error: "Solicitud no válida." });
  }

  // Antispam silencioso: campo trampa y envíos “instantáneos” de bots.
  const elapsed = Number(b.elapsed_ms);
  if (str(b.website, 200) || !Number.isFinite(elapsed) || elapsed < 2500) {
    return json(200, { ok: true });
  }

  const ip = request.headers.get("CF-Connecting-IP");
  if (env.TURNSTILE_SECRET_KEY) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, str(b.turnstile_token, 2048) ?? "", ip);
    if (!ok) return json(400, { error: "No pudimos verificar el formulario. Recarga la página e inténtalo de nuevo." });
  }

  // ---------- validación de campos ----------
  const errors: string[] = [];
  const name = str(b.name, 120);
  const phone = str(b.phone, 30);
  const email = str(b.email, 160)?.toLowerCase() ?? null;
  const district = str(b.district, 120);
  const serviceId = str(b.service_id, 36);
  const serviceLabel = str(b.service_label, 120);
  const areaRaw = str(b.area_m2, 20);
  const area = areaRaw ? Number(areaRaw.replace(",", ".")) : null;

  if (!name || name.length < 2) errors.push("nombre");
  if (!phone || !/^[0-9+()\s-]{6,30}$/.test(phone) || phone.replace(/\D/g, "").length < 6) errors.push("teléfono");
  if (!email || !EMAIL.test(email)) errors.push("correo");
  if (!district) errors.push("distrito");
  if (!serviceLabel && !serviceId) errors.push("servicio");
  if (area !== null && (!Number.isFinite(area) || area <= 0 || area >= 100_000_000)) errors.push("área");
  if (errors.length) return json(422, { error: `Revisa: ${errors.join(", ")}.` });

  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  const site = await siteId(env, headers);
  if (!site) {
    console.error("Web no encontrada o inactiva:", env.PUBLIC_SITE_SLUG);
    return json(503, { error: "El formulario no está configurado todavía." });
  }

  // Límite anti-abuso: máx. 3 solicitudes del mismo correo o teléfono en 10 minutos.
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const q = (v: string) => `"${v.replace(/["\\]/g, "")}"`;
  const orFilter = encodeURIComponent(`(email.eq.${q(email!)},phone.eq.${q(phone!)})`);
  const recent = await fetch(`${env.SUPABASE_URL}/rest/v1/leads?select=id&site_id=eq.${site}&created_at=gte.${since}&or=${orFilter}&limit=3`, { headers });
  if (recent.ok) {
    const rows = (await recent.json()) as unknown[];
    if (rows.length >= 3) return json(429, { error: "Ya recibimos tus solicitudes. Te contactaremos pronto." });
  }

  const lead = {
    site_id: site, // SIEMPRE el de este despliegue, nunca el que envíe el navegador
    name,
    company: str(b.company, 120),
    phone,
    email,
    service_id: serviceId && UUID.test(serviceId) ? serviceId : null,
    service_label: serviceLabel,
    district,
    location: str(b.location, 200),
    area_m2: area,
    message: str(b.message, 3000),
    source: leadSource(b, reqUrl.hostname.replace(/^www\./, "")),
    landing_page: path(b.landing_page) ?? path(b.page),
    referrer: str(b.referrer, 300),
    utm_source: str(b.utm_source, 120),
    utm_medium: str(b.utm_medium, 120),
    utm_campaign: str(b.utm_campaign, 160),
    utm_content: str(b.utm_content, 160),
    utm_term: str(b.utm_term, 160),
  };

  let res = await fetch(`${env.SUPABASE_URL}/rest/v1/leads`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(lead),
  });
  // Si el servicio fue eliminado entre el build y el envío, se guarda sin la relación.
  if (res.status === 409 && lead.service_id) {
    res = await fetch(`${env.SUPABASE_URL}/rest/v1/leads`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ ...lead, service_id: null }),
    });
  }
  if (!res.ok) {
    console.error("Supabase insert lead", res.status, await res.text().catch(() => ""));
    return json(502, { error: "No pudimos registrar tu solicitud en este momento." });
  }
  return json(201, { ok: true });
};
