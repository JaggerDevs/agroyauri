// Prueba E2E del panel /admin contra el emulador local (Supabase + Cloudflare).
// Requiere: scripts/local-supabase.mjs y `wrangler pages dev dist` en marcha.
// Incluye multi-site: admin de Agroyauri, admin de otra web y super_admin.
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8788";
const CHROME = process.env.CHROME_PATH || (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "/usr/bin/google-chrome-stable");
const keys = JSON.parse(readFileSync(join(tmpdir(), "agroyauri-local-keys.json"), "utf8"));
const H = { apikey: keys.service, Authorization: `Bearer ${keys.service}`, "Content-Type": "application/json" };
const api = async (path, init = {}) => (await fetch(`${keys.url}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } })).json();
const TEST_IMG = fileURLToPath(new URL("../src/assets/media/projects/riego-automatizado-la-planicie-la-molina/02.jpg", import.meta.url));

let failures = 0;
const expect = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : "  → " + detail}`);
  if (!ok) failures++;
};

// ---------- datos de prueba ----------
const AGRO = (await api("sites?select=id&slug=eq.agroyauri"))[0].id;
const OTHER = (await api("sites?select=id&slug=eq.otra-empresa"))[0].id;
const otherLead = (await api(`leads?select=id&site_id=eq.${OTHER}`))[0];
// Se parte de cero en Agroyauri: 25 leads (para paginar) con distintos estados y orígenes.
await fetch(`${keys.url}/rest/v1/leads?site_id=eq.${AGRO}`, { method: "DELETE", headers: H });
const svc = await api(`services?select=id,slug,name&site_id=eq.${AGRO}&order=sort_order`);
const riego = svc.find((s) => s.slug === "riego-tecnificado-lima");
const rows = Array.from({ length: 25 }, (_, i) => ({
  site_id: AGRO,
  name: i === 0 ? "Rosa Buscable" : `Cliente ${i + 1}`,
  company: i % 3 === 0 ? "Condominio Sol" : null,
  phone: `9${String(10000000 + i).padStart(8, "0")}`,
  email: `c${i}@example.com`,
  service_id: i % 2 ? riego.id : null,
  service_label: i % 2 ? riego.name : "Paisajismo",
  district: "La Molina",
  source: i % 4 === 0 ? "facebook" : "website",
  status: i < 5 ? "won" : "new",
}));
await fetch(`${keys.url}/rest/v1/leads`, { method: "POST", headers: H, body: JSON.stringify(rows) });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--window-size=1366,900"], defaultViewport: { width: 1366, height: 900 } });
await browser.defaultBrowserContext().overridePermissions(BASE, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && consoleErrors.push(m.text()));
page.on("response", (r) => { if (r.status() >= 400 && !(r.status() === 400 && r.url().includes("grant_type=password"))) consoleErrors.push(`${r.status()} ${r.url()}`); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));
const text = (sel) => page.$eval(sel, (e) => e.textContent);
const waitText = (re, timeout = 10000) => page.waitForFunction((src) => new RegExp(src).test(document.body.innerText), { timeout }, re.source);
const toastText = async () => { await page.waitForSelector(".toast", { timeout: 10000 }); return page.$$eval(".toast", (t) => t.map((x) => x.textContent).join(" | ")); };
const clearToasts = () => page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
const ready = (selector) => page.waitForFunction((sel) => !document.querySelector(".content .loading") && document.querySelector(sel), { timeout: 15000 }, selector);

/** Navegación interna del panel (sin recargar), como un clic en un enlace. */
async function nav(path, selector) {
  await page.evaluate((p) => { document.getElementById("content")?.replaceChildren(); history.pushState(null, "", p); dispatchEvent(new Event("admin:navigate")); }, path);
  await ready(selector);
}

