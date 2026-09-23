// Prueba E2E del panel /admin contra el emulador local (Supabase + Cloudflare).
// Requiere: scripts/local-supabase.mjs y `wrangler pages dev dist` en marcha.
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8788";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const keys = JSON.parse(readFileSync(join(tmpdir(), "agroyauri-local-keys.json"), "utf8"));
const H = { apikey: keys.service, Authorization: `Bearer ${keys.service}`, "Content-Type": "application/json" };
const api = async (path, init = {}) => (await fetch(`${keys.url}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } })).json();
const TEST_IMG = fileURLToPath(new URL("../src/assets/media/projects/riego-automatizado-la-planicie-la-molina/02.jpg", import.meta.url));

let failures = 0;
const expect = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : "  → " + detail}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Datos de prueba: 25 leads (para paginar) con distintos estados y orígenes
const svc = await api("services?select=id,slug,name&order=sort_order");
const riego = svc.find((s) => s.slug === "riego-tecnificado-lima");
const rows = Array.from({ length: 25 }, (_, i) => ({
  name: i === 0 ? "Rosa Buscable" : `Cliente ${i + 1}`,
  company: i % 3 === 0 ? "Condominio Sol" : null,
  phone: `9${String(10000000 + i).padStart(8, "0")}`,
  email: `c${i}@example.com`,
  service_id: i % 2 ? riego.id : null,
  service_label: i % 2 ? riego.name : "Plan Básico",
  district: "La Molina",
  source: i % 4 === 0 ? "facebook" : "directo",
  status: i < 5 ? "won" : "new",
}));
await fetch(`${keys.url}/rest/v1/leads`, { method: "POST", headers: H, body: JSON.stringify(rows) });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--window-size=1366,900"], defaultViewport: { width: 1366, height: 900 } });
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && consoleErrors.push(m.text()));
page.on("response", (r) => { if (r.status() >= 400 && !(r.status() === 400 && r.url().includes("grant_type=password"))) consoleErrors.push(`${r.status()} ${r.url()}`); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));
const text = (sel) => page.$eval(sel, (e) => e.textContent);
const waitText = (re, timeout = 10000) => page.waitForFunction((src) => new RegExp(src).test(document.body.innerText), { timeout }, re.source);
const toastText = async () => { await page.waitForSelector(".toast", { timeout: 10000 }); return page.$$eval(".toast", (t) => t.map((x) => x.textContent).join(" | ")); };
const clearToasts = () => page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));

async function nav(hash, selector) {
  await page.evaluate((hsh) => { document.getElementById("content")?.replaceChildren(); location.hash = hsh; }, hash);
  await page.waitForFunction((sel) => !document.querySelector(".content .loading") && document.querySelector(sel), { timeout: 15000 }, selector);
}

async function login(email, password) {
  await page.goto(`${BASE}/admin`, { waitUntil: "load" });
  await page.waitForSelector("#email");
  await page.type("#email", email);
  await page.type("#password", password);
  await page.click('.login-card button[type="submit"]');
}

// ---------- acceso ----------
await page.goto(`${BASE}/admin`, { waitUntil: "load" });
await page.waitForSelector(".login-card");
expect("visitante ve solo el login", !(await page.$(".shell")) && !!(await page.$("#email")));
const robots = await page.$eval('meta[name="robots"]', (m) => m.content);
expect("/admin es noindex", robots.includes("noindex"), robots);

await login("intruso@agroyauri.test", "intruso12345");
await waitText(/no tiene permisos/);
expect("usuario sin rol admin es rechazado", !(await page.$(".shell")));

await login("admin@agroyauri.test", "malapassword");
await waitText(/incorrectos/);
expect("contraseña incorrecta rechazada", !(await page.$(".shell")));

await login("admin@agroyauri.test", "admin12345");
await page.waitForSelector(".kpis");
expect("admin entra al dashboard", true);
const kpis = await page.$$eval(".kpi", (k) => k.map((x) => x.innerText.replace(/\s+/g, " ")));
expect("KPIs: 25 leads hoy, 5 ganados", kpis.some((k) => /^25 Leads de hoy/.test(k)) && kpis.some((k) => /^5 Clientes ganados/.test(k)), kpis.join(" | "));
expect("gráfico de leads por día", (await page.$$(".chart .bar")).length === 30);
expect("tabla de últimos leads (8)", (await page.$$(".panel tbody tr")).length === 8);

// ---------- leads ----------
await nav("#/leads", ".table tbody tr");
expect("paginación: 20 leads por página", (await page.$$(".table tbody tr")).length === 20);
expect("contador total 25", /25 leads/.test(await text(".content")));
await nav(`#/leads?status=won`, ".table tbody tr");
expect("filtro por estado (ganados = 5)", (await page.$$(".table tbody tr")).length === 5);
await nav(`#/leads?source=facebook`, ".table tbody tr");
expect("filtro por origen (facebook = 7)", (await page.$$(".table tbody tr")).length === 7);
await nav(`#/leads?service=${riego.id}`, ".table tbody tr");
expect("filtro por servicio (riego = 12)", /12 leads/.test(await text(".content")));
await nav(`#/leads?q=Rosa`, ".table tbody tr");
expect("búsqueda por nombre", (await page.$$(".table tbody tr")).length === 1);
await page.click(".table tbody tr a");
await page.waitForSelector("#lead-status");
const waHref = await page.$eval(".btn-wa", (a) => a.href);
expect("acción WhatsApp del lead", waHref.startsWith("https://wa.me/51910000000"), waHref);
expect("acciones llamar y correo", !!(await page.$('a[href^="tel:"]')) && !!(await page.$('a[href^="mailto:c0@example.com"]')));
await page.select("#lead-status", "quotation_sent");
await page.type("#lead-notes", "Se envió cotización por S/ 3,000");
await page.click(".panel .form-actions .btn-primary");
await waitText(/Lead actualizado/);
const rosa = (await api("leads?select=status,admin_notes&name=eq.Rosa%20Buscable"))[0];
expect("estado y notas guardados en la BD", rosa?.status === "quotation_sent" && /3,000/.test(rosa?.admin_notes), JSON.stringify(rosa));

// ---------- precios ----------
await page.goto(`${BASE}/admin#/prices`, { waitUntil: "load" });
await page.waitForSelector(".table tbody tr");
const firstRow = ".table tbody tr:first-child";
await page.select(`${firstRow} select`, "from");
await page.$eval(`${firstRow} input[type=number]`, (i) => (i.value = ""));
await page.type(`${firstRow} input[type=number]`, "1200");
await page.$eval(`${firstRow} input[type=text]`, (i) => (i.value = ""));
await page.type(`${firstRow} input[type=text]`, "m²");
await page.$eval(`${firstRow} input[type=checkbox]`, (c) => { if (!c.checked) c.click(); });
await clearToasts();
await page.click(`${firstRow} .btn-primary`);
expect("guardar precio de servicio", /guardado/.test(await toastText()));
const pais = (await api("services?select=price_type,price_from,price_unit,show_price&slug=eq.paisajismo-lima"))[0];
expect("precio en la BD (desde S/ 1200 / m²)", pais.price_type === "from" && Number(pais.price_from) === 1200 && pais.price_unit === "m²" && pais.show_price, JSON.stringify(pais));
// plan básico → 480
await page.$eval(".plan-edit input[type=number]", (i) => (i.value = "480"));
await clearToasts();
await page.$$eval(".panel .form-actions .btn-primary", (b) => b[b.length - 1].click());
expect("guardar planes", /Planes guardados/.test(await toastText()));
const plans = (await api("site_settings?select=value&key=eq.plans"))[0].value;
expect("plan básico = 480 en la BD", plans.items[0].price === 480, JSON.stringify(plans.items[0]));

// ---------- proyectos: crear con imágenes ----------
await page.goto(`${BASE}/admin#/projects/new`, { waitUntil: "load" });
await page.waitForSelector("#f-title");
await page.type("#f-title", "Jardín vertical de prueba");
expect("slug automático desde el título", (await page.$eval("#f-slug", (i) => i.value)) === "jardin-vertical-de-prueba");
await page.type("#f-location", "Surco");
await page.select("#f-service_id", riego.id);
await page.type("#f-short_description", "Proyecto creado desde la prueba E2E.");
const [coverInput] = await page.$$('.img-field ~ input[type=file]');
await coverInput.uploadFile(TEST_IMG);
await waitText(/Imagen subida/, 20000);
const galleryInput = await page.$('.gallery-edit ~ input[type=file]');
await galleryInput.uploadFile(TEST_IMG, TEST_IMG);
await page.waitForFunction(() => document.querySelectorAll(".g-item").length === 2, { timeout: 20000 });
await page.$eval("#f-is_published", (c) => { if (!c.checked) c.click(); });
await page.click('.form-card button[type="submit"]');
await page.waitForFunction(() => location.hash === "#/projects", { timeout: 10000 });
const nuevo = (await api("projects?select=slug,featured_image,gallery,is_published,service_id&slug=eq.jardin-vertical-de-prueba"))[0];
expect("proyecto creado con portada subida a Storage", nuevo?.featured_image?.includes("/storage/v1/object/public/projects/projects/") && nuevo.featured_image.endsWith(".webp"), JSON.stringify(nuevo));
expect("galería con 2 fotos y servicio asignado", nuevo?.gallery?.length === 2 && nuevo.service_id === riego.id && nuevo.is_published);
const img = await fetch(nuevo.featured_image);
const buf = Buffer.from(await img.arrayBuffer());
expect("imagen comprimida a WebP ≤1600px", img.ok && buf.subarray(8, 12).toString() === "WEBP" && buf.length < 1_000_000, `${img.status} ${buf.length}B`);

// despublicar / publicar desde el listado
await page.waitForSelector(".switch");
const sw = await page.$$(".switch");
await clearToasts();
await sw[0].click();
expect("interruptor publicar/despublicar", /Borrador|Publicado/.test(await toastText()));

// ---------- cambio de slug → 301 ----------
const svcRow = svc.find((s) => s.slug === "saneamiento-ambiental");
await page.goto(`${BASE}/admin#/services/${svcRow.id}`, { waitUntil: "load" });
await page.waitForSelector("#f-slug");
await page.$eval("#f-slug", (i) => (i.value = ""));
await page.type("#f-slug", "saneamiento-ambiental-lima");
await page.click('.form-card button[type="submit"]');
await page.waitForSelector("dialog[open]");
expect("advertencia SEO al cambiar el slug", /posicionamiento/.test(await text("dialog[open]")));
await page.click("dialog[open] .btn-primary");
await page.waitForFunction(() => location.hash === "#/services", { timeout: 10000 });
const redir = await api("redirects?select=from_path,to_path&from_path=eq./servicios/saneamiento-ambiental");
expect("redirección 301 creada", redir[0]?.to_path === "/servicios/saneamiento-ambiental-lima", JSON.stringify(redir));

// ---------- blog ----------
await page.goto(`${BASE}/admin#/blog/new`, { waitUntil: "load" });
await page.waitForSelector("#f-title");
await page.type("#f-title", "Cómo regar el césped en verano");
await page.type("#f-excerpt", "Consejos prácticos de riego.");
await page.type("#f-content", "## Horario\n\nRiega temprano en la mañana.\n\n- Menos evaporación\n- Césped más sano");
await page.click(".md-bar button");
await page.waitForFunction(() => /Horario/.test(document.querySelector(".md-preview")?.textContent || ""), { timeout: 10000 }).catch(() => {});
expect("vista previa de Markdown", /Horario/.test(await text(".md-preview")));
await page.$eval("#f-is_published", (c) => { if (!c.checked) c.click(); });
await page.click('.form-card button[type="submit"]');
await page.waitForFunction(() => location.hash === "#/blog", { timeout: 10000 });
const post = (await api("blog_posts?select=is_published,published_at&slug=eq.como-regar-el-cesped-en-verano"))[0];
expect("artículo publicado con fecha automática", post?.is_published && !!post.published_at, JSON.stringify(post));

// ---------- productos: borrar exige confirmación escrita ----------
const prod = (await api("products?select=id&slug=eq.arbustos-ornamentales"))[0];
await page.goto(`${BASE}/admin#/products/${prod.id}`, { waitUntil: "load" });
await page.waitForSelector(".btn-danger-ghost");
await page.click(".btn-danger-ghost");
await page.waitForSelector("dialog[open]");
expect("borrar deshabilitado hasta escribir ELIMINAR", await page.$eval("dialog[open] .btn-danger", (b) => b.disabled));
await page.click("dialog[open] .btn-ghost");
expect("cancelar no borra", (await api("products?select=id&slug=eq.arbustos-ornamentales")).length === 1);

// ---------- configuración ----------
await page.goto(`${BASE}/admin#/settings`, { waitUntil: "load" });
await page.waitForSelector('input[type="url"]');
await page.type('input[placeholder^="https://facebook"]', "https://facebook.com/agroyauri-prueba");
await clearToasts();
await page.click('.form-card button[type="submit"]');
expect("configuración guardada", /Configuración guardada/.test(await toastText()));

// ---------- publicar ----------
await page.waitForSelector(".btn-publish:not([hidden])");
expect("aviso de cambios sin publicar", /Cambios sin publicar/.test(await text(".pending-info")));
await clearToasts();
await page.click(".btn-publish");
expect("publicar dispara el build", /Publicando/.test(await toastText()));
const calls = await (await fetch(`${keys.url}/__deploy-hook/calls`)).json();
expect("deploy hook llamado 1 vez", calls.length === 1, JSON.stringify(calls));

// /api/rebuild sin sesión o sin rol
let r = await fetch(`${BASE}/api/rebuild`, { method: "POST" });
expect("rebuild sin sesión → 401", r.status === 401, r.status);
const intr = await (await fetch(`${keys.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "intruso@agroyauri.test", password: "intruso12345" }) })).json();
r = await fetch(`${BASE}/api/rebuild`, { method: "POST", headers: { Authorization: `Bearer ${intr.access_token}` } });
expect("rebuild con usuario no-admin → 403", r.status === 403, r.status);

// ---------- responsive ----------
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/admin#/leads`, { waitUntil: "load" });
await page.waitForSelector(".table tbody tr");
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
expect("panel usable en móvil (sin scroll horizontal)", !overflow);
await page.screenshot({ path: join(tmpdir(), "admin-mobile.png") });
await page.setViewport({ width: 1366, height: 900 });
await page.goto(`${BASE}/admin#/dashboard`, { waitUntil: "load" });
await page.waitForSelector(".kpis");
await page.screenshot({ path: join(tmpdir(), "admin-dashboard.png"), fullPage: true });

// cerrar sesión
await page.click(".side-foot button");
await page.waitForSelector("#email");
expect("cerrar sesión vuelve al login", true);

expect("sin errores de consola", consoleErrors.length === 0, consoleErrors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas E2E del panel pasaron");
process.exit(failures ? 1 : 0);
