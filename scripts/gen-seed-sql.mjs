// Genera supabase/seed.sql a partir de src/data/seed.json
// Uso: npm run seed:sql
import { readFileSync, writeFileSync } from "node:fs";
import { expandSeed } from "../src/lib/seed-expand.mjs";

const raw = JSON.parse(readFileSync(new URL("../src/data/seed.json", import.meta.url), "utf8"));
const seed = expandSeed(raw);

const q = (v) => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return `array[${v.map(q).join(", ")}]::text[]`;
  if (typeof v === "object") return `${q(JSON.stringify(v))}::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

// Web a la que pertenece este contenido (multi-site). Ver tabla public.sites.
const SITE = { slug: "agroyauri", name: "Agroyauri SAC" };
const site = `(select id from public.sites where slug = ${q(SITE.slug)})`;

const out = [
  "-- Generado por scripts/gen-seed-sql.mjs desde src/data/seed.json — NO editar a mano.",
  "-- Idempotente: se puede ejecutar varias veces (on conflict do nothing).",
  "begin;",
  "",
  `insert into public.sites (name, slug) values (${q(SITE.name)}, ${q(SITE.slug)}) on conflict (slug) do nothing;`,
  "",
];

for (const [key, value] of Object.entries(seed.site_settings)) {
  out.push(`insert into public.site_settings (site_id, key, value) values (${site}, ${q(key)}, ${q(value)}) on conflict (site_id, key) do nothing;`);
}
out.push("");

for (const c of seed.categories) {
  out.push(`insert into public.categories (site_id, name, slug, sort_order) values (${site}, ${q(c.name)}, ${q(c.slug)}, ${q(c.sort_order)}) on conflict (site_id, slug) do nothing;`);
}
out.push("");

const svcCols = ["name", "slug", "short_description", "description", "image_url", "icon", "price_type", "price_from", "price_unit", "show_price", "show_in_home", "sort_order", "is_active", "seo_title", "seo_description"];
for (const s of seed.services) {
  out.push(`insert into public.services (site_id, ${svcCols.join(", ")}) values (${site}, ${svcCols.map((c) => q(s[c])).join(", ")}) on conflict (site_id, slug) do nothing;`);
}
out.push("");

const prjCols = ["title", "slug", "client", "location", "short_description", "description", "featured_image", "gallery", "before_image", "after_image", "is_featured", "is_published", "sort_order", "seo_title", "seo_description"];
for (const p of seed.projects) {
  out.push(
    `insert into public.projects (site_id, ${prjCols.join(", ")}, service_id) values (${site}, ${prjCols.map((c) => q(p[c])).join(", ")}, ` +
      `(select id from public.services where site_id = ${site} and slug = ${q(p.service_slug)})) on conflict (site_id, slug) do nothing;`
  );
}
out.push("");

const prdCols = ["name", "slug", "description", "image_url", "price", "price_unit", "show_price", "available", "featured", "is_published", "sort_order", "seo_title", "seo_description"];
for (const p of seed.products) {
  out.push(
    `insert into public.products (site_id, ${prdCols.join(", ")}, category_id) values (${site}, ${prdCols.map((c) => q(p[c])).join(", ")}, ` +
      `(select id from public.categories where site_id = ${site} and slug = ${q(p.category_slug)})) on conflict (site_id, slug) do nothing;`
  );
}
out.push("");

const blogCols = ["title", "slug", "excerpt", "content", "featured_image", "author", "published_at", "is_published", "seo_title", "seo_description"];
for (const b of seed.blog_posts) {
  out.push(`insert into public.blog_posts (site_id, ${blogCols.join(", ")}) values (${site}, ${blogCols.map((c) => q(b[c])).join(", ")}) on conflict (site_id, slug) do nothing;`);
}
out.push("");

// Redirecciones 301 de URLs alternativas previstas
for (const r of seed.redirects) {
  out.push(`insert into public.redirects (site_id, from_path, to_path) values (${site}, ${q(r.from_path)}, ${q(r.to_path)}) on conflict (site_id, from_path) do nothing;`);
}

out.push("", "commit;", "");
writeFileSync(new URL("../supabase/seed.sql", import.meta.url), out.join("\n"));
console.log("supabase/seed.sql generado");
