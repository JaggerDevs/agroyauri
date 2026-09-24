// Prueba las migraciones, el seed y las políticas RLS en un Postgres embebido
// (PGlite) que imita lo mínimo de Supabase: roles anon/authenticated/service_role,
// auth.users, auth.uid() y storage.buckets/objects.
// Incluye el aislamiento MULTI-SITE: Agroyauri + una segunda web de prueba.
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

// ---------- webs y usuarios ----------
const SUPER = "00000000-0000-0000-0000-000000000001"; // JaggerDev
const AGRO = "11111111-1111-1111-1111-111111111111"; // admin de Agroyauri
const OTRO = "33333333-3333-3333-3333-333333333333"; // admin de otra web
const PENDING = "22222222-2222-2222-2222-222222222222"; // registrado sin permisos
const OTHER_SITE = "99999999-9999-9999-9999-999999999999";
const { rows: [{ id: AGRO_SITE }] } = await db.query("select id from public.sites where slug = 'agroyauri'");

await db.exec(`
  insert into public.sites (id, name, slug) values ('${OTHER_SITE}', 'Otra Empresa', 'otra-empresa');
  insert into auth.users (id, email) values
    ('${SUPER}', 'super@test'), ('${AGRO}', 'admin@test'), ('${OTRO}', 'otro@test'), ('${PENDING}', 'intruso@test');
  update public.profiles set role = 'super_admin' where id = '${SUPER}';
  update public.profiles set role = 'admin' where id in ('${AGRO}', '${OTRO}');
  insert into public.site_users (site_id, user_id) values ('${AGRO_SITE}', '${AGRO}'), ('${OTHER_SITE}', '${OTRO}');
  insert into public.services (site_id, name, slug) values ('${OTHER_SITE}', 'Servicio ajeno', 'paisajismo-lima');
  insert into public.leads (site_id, name, phone, email, service_label, source)
    values ('${AGRO_SITE}', 'Lead Agro', '999999999', 'lead@test.com', 'Paisajismo', 'website'),
           ('${OTHER_SITE}', 'Lead Otro', '988888888', 'otro@test.com', 'Jardín', 'website');
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
const names = (r) => (r.rows ?? []).map((x) => x.name).sort().join(",");

// ---------- visitante anónimo ----------
let r = await as("anon", null, "select id from public.leads");
expect("anon NO lee leads", blocked(r), JSON.stringify(r));
r = await as("anon", null, `insert into public.leads (site_id, name, phone, email) values ('${AGRO_SITE}','x','123456','a@b.co')`);
expect("anon NO inserta leads directo", !!r.error, JSON.stringify(r));
r = await as("anon", null, "delete from public.leads");
expect("anon NO borra leads", blocked(r), JSON.stringify(r));
r = await as("anon", null, "select id from public.lead_notes");
expect("anon NO lee notas", blocked(r), JSON.stringify(r));
r = await as("anon", null, "update public.services set price_from = 1");
expect("anon NO modifica precios", blocked(r), JSON.stringify(r));
r = await as("anon", null, `insert into public.projects (site_id, title, slug) values ('${AGRO_SITE}','x','x')`);
expect("anon NO crea proyectos", !!r.error, JSON.stringify(r));
r = await as("anon", null, "update public.site_settings set value = '{}'");
expect("anon NO modifica configuración", blocked(r), JSON.stringify(r));
r = await as("anon", null, "insert into public.sites (name, slug) values ('Falsa','falsa')");
expect("anon NO crea webs", !!r.error, JSON.stringify(r));
r = await as("anon", null, `insert into storage.objects (bucket_id, name) values ('projects','${AGRO_SITE}/x.webp')`);
expect("anon NO sube imágenes", !!r.error, JSON.stringify(r));
r = await as("anon", null, `select public.admin_lead_stats('${AGRO_SITE}')`);
expect("anon NO obtiene métricas", !!r.error, JSON.stringify(r));

r = await as("anon", null, `select count(*)::int n from public.services where site_id = '${AGRO_SITE}'`);
expect("anon lee servicios activos de Agroyauri (7)", r.rows?.[0]?.n === 7, JSON.stringify(r));
await db.exec("update public.services set is_active = false where slug = 'saneamiento-ambiental'");
r = await as("anon", null, `select count(*)::int n from public.services where site_id = '${AGRO_SITE}'`);
expect("anon NO ve servicios inactivos (6)", r.rows?.[0]?.n === 6, JSON.stringify(r));
await db.exec("update public.services set is_active = true where slug = 'saneamiento-ambiental'");
r = await as("anon", null, "select count(*)::int n from public.blog_posts");
expect("anon NO ve borradores del blog", r.rows?.[0]?.n === 0, JSON.stringify(r));
r = await as("anon", null, `select count(*)::int n from public.projects where site_id = '${AGRO_SITE}'`);
expect("anon lee proyectos publicados (9)", r.rows?.[0]?.n === 9, JSON.stringify(r));
r = await as("anon", null, "select id from public.sites where slug = 'agroyauri'");
expect("anon resuelve el slug de la web (build)", r.rows?.length === 1, JSON.stringify(r));

// ---------- autenticado sin permisos (pending) ----------
r = await as("authenticated", PENDING, "select id from public.leads");
expect("usuario sin permisos NO lee leads", blocked(r), JSON.stringify(r));
r = await as("authenticated", PENDING, "update public.services set price_from = 1");
expect("usuario sin permisos NO modifica precios", blocked(r), JSON.stringify(r));
r = await as("authenticated", PENDING, `update public.profiles set role = 'super_admin' where id = '${PENDING}'`);
expect("usuario sin permisos NO se auto-promueve", blocked(r), JSON.stringify(r));
r = await as("authenticated", PENDING, `insert into public.site_users (site_id, user_id) values ('${AGRO_SITE}', '${PENDING}')`);
expect("usuario sin permisos NO se asigna una web", !!r.error, JSON.stringify(r));
r = await as("authenticated", PENDING, `insert into storage.objects (bucket_id, name) values ('projects','${AGRO_SITE}/x.webp')`);
expect("usuario sin permisos NO sube imágenes", !!r.error, JSON.stringify(r));
r = await as("authenticated", PENDING, `select public.admin_lead_stats('${AGRO_SITE}') s`);
expect("usuario sin permisos obtiene métricas en cero", r.rows?.[0]?.s?.pending === 0, JSON.stringify(r));

// ---------- admin de Agroyauri ----------
r = await as("authenticated", AGRO, "select name from public.leads");
expect("admin Agroyauri lee SOLO leads de Agroyauri", names(r) === "Lead Agro", JSON.stringify(r));
r = await as("authenticated", AGRO, `select name from public.leads where site_id = '${OTHER_SITE}'`);
expect("admin Agroyauri NO lee leads de otra web aunque filtre por su site_id", blocked(r), JSON.stringify(r));
r = await as("authenticated", AGRO, `update public.leads set status = 'won' where site_id = '${OTHER_SITE}'`);
expect("admin Agroyauri NO modifica leads de otra web", blocked(r), JSON.stringify(r));
r = await as("authenticated", AGRO, `update public.leads set site_id = '${OTHER_SITE}' where name = 'Lead Agro'`);
expect("admin Agroyauri NO mueve un lead a otra web (manipular site_id)", !!r.error || r.affected === 0, JSON.stringify(r));
r = await as("authenticated", AGRO, `insert into public.projects (site_id, title, slug) values ('${OTHER_SITE}','Intruso','intruso')`);
expect("admin Agroyauri NO crea contenido en otra web", !!r.error, JSON.stringify(r));
r = await as("authenticated", AGRO, `update public.services set price_from = 1 where site_id = '${OTHER_SITE}'`);
expect("admin Agroyauri NO modifica precios de otra web", blocked(r), JSON.stringify(r));
r = await as("authenticated", AGRO, `insert into storage.objects (bucket_id, name) values ('projects','${OTHER_SITE}/x.webp')`);
expect("admin Agroyauri NO sube imágenes a la carpeta de otra web", !!r.error, JSON.stringify(r));
r = await as("authenticated", AGRO, `insert into storage.objects (bucket_id, name) values ('projects','sin-carpeta.webp')`);
expect("imagen sin carpeta de web rechazada", !!r.error, JSON.stringify(r));
r = await as("authenticated", AGRO, "update public.leads set status = 'contacted' where name = 'Lead Agro' returning status");
expect("admin Agroyauri cambia estado de su lead", r.rows?.[0]?.status === "contacted", JSON.stringify(r));
r = await as("authenticated", AGRO, "update public.leads set status = 'inventado'");
expect("estado inválido rechazado", !!r.error, JSON.stringify(r));
r = await as("authenticated", AGRO, `update public.leads set assigned_to = '${AGRO}' where name = 'Lead Agro' returning assigned_to`);
expect("admin Agroyauri asigna su lead", r.rows?.[0]?.assigned_to === AGRO, JSON.stringify(r));
r = await as("authenticated", AGRO, `update public.leads set assigned_to = '${OTRO}' where name = 'Lead Agro'`);
expect("NO se asigna un lead a un admin de otra web", !!r.error, JSON.stringify(r));
r = await as("authenticated", AGRO, "insert into public.lead_notes (lead_id, note) select id, 'Llamado, pide visita' from public.leads where name = 'Lead Agro' returning user_id");
expect("admin Agroyauri añade nota (autor = él mismo)", r.rows?.[0]?.user_id === AGRO, JSON.stringify(r));
r = await as("authenticated", AGRO, `insert into public.lead_notes (lead_id, note, user_id) select id, 'suplantada', '${SUPER}' from public.leads where name = 'Lead Agro'`);
expect("admin NO crea notas a nombre de otro", !!r.error, JSON.stringify(r));
const { rows: [{ id: OTHER_LEAD }] } = await db.query("select id from public.leads where name = 'Lead Otro'");
r = await as("authenticated", AGRO, `insert into public.lead_notes (lead_id, note) values ('${OTHER_LEAD}', 'intruso')`);
expect("admin Agroyauri NO añade notas a leads de otra web", !!r.error, JSON.stringify(r));
r = await as("authenticated", AGRO, "update public.services set price_type='from', price_from = 1200, price_unit='m²', show_price = true where slug='paisajismo-lima' returning price_from");
expect("admin Agroyauri modifica SOLO sus precios", r.rows?.length === 1 && Number(r.rows[0].price_from) === 1200, JSON.stringify(r));
r = await as("authenticated", AGRO, `insert into public.projects (site_id, title, slug) values ('${AGRO_SITE}','Nuevo','nuevo-proyecto') returning id`);
expect("admin Agroyauri crea proyectos", r.rows?.length === 1, JSON.stringify(r));
r = await as("authenticated", AGRO, `insert into public.projects (site_id, title, slug) values ('${AGRO_SITE}','Malo','Slug Malo')`);
expect("slug inválido rechazado", !!r.error, JSON.stringify(r));
r = await as("authenticated", AGRO, `insert into public.projects (site_id, title, slug, service_id) select '${AGRO_SITE}', 'Cruzado', 'cruzado', id from public.services where site_id = '${OTHER_SITE}'`);
expect("proyecto NO puede usar un servicio de otra web", !!r.error || r.affected === 0, JSON.stringify(r));
r = await as("authenticated", AGRO, `select count(*)::int n from public.blog_posts where site_id = '${AGRO_SITE}'`);
expect("admin Agroyauri ve borradores", r.rows?.[0]?.n === 1, JSON.stringify(r));
r = await as("authenticated", AGRO, `insert into storage.objects (bucket_id, name) values ('projects','${AGRO_SITE}/x.webp') returning id`);
expect("admin Agroyauri sube imágenes en su carpeta", r.rows?.length === 1, JSON.stringify(r));
r = await as("authenticated", AGRO, `select public.admin_lead_stats('${AGRO_SITE}', 7) s`);
let s = r.rows?.[0]?.s;
expect("admin Agroyauri obtiene métricas de su web", s?.today === 1 && s?.contacted === 1 && s?.pending === 1 && s?.daily?.length === 7, JSON.stringify(r));
r = await as("authenticated", AGRO, `select public.admin_lead_stats('${OTHER_SITE}') s`);
expect("métricas de otra web salen en cero", r.rows?.[0]?.s?.today === 0, JSON.stringify(r));
r = await as("authenticated", AGRO, "select name from public.admin_sites()");
expect("admin Agroyauri ve solo su web en el selector", names(r) === "Agroyauri SAC", JSON.stringify(r));
r = await as("authenticated", AGRO, `update public.profiles set role = 'super_admin' where id = '${AGRO}'`);
expect("admin NO se auto-promueve a super_admin", blocked(r), JSON.stringify(r));

// ---------- admin de la otra web ----------
r = await as("authenticated", OTRO, "select name from public.leads");
expect("admin de otra web NO lee leads de Agroyauri", names(r) === "Lead Otro", JSON.stringify(r));
r = await as("authenticated", OTRO, "select note from public.lead_notes");
expect("admin de otra web NO lee notas de Agroyauri", blocked(r), JSON.stringify(r));
r = await as("authenticated", OTRO, `update public.services set price_from = 5 where site_id = '${AGRO_SITE}'`);
expect("admin de otra web NO modifica precios de Agroyauri", blocked(r), JSON.stringify(r));

// ---------- super_admin (JaggerDev) ----------
r = await as("authenticated", SUPER, "select name from public.leads");
expect("super_admin lee leads de TODAS las webs", names(r) === "Lead Agro,Lead Otro", JSON.stringify(r));
r = await as("authenticated", SUPER, "select note from public.lead_notes");
expect("super_admin lee todas las notas", r.rows?.length === 1, JSON.stringify(r));
r = await as("authenticated", SUPER, "select name from public.admin_sites()");
expect("super_admin ve todas las webs en el selector", names(r) === "Agroyauri SAC,Otra Empresa", JSON.stringify(r));
r = await as("authenticated", SUPER, `insert into public.site_users (site_id, user_id) values ('${OTHER_SITE}', '${PENDING}') returning id`);
expect("super_admin asigna usuarios a webs", r.rows?.length === 1, JSON.stringify(r));
r = await as("authenticated", PENDING, "select name from public.leads");
expect("asignado pero con rol pending → sigue sin acceso", blocked(r), JSON.stringify(r));

// ---------- service role (Cloudflare Function) ----------
r = await as("service_role", null, `insert into public.leads (site_id, name, phone, email, utm_source, landing_page) values ('${AGRO_SITE}','Web','988777666','web@test.com','google','/servicios/riego-tecnificado-lima') returning utm_source`);
expect("service role inserta lead con UTM", r.rows?.[0]?.utm_source === "google", JSON.stringify(r));
r = await as("service_role", null, "insert into public.leads (name, phone, email) values ('Sin web','988777666','web@test.com')");
expect("lead sin site_id rechazado", !!r.error, JSON.stringify(r));
r = await as("service_role", null, `insert into public.leads (site_id, name, phone, email) values ('${AGRO_SITE}','X','1','no-es-email')`);
expect("lead con datos inválidos rechazado por la BD", !!r.error, JSON.stringify(r));

// ---------- borrado en cascada ----------
await db.exec("delete from public.leads where name = 'Lead Agro'");
r = await db.query("select count(*)::int n from public.lead_notes");
expect("borrar un lead borra sus notas", r.rows[0].n === 0, JSON.stringify(r.rows));

const rls = await db.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`);
expect("RLS activado en TODAS las tablas públicas", rls.rows.length === 0, JSON.stringify(rls.rows));

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas pasaron");
process.exit(failures ? 1 : 0);
