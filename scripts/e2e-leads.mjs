// Prueba E2E de captación de leads contra el emulador local.
// Requiere: scripts/local-supabase.mjs y `wrangler pages dev dist` en marcha.
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8788";
const CHROME = process.env.CHROME_PATH || (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "/usr/bin/google-chrome-stable");
const keys = JSON.parse(readFileSync(join(tmpdir(), "agroyauri-local-keys.json"), "utf8"));
const svcHeaders = { apikey: keys.service, Authorization: `Bearer ${keys.service}` };

let failures = 0;
const expect = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : "  → " + detail}`);
  if (!ok) failures++;
};
const siteOf = async (slug) => (await (await fetch(`${keys.url}/rest/v1/sites?select=id&slug=eq.${slug}`, { headers: svcHeaders })).json())[0]?.id;
const AGRO_SITE = await siteOf("agroyauri");
const OTHER_SITE = await siteOf("otra-empresa");
const leads = async () => (await fetch(`${keys.url}/rest/v1/leads?select=*&order=created_at.desc`, { headers: svcHeaders })).json();
const before = (await leads()).length;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

// 1) Llega desde una campaña a una página de servicio
await page.goto(`${BASE}/servicios/riego-tecnificado-lima?utm_source=google&utm_medium=cpc&utm_campaign=riego-lima&utm_term=riego+tecnificado`, { waitUntil: "load" });
const selected = await page.$eval('form.lead-form select[name="service"]', (s) => s.selectedOptions[0]?.textContent);
expect("servicio preseleccionado en el formulario", selected === "Sistemas de riego tecnificado", selected);
const waHref = await page.$eval(".wa-float", (a) => decodeURIComponent(a.href));
expect("WhatsApp flotante conoce el servicio", waHref.includes("cotización para Sistemas de riego tecnificado"), waHref);

// 2) Navega a otra página antes de enviar (la atribución debe conservar la página de entrada)
await page.goto(`${BASE}/contacto`, { waitUntil: "load" });

// 3) Envío vacío → validación en el navegador
await page.click('form.lead-form button[type="submit"]');
const errMsg = await page.$eval("form.lead-form .form-status", (e) => e.textContent);
expect("validación del lado del cliente", /campos obligatorios/.test(errMsg), errMsg);

// 4) Envío correcto (formulario corto: nombre, teléfono, servicio y mensaje opcional)
const formFields = await page.$$eval("form.lead-form .form-grid :is(input, select, textarea)", (els) => els.map((e) => e.name).join(","));
expect("formulario corto: nombre, teléfono, servicio, mensaje", formFields === "name,phone,service,message", formFields);
await page.type('input[name="name"]', "Cliente E2E");
await page.type('input[name="phone"]', "987 654 321");
await page.select('select[name="service"]', await page.$eval('select[name="service"] option:nth-child(4)', (o) => o.value));
await page.type('textarea[name="message"]', "Necesitamos riego para 350 m².");
await new Promise((r) => setTimeout(r, 2600)); // un humano tarda más que el umbral antispam
await page.click('form.lead-form button[type="submit"]');
await page.waitForFunction(() => /Gracias|No pudimos|Revisa/.test(document.querySelector("form.lead-form .form-status")?.textContent || ""), { timeout: 15000 });
const okMsg = await page.$eval("form.lead-form .form-status", (e) => e.textContent);
expect("mensaje de éxito tras enviar", /Gracias/.test(okMsg), okMsg);

const all = await leads();
const lead = all[0];
expect("se creó exactamente 1 lead", all.length === before + 1, `${before} → ${all.length}`);
expect("lead: datos guardados", lead?.name === "Cliente E2E" && lead?.phone === "987 654 321" && lead?.email === null && /350/.test(lead?.message ?? ""), JSON.stringify(lead));
expect("lead: servicio (service_id + etiqueta)", !!lead?.service_id && !!lead?.service_label, `${lead?.service_id} ${lead?.service_label}`);
expect("lead: UTM guardados", lead?.utm_source === "google" && lead?.utm_medium === "cpc" && lead?.utm_campaign === "riego-lima" && lead?.utm_term === "riego tecnificado", JSON.stringify(lead));
expect("lead: landing_page = página de entrada", lead?.landing_page === "/servicios/riego-tecnificado-lima", lead?.landing_page);
expect("lead: origen = google_ads (utm google + cpc)", lead?.source === "google_ads", lead?.source);
expect("lead: pertenece a Agroyauri (site_id del servidor)", lead?.site_id === AGRO_SITE, lead?.site_id);
expect("lead: estado inicial 'new'", lead?.status === "new", lead?.status);

// 5) Multi-site y origen: el navegador NO decide el site_id
const post0 = (body) => fetch(`${BASE}/api/lead`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(body) });
const base = { name: "Intento", phone: "955111222", district: "Lima", service_label: "Paisajismo", elapsed_ms: 8000 };
let r0 = await post0({ ...base, phone: "955111201", email: "intruso.site@example.com", site_id: OTHER_SITE });
const forced = (await leads()).find((l) => l.email === "intruso.site@example.com");
expect("site_id enviado desde DevTools se ignora (queda en Agroyauri)", r0.status === 201 && forced?.site_id === AGRO_SITE, `${r0.status} ${forced?.site_id}`);
expect("sin UTM ni referrer → origen website", forced?.source === "website", forced?.source);
await post0({ ...base, phone: "955111202", email: "via.whatsapp@example.com", channel: "whatsapp" });
expect("botón WhatsApp → origen whatsapp", (await leads()).find((l) => l.email === "via.whatsapp@example.com")?.source === "whatsapp");
await post0({ ...base, phone: "955111203", email: "desde.google@example.com", referrer: "https://www.google.com/" });
expect("llegó desde Google orgánico → origen google", (await leads()).find((l) => l.email === "desde.google@example.com")?.source === "google");
await post0({ ...base, phone: "955111204", email: "meta.ads@example.com", utm_source: "facebook", utm_medium: "paid_social" });
expect("utm facebook + paid_social → origen meta_ads", (await leads()).find((l) => l.email === "meta.ads@example.com")?.source === "meta_ads");
const afterExtra = (await leads()).length;

// 6) Validación y protección del lado del servidor
const post = (body, headers = {}) =>
  fetch(`${BASE}/api/lead`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, ...headers }, body: JSON.stringify(body) });
const valid = { name: "Otro", phone: "912345678", email: "otro@example.com", district: "Lima", service_label: "Paisajismo", elapsed_ms: 8000 };
let r = await post({ ...valid, email: "no-es-correo" });
expect("servidor rechaza correo inválido (422)", r.status === 422, r.status);
r = await post({ ...valid, website: "http://spam" });
expect("honeypot: responde 200 pero NO guarda", r.status === 200 && (await leads()).length === afterExtra, r.status);
r = await post({ ...valid, elapsed_ms: 300 });
expect("envío instantáneo (bot): NO guarda", r.status === 200 && (await leads()).length === afterExtra, r.status);
r = await post(valid, { Origin: "https://sitio-malicioso.com" });
expect("otro origen rechazado (403)", r.status === 403, r.status);
r = await fetch(`${BASE}/api/lead`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" });
expect("formato no JSON rechazado (415)", r.status === 415, r.status);
const short = { name: "Sin correo", phone: "977000111", service_label: "Paisajismo", elapsed_ms: 8000 };
r = await post(short);
expect("sin correo ni distrito se acepta (201)", r.status === 201, r.status);
await post(short); await post(short);
r = await post(short);
expect("límite de repetición por teléfono sin correo (429)", r.status === 429, r.status);
for (let i = 0; i < 3; i++) await post({ ...valid, email: "repetido@example.com" });
r = await post({ ...valid, email: "repetido@example.com" });
expect("límite de repetición por correo (429)", r.status === 429, r.status);

expect("sin errores de consola", consoleErrors.length === 0, consoleErrors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas E2E de leads pasaron");
process.exit(failures ? 1 : 0);