async function login(email, password) {
  await page.goto(`${BASE}/admin`, { waitUntil: "load" });
  await page.waitForSelector("#email");
  await page.type("#email", email);
  await page.type("#password", password);
  await page.click('.login-card button[type="submit"]');
}
async function logout() {
  await page.click(".side-foot button");
  await page.waitForSelector("#email");
}

// ---------- acceso ----------
await page.goto(`${BASE}/admin/leads`, { waitUntil: "load" });
await page.waitForSelector(".login-card");
expect("visitante en /admin/leads ve solo el login", !(await page.$(".shell")) && !!(await page.$("#email")));
const robots = await page.$eval('meta[name="robots"]', (m) => m.content);
expect("/admin es noindex", robots.includes("noindex"), robots);

await login("intruso@agroyauri.test", "intruso12345");
await waitText(/no tiene permisos/);
expect("usuario sin rol ni web asignada es rechazado", !(await page.$(".shell")));

await login("admin@agroyauri.test", "malapassword");
await waitText(/incorrectos/);
expect("contraseña incorrecta rechazada", !(await page.$(".shell")));

// ================= ADMIN DE AGROYAURI =================
await login("admin@agroyauri.test", "admin12345");
await page.waitForSelector(".kpis");
expect("admin entra al dashboard", true);
expect("admin de una sola web: sin selector, muestra su web", !(await page.$(".site-select")) && (await text(".site-name")) === "Agroyauri SAC");
const kpis = await page.$$eval(".kpi", (k) => k.map((x) => x.innerText.replace(/\s+/g, " ")));
const kpi = (re) => kpis.some((k) => re.test(k));
expect("KPIs: 20 nuevos, 25 hoy, 25 mes, 0 contactados, 5 convertidos, 20 pendientes",
  kpi(/^20 Leads nuevos/) && kpi(/^25 Leads de hoy/) && kpi(/^25 Leads del mes/) && kpi(/^0 Contactados/) && kpi(/^5 Convertidos/) && kpi(/^20 Pendientes/), kpis.join(" | "));
expect("gráfico de leads por día", (await page.$$(".chart .bar")).length === 30);
expect("tabla de últimos leads (8)", (await page.$$(".panel tbody tr")).length === 8);

// ---------- leads ----------
await page.click('.side-nav a[data-key="leads"]');
await ready(".filters ~ .table-wrap tbody tr");
expect("menú lleva a la ruta real /admin/leads", new URL(page.url()).pathname === "/admin/leads", page.url());
expect("paginación: 20 leads por página", (await page.$$(".table tbody tr")).length === 20);
expect("contador total 25 (no incluye leads de otra web)", /25 leads/.test(await text(".content")));
const headers = await page.$$eval(".table thead th", (t) => t.map((x) => x.textContent));
expect("columnas: nombre, teléfono, correo, fecha, origen, estado", ["Nombre", "Teléfono", "Correo", "Fecha", "Origen", "Estado"].every((c) => headers.includes(c)), headers.join(","));
await page.click(".pager button:last-child");
await page.waitForFunction(() => /Página 2/.test(document.querySelector(".pager")?.textContent || ""), { timeout: 10000 });
expect("página 2 con 5 leads", (await page.$$(".table tbody tr")).length === 5 && /page=2/.test(page.url()));
await nav(`/admin/leads?status=won`, ".table tbody tr");
expect("filtro por estado (ganados = 5)", (await page.$$(".table tbody tr")).length === 5);
await nav(`/admin/leads?status=open`, ".table tbody tr");
expect("filtro pendientes (20)", /20 leads/.test(await text(".content")));
await nav(`/admin/leads?source=facebook`, ".table tbody tr");
expect("filtro por origen (facebook = 7)", (await page.$$(".table tbody tr")).length === 7);
await nav(`/admin/leads?service=${riego.id}`, ".table tbody tr");
expect("filtro por servicio (riego = 12)", /12 leads/.test(await text(".content")));
await nav(`/admin/leads?from=today`, ".table tbody tr");
expect("filtro por fecha (hoy = 25)", /25 leads/.test(await text(".content")));
await nav(`/admin/leads?q=Rosa`, ".table tbody tr");
expect("búsqueda por nombre", (await page.$$(".table tbody tr")).length === 1);
await nav(`/admin/leads?q=910000003`, ".table tbody tr");
expect("búsqueda por teléfono", (await page.$$(".table tbody tr")).length === 1);
await nav(`/admin/leads?q=Otra`, ".content .empty");
expect("búsqueda NO encuentra leads de otra web", /No hay leads/.test(await text(".content")));

