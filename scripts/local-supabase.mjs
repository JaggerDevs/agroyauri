// Emulador LOCAL de Supabase para probar la web y el panel sin cuenta:
//   PGlite (Postgres real en WASM) + PostgREST real + Auth/Storage mínimos.
// Las migraciones y políticas RLS son las mismas de supabase/migrations.
//
// Uso:  POSTGREST_BIN=C:\ruta\postgrest.exe node scripts/local-supabase.mjs
//   API:       http://127.0.0.1:54321   (igual que `supabase start`)
//   Usuarios:  super@jaggerdev.test (super_admin) · admin@agroyauri.test (admin Agroyauri)
//              otro@otra-empresa.test (admin de otra web) · intruso@agroyauri.test (sin permisos)
//              Contraseña: la parte antes de @ + "12345" (p. ej. admin12345)
//   Imprime las claves anon / service_role locales (NO son de producción).
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { applySchema } from "./lib/supabase-stub.mjs";

const API_PORT = 54321, PG_PORT = 54329, PGRST_PORT = 54330;
const SECRET = "local-only-jwt-secret-do-not-use-in-production-000";
const STORAGE_DIR = join(tmpdir(), "agroyauri-local-storage");
const BIN = process.env.POSTGREST_BIN;
const hookCalls = [];
if (!BIN) throw new Error("Define POSTGREST_BIN con la ruta a postgrest(.exe)");

// ---------- JWT HS256 ----------
const b64u = (b) => Buffer.from(b).toString("base64url");
const sign = (payload) => {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
};
const verify = (t) => {
  const [h, p, s] = (t || "").split(".");
  if (!s || createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url") !== s) return null;
  const c = JSON.parse(Buffer.from(p, "base64url").toString());
  return c.exp && c.exp * 1000 < Date.now() ? null : c;
};
const now = () => Math.floor(Date.now() / 1000);
const ANON = sign({ role: "anon", iss: "local", iat: now(), exp: now() + 10 * 365 * 86400 });
const SERVICE = sign({ role: "service_role", iss: "local", iat: now(), exp: now() + 10 * 365 * 86400 });

// ---------- base de datos ----------
const db = await PGlite.create();
await applySchema(db);
// Multi-site: Agroyauri (del seed) + una segunda web para comprobar el aislamiento.
const OTHER_SITE = "99999999-9999-9999-9999-999999999999";
await db.query("insert into public.sites (id, name, slug) values ($1, 'Otra Empresa', 'otra-empresa')", [OTHER_SITE]);
await db.query("insert into public.leads (site_id, name, phone, email, service_label, source) values ($1, 'Lead de Otra Empresa', '988888888', 'otro@cliente.test', 'Jardín', 'website')", [OTHER_SITE]);
const AGRO_SITE = (await db.query("select id from public.sites where slug = 'agroyauri'")).rows[0].id;
const USERS = [
  { id: "00000000-0000-0000-0000-000000000001", email: "super@jaggerdev.test", password: "super12345", role: "super_admin", name: "JaggerDev", sites: [] },
  { id: "11111111-1111-1111-1111-111111111111", email: "admin@agroyauri.test", password: "admin12345", role: "admin", name: "Administrador Agroyauri", sites: [AGRO_SITE] },
  { id: "33333333-3333-3333-3333-333333333333", email: "otro@otra-empresa.test", password: "otro12345", role: "admin", name: "Admin Otra Empresa", sites: [OTHER_SITE] },
  { id: "22222222-2222-2222-2222-222222222222", email: "intruso@agroyauri.test", password: "intruso12345", role: "pending", name: "Intruso", sites: [] },
];
for (const u of USERS) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [u.id, u.email]);
  await db.query("update public.profiles set role = $2, full_name = $3 where id = $1", [u.id, u.role, u.name]);
  for (const s of u.sites) await db.query("insert into public.site_users (site_id, user_id) values ($1, $2)", [s, u.id]);
}
const sock = new PGLiteSocketServer({ db, port: PG_PORT, host: "127.0.0.1" });
await sock.start();

// ---------- PostgREST ----------
const pgrst = spawn(BIN, [], {
  env: {
    ...process.env,
    PGRST_DB_URI: `postgres://postgres@127.0.0.1:${PG_PORT}/postgres?sslmode=disable`,
    PGRST_DB_SCHEMAS: "public",
    PGRST_DB_ANON_ROLE: "anon",
    PGRST_JWT_SECRET: SECRET,
    PGRST_DB_POOL: "1",
    PGRST_DB_CHANNEL_ENABLED: "false",
    PGRST_DB_PREPARED_STATEMENTS: "false",
    PGRST_SERVER_PORT: String(PGRST_PORT),
    PGRST_SERVER_HOST: "127.0.0.1",
    PGRST_LOG_LEVEL: "warn",
  },
  stdio: ["ignore", "inherit", "inherit"],
});
process.on("exit", () => pgrst.kill());
process.on("SIGINT", () => process.exit(0));

// ---------- HTTP (API tipo Supabase) ----------
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, prefer, range, x-client-info, accept-profile, content-profile, x-upsert, cache-control",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "content-range, content-location",
};
const send = (res, status, body, extra = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...cors, ...extra });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });
const bearer = (req) => (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || req.headers.apikey;
const userObj = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
const session = (u) => {
  const exp = now() + 3600;
  return {
    access_token: sign({ sub: u.id, role: "authenticated", aud: "authenticated", email: u.email, iat: now(), exp }),
    token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: `r-${u.id}-${randomUUID()}`, user: userObj(u),
  };
};

// Misma regla que la política de Storage: la carpeta raíz del archivo es el site_id.
async function canWrite(token, path) {
  const sid = decodeURIComponent(path).split("/")[0];
  if (!/^[0-9a-f-]{36}$/.test(sid)) return false;
  const r = await fetch(`http://127.0.0.1:${PGRST_PORT}/rpc/can_access_site`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_site_id: sid }) });
  return r.ok && (await r.json()) === true;
}

createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, "", { "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] || cors["Access-Control-Allow-Headers"] });
    const url = new URL(req.url, `http://${req.headers.host}`);

    // ---- REST → PostgREST ----
    if (url.pathname.startsWith("/rest/v1")) {
      const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
      const headers = { ...req.headers };
      delete headers.host; delete headers["content-length"]; delete headers.connection;
      if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
      const r = await fetch(`http://127.0.0.1:${PGRST_PORT}${url.pathname.slice(8) || "/"}${url.search}`, { method: req.method, headers, body });
      const out = Buffer.from(await r.arrayBuffer());
      const h = { ...cors };
      r.headers.forEach((v, k) => { if (!["content-encoding", "transfer-encoding", "connection"].includes(k) && !k.startsWith("access-control-")) h[k] = v; });
      res.writeHead(r.status, h);
      return res.end(out);
    }

    // ---- Auth (mínimo) ----
    if (url.pathname === "/auth/v1/token") {
      const b = JSON.parse((await readBody(req)).toString() || "{}");
      if (url.searchParams.get("grant_type") === "password") {
        const u = USERS.find((x) => x.email === b.email && x.password === b.password);
        return u ? send(res, 200, session(u)) : send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials" });
      }
      if (url.searchParams.get("grant_type") === "refresh_token") {
        const id = String(b.refresh_token || "").slice(2, 38);
        const u = USERS.find((x) => x.id === id);
        return u ? send(res, 200, session(u)) : send(res, 400, { error: "invalid_grant" });
      }
    }
    if (url.pathname === "/auth/v1/user") {
      const c = verify(bearer(req));
      const u = c && USERS.find((x) => x.id === c.sub);
      return u ? send(res, 200, userObj(u)) : send(res, 401, { msg: "invalid JWT" });
    }
    if (url.pathname === "/auth/v1/logout") return send(res, 204, "");

    // ---- Storage (mínimo) ----
    const pub = url.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (pub && req.method === "GET") {
      const f = join(STORAGE_DIR, pub[1], decodeURIComponent(pub[2]));
      if (!existsSync(f)) return send(res, 404, { error: "not found" });
      res.writeHead(200, { ...cors, "Content-Type": f.endsWith(".webp") ? "image/webp" : "application/octet-stream", "Cache-Control": "public, max-age=3600" });
      return res.end(readFileSync(f));
    }
    const obj = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (obj && ["POST", "PUT"].includes(req.method)) {
      const token = bearer(req);
      if (!["projects", "products", "blog"].includes(obj[1]) || !(await canWrite(token, obj[2]))) return send(res, 403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
      let data = await readBody(req);
      // supabase-js envía multipart/form-data: extraer el archivo (Supabase real lo hace igual)
      const m = /boundary=(.+)$/.exec(req.headers["content-type"] || "");
      if (m) {
        const boundary = Buffer.from(`--${m[1]}`);
        const start = data.indexOf("\r\n\r\n", Math.max(0, data.indexOf("filename="))) + 4;
        const end = data.indexOf(boundary, start) - 2;
        data = data.subarray(start, end);
      }
      if (data.length > 5 * 1024 * 1024) return send(res, 413, { error: "Payload too large" });
      const f = join(STORAGE_DIR, obj[1], decodeURIComponent(obj[2]));
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, data);
      return send(res, 200, { Key: `${obj[1]}/${obj[2]}`, Id: randomUUID() });
    }
    const del = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)$/);
    if (del && req.method === "DELETE") {
      const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || "{}");
      for (const p of prefixes) if (!(await canWrite(bearer(req), p))) return send(res, 403, { error: "Unauthorized" });
      for (const p of prefixes) rmSync(join(STORAGE_DIR, del[1], p), { force: true });
      return send(res, 200, prefixes.map((name) => ({ name })));
    }

    // ---- deploy hook simulado (Cloudflare) ----
    if (url.pathname === "/__deploy-hook" && req.method === "POST") {
      hookCalls.push(new Date().toISOString());
      return send(res, 200, { id: `local-${hookCalls.length}` });
    }
    if (url.pathname === "/__deploy-hook/calls") return send(res, 200, hookCalls);

    send(res, 404, { error: `No emulado: ${req.method} ${url.pathname}` });
  } catch (e) {
    send(res, 500, { error: String(e) });
  }
}).listen(API_PORT, "127.0.0.1", () => {
  console.log(`\nSupabase LOCAL listo en http://127.0.0.1:${API_PORT}`);
  console.log(`PUBLIC_SUPABASE_ANON_KEY=${ANON}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY=${SERVICE}`);
  console.log("super@jaggerdev.test / super12345 · admin@agroyauri.test / admin12345 · otro@otra-empresa.test / otro12345 · intruso@agroyauri.test / intruso12345\n");
  writeFileSync(join(tmpdir(), "agroyauri-local-keys.json"), JSON.stringify({ url: `http://127.0.0.1:${API_PORT}`, anon: ANON, service: SERVICE }));
});
