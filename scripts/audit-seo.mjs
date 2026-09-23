// Auditoría SEO del sitio generado (dist/). Uso: npm run build && node scripts/audit-seo.mjs
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== "_astro") walk(p); }
    else if (f.endsWith(".html")) files.push(p);
  }
})(DIST);

const redirects = existsSync(join(DIST, "_redirects"))
  ? readFileSync(join(DIST, "_redirects"), "utf8").split("\n").filter((l) => l.startsWith("/")).map((l) => l.split(/\s+/)[0])
  : [];
const routeExists = (path) => {
  const p = decodeURIComponent(path.split("#")[0].split("?")[0]);
  if (p === "/" ) return true;
  if (redirects.includes(p)) return true;
  const clean = p.replace(/\/$/, "");
  return [`${clean}.html`, `${clean}/index.html`, clean].some((c) => existsSync(join(DIST, c)) && statSync(join(DIST, c)).isFile());
};

const problems = [];
const warn = (file, msg) => problems.push(`${file}: ${msg}`);
const titles = new Map();
const descs = new Map();
let pages = 0;

for (const file of files) {
  const rel = "/" + relative(DIST, file).replace(/\\/g, "/");
  const html = readFileSync(file, "utf8");
  if (rel === "/admin.html") continue;
  pages++;
  const noindex = /<meta name="robots" content="noindex/.test(html);
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
  const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
  const h1s = (html.match(/<h1[\s>]/g) || []).length;

  if (!title) warn(rel, "sin <title>");
  else if (title.length > 70) warn(rel, `title largo (${title.length}): ${title}`);
  if (!desc) warn(rel, "sin meta description");
  else if (!noindex && (desc.length < 50 || desc.length > 170)) warn(rel, `description de ${desc.length} caracteres`);
  if (!canonical) warn(rel, "sin canonical");
  else if (/\.html|\/index$/.test(canonical)) warn(rel, `canonical sucio: ${canonical}`);
  if (h1s !== 1) warn(rel, `${h1s} H1 (debe ser 1)`);
  for (const p of ["og:title", "og:description", "og:image", "og:url"]) if (!html.includes(`property="${p}"`)) warn(rel, `sin ${p}`);
  if (!html.includes('lang="es-PE"')) warn(rel, "sin lang");

  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { const d = JSON.parse(m[1]); if (!d["@context"] || !d["@type"]) warn(rel, "JSON-LD sin @context/@type"); } catch { warn(rel, "JSON-LD inválido"); }
  }
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt(=|\s|>)/.test(m[0])) warn(rel, `imagen sin alt: ${m[0].slice(0, 80)}`);
    if (!/\swidth=/.test(m[0]) || !/\sheight=/.test(m[0])) warn(rel, `imagen sin width/height (CLS): ${m[0].slice(0, 80)}`);
  }
  for (const m of html.matchAll(/href="(\/[^"]*)"/g)) {
    const href = m[1];
    if (href.startsWith("/_astro/") || href.startsWith("/fonts/") || href === "/favicon.png") continue;
    if (!routeExists(href)) warn(rel, `enlace interno roto: ${href}`);
  }
  if (!noindex) {
    if (titles.has(title)) warn(rel, `title duplicado con ${titles.get(title)}`);
    titles.set(title, rel);
    if (descs.has(desc)) warn(rel, `description duplicada con ${descs.get(desc)}`);
    descs.set(desc, rel);
  }
}

// sitemap y robots
const sitemap = readFileSync(join(DIST, "sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
for (const l of locs) if (!routeExists(l)) problems.push(`sitemap: URL sin página ${l}`);
if (locs.some((l) => l.startsWith("/admin"))) problems.push("sitemap incluye /admin");
const robots = readFileSync(join(DIST, "robots.txt"), "utf8");
if (!/Disallow: \/admin/.test(robots) || !/Sitemap: /.test(robots)) problems.push("robots.txt incompleto");

console.log(`Páginas auditadas: ${pages} · URLs en sitemap: ${locs.length}`);
if (problems.length) {
  console.log(`\n${problems.length} observación(es):`);
  for (const p of problems) console.log(" - " + p);
  process.exit(1);
}
console.log("✓ SEO técnico sin observaciones (title/description únicos, canonical, 1 H1, OG, JSON-LD, alt, width/height, enlaces, sitemap, robots)");