// ---------- detalle ----------
await nav(`/admin/leads?q=Rosa`, ".table tbody tr");
await page.click(".table tbody tr a");
await page.waitForSelector("#lead-status");
const detail = await text(".content");
expect("detalle: datos, fuente y UTM", /Rosa Buscable/.test(detail) && /Condominio Sol/.test(detail) && /Fuente/.test(detail), detail.slice(0, 200));
const waHref = await page.$eval(".btn-wa", (a) => a.href);
expect("Abrir WhatsApp usa el teléfono del lead", waHref.startsWith("https://wa.me/51910000000"), waHref);
expect("acciones llamar y correo", !!(await page.$('a[href^="tel:"]')) && !!(await page.$('a[href^="mailto:c0@example.com"]')));
await clearToasts();
await page.evaluate(() => [...document.querySelectorAll(".actions-bar button")].find((b) => b.textContent === "Copiar teléfono").click());
expect("copiar teléfono", /copiado/.test(await toastText()));
expect("teléfono en el portapapeles", (await page.evaluate(() => navigator.clipboard.readText())) === "910000000");
await clearToasts();
await page.evaluate(() => [...document.querySelectorAll(".actions-bar button")].find((b) => b.textContent === "Marcar como contactado").click());
expect("marcar como contactado", /contactado/.test(await toastText()));
expect("contactado en la BD", (await api("leads?select=status&name=eq.Rosa%20Buscable"))[0]?.status === "contacted");
await clearToasts();
await page.select("#lead-status", "quoted");
expect("cambiar estado (Cotizado)", /Cotizado/.test(await toastText()));
await clearToasts();
await page.select("#lead-assigned", "11111111-1111-1111-1111-111111111111");
expect("asignar lead", /asignado/.test(await toastText()));
await page.type("#lead-note", "Se envió cotización por S/ 3,000");
await clearToasts();
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Añadir nota").click());
expect("añadir nota", /Nota añadida/.test(await toastText()));
expect("nota visible con autor", /Administrador Agroyauri/.test(await text(".notes")));
const rosa = (await api("leads?select=id,status,assigned_to,lead_notes(note,user_id)&name=eq.Rosa%20Buscable"))[0];
expect("estado, asignación y nota guardados en la BD",
  rosa?.status === "quoted" && rosa.assigned_to === "11111111-1111-1111-1111-111111111111" && rosa.lead_notes?.[0]?.note?.includes("3,000"), JSON.stringify(rosa));
await clearToasts();
await page.evaluate(() => [...document.querySelectorAll(".actions-bar button")].find((b) => b.textContent === "Cerrar: ganado").click());
expect("cerrar como ganado", /ganado/.test(await toastText()));

// Abrir directamente un lead de OTRA web por su URL
await page.goto(`${BASE}/admin/leads/${otherLead.id}`, { waitUntil: "load" });
await waitText(/no existe o no pertenece/);
expect("URL directa a un lead de otra web: no se muestra", true);

