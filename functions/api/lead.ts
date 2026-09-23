// POST /api/lead — Cloudflare Pages Function.
// Valida en servidor, filtra spam y guarda el lead en Supabase con la
// SERVICE ROLE KEY, que existe SOLO como secreto de Cloudflare (nunca en el navegador).

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
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

/** Canal de origen: utm_source si existe; si no, se deduce del referrer. */
function channel(utmSource: string | null, referrer: string | null, host: string): string {
  if (utmSource) return utmSource.toLowerCase().slice(0, 60);
  if (!referrer) return "directo";
  try {
    const h = new URL(referrer).hostname.replace(/^www\./, "");
    if (h === host || h.endsWith(`.${host}`)) return "directo";
    if (/(^|\.)google\./.test(h)) return "google-organico";
    if (/(^|\.)bing\.com$/.test(h)) return "bing-organico";
    if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(h) || h === "l.facebook.com" || h === "m.facebook.com") return "facebook";
    if (/(^|\.)instagram\.com$/.test(h) || h === "l.instagram.com") return "instagram";
    if (/(^|\.)(tiktok\.com)$/.test(h)) return "tiktok";
    if (/(^|\.)(linkedin\.com|lnkd\.in)$/.test(h)) return "linkedin";
    return `referido:${h}`.slice(0, 60);
  } catch {
    return "directo";
  }
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

  // Límite anti-abuso: máx. 3 solicitudes del mismo correo o teléfono en 10 minutos.
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const q = (v: string) => `"${v.replace(/["\\]/g, "")}"`;
  const orFilter = encodeURIComponent(`(email.eq.${q(email!)},phone.eq.${q(phone!)})`);
  const recent = await fetch(`${env.SUPABASE_URL}/rest/v1/leads?select=id&created_at=gte.${since}&or=${orFilter}&limit=3`, { headers });
  if (recent.ok) {
    const rows = (await recent.json()) as unknown[];
    if (rows.length >= 3) return json(429, { error: "Ya recibimos tus solicitudes. Te contactaremos pronto." });
  }

  const utmSource = str(b.utm_source, 120);
  const referrer = str(b.referrer, 300);
  const lead = {
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
    source: channel(utmSource, referrer, reqUrl.hostname.replace(/^www\./, "")),
    landing_page: path(b.landing_page) ?? path(b.page),
    referrer,
    utm_source: utmSource,
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
