// Prueba las migraciones, el seed y las políticas RLS en un Postgres embebido
// (PGlite) que imita lo mínimo de Supabase: roles anon/authenticated/service_role,
// auth.users, auth.uid() y storage.buckets/objects.
// Uso: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { applySchema } from "./lib/supabase-stub.mjs";

const db = new PGlite();
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// ---------- stub de Supabase + migraciones + seed ----------
await applySchema(db);
console.log("✓ migraciones aplicadas");
await db.exec(read("../supabase/seed.sql")); // idempotencia: el seed se puede re-ejecutar
console.log("✓ seed aplicado 2 veces (idempotente)");

// ---------- usuarios ----------
const ADMIN = "11111111-1111-1111-1111-111111111111";
const PENDING = "22222222-2222-2222-2222-222222222222";
await db.exec(`
  insert into auth.users (id, email) values ('${ADMIN}', 'admin@test'), ('${PENDING}', 'intruso@test');
  update public.profiles set role = 'admin' where id = '${ADMIN}';
  insert into public.leads (name, phone, email, service_label, source)
    values ('Lead Prueba', '999999999', 'lead@test.com', 'Paisajismo', 'test');
`);

let failures = 0;
async function as(role, sub, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
  try {
    const r = await db.query(sql);
    return { rows: r.rows, affected: r.affectedRows ?? 0 };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec("reset role;");
  }
}
function expect(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : "  → " + detail}`);
  if (!ok) failures++;
}
const blocked = (r) => !!r.error || r.affected === 0 || (r.rows && r.rows.length === 0);

// ---------- visitante anónimo ----------
let r = await as("anon", null, "select id from public.leads");
expect("anon NO lee leads", blocked(r), JSON.stringify(r));
r = await as("anon", null, "insert into public.leads (name, phone, email) values ('x','123456','a@b.co')");
expect("anon NO inserta leads directo", !!r.error, JSON.stringify(r));
r = await as("anon", null, "delete from public.leads");
expect("anon NO borra leads", blocked(r), JSON.stringify(r));
r = await as("anon", null, "update public.services set price_from = 1");
expect("anon NO modifica precios", blocked(r), JSON.stringify(r));
r = await as("anon", null, "insert into public.projects (title, slug) values ('x','x')");
expect("anon NO crea proyectos", !!r.error, JSON.stringify(r));
r = await as("anon", null, "update public.site_settings set value = '{}'");
expect("anon NO modifica configuración", blocked(r), JSON.stringify(r));
r = await as("anon", null, "insert into storage.objects (bucket_id, name) values ('projects','x.webp')");
expect("anon NO sube imágenes", !!r.error, JSON.stringify(r));
r = await as("anon", null, "select public.admin_lead_stats()");
expect("anon NO obtiene métricas", !!r.error, JSON.stringify(r));

r = await as("anon", null, "select count(*)::int n from public.services");
expect("anon lee servicios activos (7)", r.rows?.[0]?.n === 7, JSON.stringify(r));
await db.exec("update public.services set is_active = false where slug = 'saneamiento-ambiental'");
r = await as("anon", null, "select count(*)::int n from public.services");
expect("anon NO ve servicios inactivos (6)", r.rows?.[0]?.n === 6, JSON.stringify(r));
await db.exec("update public.services set is_active = true where slug = 'saneamiento-ambiental'");
r = await as("anon", null, "select count(*)::int n from public.blog_posts");
expect("anon NO ve borradores del blog", r.rows?.[0]?.n === 0, JSON.stringify(r));
r = await as("anon", null, "select count(*)::int n from public.projects");
expect("anon lee proyectos publicados (9)", r.rows?.[0]?.n === 9, JSON.stringify(r));

// ---------- usuario autenticado NO admin ----------
r = await as("authenticated", PENDING, "select id from public.leads");
expect("usuario no-admin NO lee leads", blocked(r), JSON.stringify(r));
r = await as("authenticated", PENDING, "update public.services set price_from = 1");
expect("usuario no-admin NO modifica precios", blocked(r), JSON.stringify(r));
r = await as("authenticated", PENDING, `update public.profiles set role = 'admin' where id = '${PENDING}'`);
expect("usuario no-admin NO se auto-promueve", blocked(r), JSON.stringify(r));
r = await as("authenticated", PENDING, "insert into storage.objects (bucket_id, name) values ('projects','x.webp')");
expect("usuario no-admin NO sube imágenes", !!r.error, JSON.stringify(r));
r = await as("authenticated", PENDING, "select public.admin_lead_stats() s");
expect("usuario no-admin obtiene métricas vacías", r.rows?.[0]?.s?.new === 0, JSON.stringify(r));

// ---------- administrador ----------
r = await as("authenticated", ADMIN, "select id from public.leads");
expect("admin lee leads", r.rows?.length === 1, JSON.stringify(r));
r = await as("authenticated", ADMIN, "update public.leads set status = 'contacted', admin_notes = 'llamado' returning status");
expect("admin cambia estado de lead", r.rows?.[0]?.status === "contacted", JSON.stringify(r));
r = await as("authenticated", ADMIN, "update public.leads set status = 'inventado'");
expect("estado inválido rechazado", !!r.error, JSON.stringify(r));
r = await as("authenticated", ADMIN, "update public.services set price_type='from', price_from = 1200, price_unit='m²', show_price = true where slug='paisajismo-lima' returning price_from");
expect("admin modifica precios", Number(r.rows?.[0]?.price_from) === 1200, JSON.stringify(r));
r = await as("authenticated", ADMIN, "insert into public.projects (title, slug) values ('Nuevo','nuevo-proyecto') returning id");
expect("admin crea proyectos", r.rows?.length === 1, JSON.stringify(r));
r = await as("authenticated", ADMIN, "insert into public.projects (title, slug) values ('Malo','Slug Malo')");
expect("slug inválido rechazado", !!r.error, JSON.stringify(r));
r = await as("authenticated", ADMIN, "select count(*)::int n from public.blog_posts");
expect("admin ve borradores", r.rows?.[0]?.n === 1, JSON.stringify(r));
r = await as("authenticated", ADMIN, "insert into storage.objects (bucket_id, name) values ('projects','x.webp') returning id");
expect("admin sube imágenes", r.rows?.length === 1, JSON.stringify(r));
r = await as("authenticated", ADMIN, "select public.admin_lead_stats(7) s");
const s = r.rows?.[0]?.s;
expect("admin obtiene métricas", s?.today === 1 && s?.daily?.length === 7, JSON.stringify(r));

// ---------- service role (Cloudflare Function) ----------
r = await as("service_role", null, "insert into public.leads (name, phone, email, utm_source, landing_page) values ('Web','988777666','web@test.com','google','/servicios/riego-tecnificado-lima') returning utm_source");
expect("service role inserta lead con UTM", r.rows?.[0]?.utm_source === "google", JSON.stringify(r));
r = await as("service_role", null, "insert into public.leads (name, phone, email) values ('X','1','no-es-email')");
expect("lead con datos inválidos rechazado por la BD", !!r.error, JSON.stringify(r));

const rls = await db.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`);
expect("RLS activado en TODAS las tablas públicas", rls.rows.length === 0, JSON.stringify(rls.rows));

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas pasaron");
process.exit(failures ? 1 : 0);