// ---------- precios ----------
await page.goto(`${BASE}/admin/prices`, { waitUntil: "load" });
await page.waitForSelector(".table tbody tr");
expect("sin editor de planes (ya no existen en la web)", !(await page.$(".plan-edit")));
const firstRow = ".table tbody tr:first-child";
await page.select(`${firstRow} select`, "from");
await page.$eval(`${firstRow} input[type=number]`, (i) => (i.value = ""));
await page.type(`${firstRow} input[type=number]`, "1200");
await page.$eval(`${firstRow} input[type=text]`, (i) => (i.value = ""));
await page.type(`${firstRow} input[type=text]`, "m²");
await clearToasts();
await page.click(`${firstRow} .btn-primary`);
expect("guardar precio de servicio (sin mostrar)", /guardado/.test(await toastText()));
const pais = (await api(`services?select=price_type,price_from,price_unit,show_price&site_id=eq.${AGRO}&slug=eq.paisajismo-lima`))[0];
expect("precio en la BD y show_price sigue en false", pais.price_type === "from" && Number(pais.price_from) === 1200 && pais.price_unit === "m²" && !pais.show_price, JSON.stringify(pais));

// ---------- proyectos: crear con imágenes ----------
await page.goto(`${BASE}/admin/projects/new`, { waitUntil: "load" });
await page.waitForSelector("#f-title");
await page.type("#f-title", "Jardín vertical de prueba");
expect("slug automático desde el título", (await page.$eval("#f-slug", (i) => i.value)) === "jardin-vertical-de-prueba");
await page.type("#f-location", "Surco");
const svcOptions = await page.$$eval("#f-service_id option", (o) => o.map((x) => x.textContent));
expect("selector de servicio solo con servicios de esta web", !svcOptions.includes("Servicio ajeno") && svcOptions.length === svc.length + 1, svcOptions.join(","));
await page.select("#f-service_id", riego.id);
await page.type("#f-short_description", "Proyecto creado desde la prueba E2E.");
const [coverInput] = await page.$$(".img-field ~ input[type=file]");
await coverInput.uploadFile(TEST_IMG);
await waitText(/Imagen subida/, 20000);
const galleryInput = await page.$(".gallery-edit ~ input[type=file]");
await galleryInput.uploadFile(TEST_IMG, TEST_IMG);
await page.waitForFunction(() => document.querySelectorAll(".g-item").length === 2, { timeout: 20000 });
await page.$eval("#f-is_published", (c) => { if (!c.checked) c.click(); });
await page.click('.form-card button[type="submit"]');
await page.waitForFunction(() => location.pathname === "/admin/projects", { timeout: 10000 });
const nuevo = (await api("projects?select=site_id,slug,featured_image,gallery,is_published,service_id&slug=eq.jardin-vertical-de-prueba"))[0];
expect("proyecto creado en la web actual", nuevo?.site_id === AGRO, JSON.stringify(nuevo));
expect("portada subida a la carpeta de la web en Storage", nuevo?.featured_image?.includes(`/storage/v1/object/public/projects/${AGRO}/projects/`) && nuevo.featured_image.endsWith(".webp"), nuevo?.featured_image);
expect("galería con 2 fotos y servicio asignado", nuevo?.gallery?.length === 2 && nuevo.service_id === riego.id && nuevo.is_published);
const img = await fetch(nuevo.featured_image);
const buf = Buffer.from(await img.arrayBuffer());
expect("imagen comprimida a WebP ≤1600px", img.ok && buf.subarray(8, 12).toString() === "WEBP" && buf.length < 1_000_000, `${img.status} ${buf.length}B`);

await page.waitForSelector(".switch");
const sw = await page.$$(".switch");
await clearToasts();
await sw[0].click();
expect("interruptor publicar/despublicar", /Borrador|Publicado/.test(await toastText()));

// ---------- cambio de slug → 301 ----------
const svcRow = svc.find((s) => s.slug === "saneamiento-ambiental");
await page.goto(`${BASE}/admin/services/${svcRow.id}`, { waitUntil: "load" });
await page.waitForSelector("#f-slug");
await page.$eval("#f-slug", (i) => (i.value = ""));
await page.type("#f-slug", "saneamiento-ambiental-lima");
await page.click('.form-card button[type="submit"]');
await page.waitForSelector("dialog[open]");
expect("advertencia SEO al cambiar el slug", /posicionamiento/.test(await text("dialog[open]")));
await page.click("dialog[open] .btn-primary");
await page.waitForFunction(() => location.pathname === "/admin/services", { timeout: 10000 });
const redir = await api(`redirects?select=site_id,from_path,to_path&from_path=eq./servicios/saneamiento-ambiental`);
expect("redirección 301 creada en esta web", redir[0]?.to_path === "/servicios/saneamiento-ambiental-lima" && redir[0]?.site_id === AGRO, JSON.stringify(redir));

// ---------- blog ----------
await page.goto(`${BASE}/admin/blog/new`, { waitUntil: "load" });
await page.waitForSelector("#f-title");
await page.type("#f-title", "Cómo regar el césped en verano");
await page.type("#f-excerpt", "Consejos prácticos de riego.");
await page.type("#f-content", "## Horario\n\nRiega temprano en la mañana.\n\n- Menos evaporación\n- Césped más sano");
await page.click(".md-bar button");
await page.waitForFunction(() => /Horario/.test(document.querySelector(".md-preview")?.textContent || ""), { timeout: 10000 }).catch(() => {});
expect("vista previa de Markdown", /Horario/.test(await text(".md-preview")));
await page.$eval("#f-is_published", (c) => { if (!c.checked) c.click(); });
await page.click('.form-card button[type="submit"]');
await page.waitForFunction(() => location.pathname === "/admin/blog", { timeout: 10000 });
const post = (await api("blog_posts?select=site_id,is_published,published_at&slug=eq.como-regar-el-cesped-en-verano"))[0];
expect("artículo publicado con fecha automática", post?.is_published && !!post.published_at && post.site_id === AGRO, JSON.stringify(post));

// ---------- productos: borrar exige confirmación escrita ----------
const prod = (await api(`products?select=id&site_id=eq.${AGRO}&slug=eq.arbustos-ornamentales`))[0];
await page.goto(`${BASE}/admin/products/${prod.id}`, { waitUntil: "load" });
await page.waitForSelector(".btn-danger-ghost");
await page.click(".btn-danger-ghost");
await page.waitForSelector("dialog[open]");
expect("borrar deshabilitado hasta escribir ELIMINAR", await page.$eval("dialog[open] .btn-danger", (b) => b.disabled));
await page.click("dialog[open] .btn-ghost");
expect("cancelar no borra", (await api("products?select=id&slug=eq.arbustos-ornamentales")).length === 1);

// ---------- configuración ----------
await page.goto(`${BASE}/admin/settings`, { waitUntil: "load" });
await page.waitForSelector('input[type="url"]');
await page.$eval('input[placeholder^="https://facebook"]', (el) => (el.value = ""));
await page.type('input[placeholder^="https://facebook"]', "https://facebook.com/agroyauri-prueba");
await clearToasts();
await page.click('.form-card button[type="submit"]');
expect("configuración guardada", /Configuración guardada/.test(await toastText()));
const social = (await api(`site_settings?select=value&site_id=eq.${AGRO}&key=eq.social`))[0]?.value;
expect("configuración guardada en esta web", social?.facebook === "https://facebook.com/agroyauri-prueba", JSON.stringify(social));

// ---------- publicar ----------
await page.waitForSelector(".btn-publish:not([hidden])");
expect("aviso de cambios sin publicar", /Cambios sin publicar/.test(await text(".pending-info")));
await clearToasts();
await page.click(".btn-publish");
expect("publicar dispara el build", /Publicando/.test(await toastText()));
const calls = await (await fetch(`${keys.url}/__deploy-hook/calls`)).json();
expect("deploy hook llamado 1 vez", calls.length === 1, JSON.stringify(calls));

// ---------- responsive ----------
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/admin/leads`, { waitUntil: "load" });
await page.waitForSelector(".table tbody tr");
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
expect("panel usable en móvil (sin scroll horizontal)", !overflow);
await page.screenshot({ path: join(tmpdir(), "admin-mobile.png") });
await page.goto(`${BASE}/admin/leads?q=Rosa`, { waitUntil: "load" });
await page.waitForSelector(".table tbody tr a");
await page.click(".table tbody tr a");
await page.waitForSelector("#lead-status");
expect("detalle del lead usable en móvil", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
await page.screenshot({ path: join(tmpdir(), "admin-lead-mobile.png"), fullPage: true });
await page.setViewport({ width: 1366, height: 900 });
await page.goto(`${BASE}/admin/dashboard`, { waitUntil: "load" });
await page.waitForSelector(".kpis");
await page.screenshot({ path: join(tmpdir(), "admin-dashboard.png"), fullPage: true });
await logout();
expect("cerrar sesión vuelve al login", true);

// ================= ADMIN DE OTRA WEB =================
await login("otro@otra-empresa.test", "otro12345");
await page.waitForSelector(".kpis");
expect("admin de otra web ve su web", (await text(".site-name")) === "Otra Empresa");
await nav("/admin/leads", ".table tbody tr");
const otherNames = await page.$$eval(".table tbody tr td:first-child", (t) => t.map((x) => x.textContent));
expect("admin de otra web NO ve leads de Agroyauri", otherNames.length === 1 && otherNames[0] === "Lead de Otra Empresa", otherNames.join(","));
expect("admin de otra web no puede publicar Agroyauri (botón oculto)", await page.$eval(".btn-publish", (b) => b.hidden));
await logout();

// ================= SUPER_ADMIN (JaggerDev) =================
await login("super@jaggerdev.test", "super12345");
await page.waitForSelector(".kpis");
const siteOpts = await page.$$eval(".site-select option", (o) => o.map((x) => x.textContent));
expect("super_admin ve el selector con todas las webs", siteOpts.includes("Agroyauri SAC") && siteOpts.includes("Otra Empresa"), siteOpts.join(","));
await nav("/admin/leads", ".table tbody tr");
expect("super_admin ve leads de Agroyauri", /\d+ leads/.test(await text(".content")) && !/Lead de Otra Empresa/.test(await text(".content")));
await page.select(".site-select", OTHER);
await page.waitForFunction(() => /Lead de Otra Empresa/.test(document.querySelector(".content")?.innerText || ""), { timeout: 10000 });
expect("super_admin cambia a la otra web y ve sus leads", (await page.$$(".table tbody tr")).length === 1);
await page.select(".site-select", AGRO);
await ready(".table tbody tr");
await logout();

// ---------- /api/rebuild ----------
const tokenOf = async (email, password) => (await (await fetch(`${keys.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json()).access_token;
let r = await fetch(`${BASE}/api/rebuild`, { method: "POST" });
expect("rebuild sin sesión → 401", r.status === 401, r.status);
r = await fetch(`${BASE}/api/rebuild`, { method: "POST", headers: { Authorization: `Bearer ${await tokenOf("intruso@agroyauri.test", "intruso12345")}` } });
expect("rebuild con usuario sin permisos → 403", r.status === 403, r.status);
r = await fetch(`${BASE}/api/rebuild`, { method: "POST", headers: { Authorization: `Bearer ${await tokenOf("otro@otra-empresa.test", "otro12345")}` } });
expect("rebuild con admin de OTRA web → 403", r.status === 403, r.status);
r = await fetch(`${BASE}/api/rebuild`, { method: "POST", headers: { Authorization: `Bearer ${await tokenOf("super@jaggerdev.test", "super12345")}` } });
expect("rebuild con super_admin → 202", r.status === 202, r.status);

expect("sin errores de consola", consoleErrors.length === 0, consoleErrors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas E2E del panel pasaron");
process.exit(failures ? 1 : 0);
