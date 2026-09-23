// Utilidades de interfaz del panel. Todo el contenido dinámico se inserta como
// TEXTO (nunca innerHTML con datos): los leads los escriben visitantes anónimos.

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "value") (el as any).value = String(v);
      else if (k in el && typeof v !== "string") (el as any)[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

/** Ícono del sprite SVG (sin datos de usuario). */
export function icon(id: string, cls = "ico") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 24 24");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.appendChild(use);
  return svg;
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// ---------- toasts ----------
export function toast(msg: string, kind: "ok" | "err" | "info" = "ok", ms = 3500) {
  let box = document.getElementById("toasts");
  if (!box) {
    box = h("div", { id: "toasts", "aria-live": "polite" });
    document.body.appendChild(box);
  }
  const t = h("div", { class: `toast toast-${kind}` }, msg);
  box.appendChild(t);
  setTimeout(() => t.classList.add("out"), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// ---------- diálogo de confirmación (el visor no permite confirm()) ----------
export function confirmDialog(opts: { title: string; text: string; confirmText?: string; danger?: boolean; requireWord?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const input = opts.requireWord ? h("input", { type: "text", class: "input", placeholder: opts.requireWord, "aria-label": `Escribe ${opts.requireWord}` }) : null;
    const ok = h("button", { class: `btn ${opts.danger ? "btn-danger" : "btn-primary"}`, type: "button" }, opts.confirmText ?? "Confirmar");
    const cancel = h("button", { class: "btn btn-ghost", type: "button" }, "Cancelar");
    const dlg = h("dialog", { class: "dialog" },
      h("h2", null, opts.title),
      h("p", null, opts.text),
      input ? h("p", { class: "muted" }, "Para confirmar escribe ", h("strong", null, opts.requireWord!), ":") : null,
      input,
      h("div", { class: "dialog-actions" }, cancel, ok)
    );
    const close = (v: boolean) => { dlg.close(); dlg.remove(); resolve(v); };
    if (input) {
      ok.disabled = true;
      input.addEventListener("input", () => (ok.disabled = input.value.trim().toUpperCase() !== opts.requireWord!.toUpperCase()));
    }
    ok.addEventListener("click", () => close(true));
    cancel.addEventListener("click", () => close(false));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(false); });
    document.body.appendChild(dlg);
    dlg.showModal();
    (input ?? cancel).focus();
  });
}

// ---------- formato ----------
const dtf = new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Lima" });
const df = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", timeZone: "America/Lima" });
export const fmtDateTime = (s?: string | null) => (s ? dtf.format(new Date(s)) : "—");
export const fmtDay = (s: string) => df.format(new Date(`${s}T12:00:00-05:00`));
export const soles = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `S/ ${new Intl.NumberFormat("es-PE").format(n)}`);

export const STATUS: Record<string, string> = {
  new: "Nuevo",
  contacted: "Contactado",
  quotation_sent: "Cotización enviada",
  negotiating: "Negociando",
  won: "Ganado",
  lost: "Perdido",
};
export const statusBadge = (s: string) => h("span", { class: `badge st-${s}` }, STATUS[s] ?? s);

const SOURCES: Record<string, string> = {
  directo: "Directo",
  "google-organico": "Google orgánico",
  "bing-organico": "Bing orgánico",
  google: "Google Ads / Google",
  facebook: "Facebook",
  instagram: "Instagram",
  meta: "Meta Ads",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};
export const sourceLabel = (s?: string | null) => (!s ? "—" : SOURCES[s] ?? s.replace(/^referido:/, "Referido: "));
export const SOURCE_OPTIONS = Object.entries(SOURCES);

/** Slug limpio para URLs: "Riego Tecnificado Lima" → "riego-tecnificado-lima" */
export function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Enlace de WhatsApp a partir de un teléfono peruano. */
export function waFor(phone: string) {
  const d = phone.replace(/\D/g, "");
  const full = d.length === 9 ? `51${d}` : d;
  return `https://wa.me/${full}`;
}

export function loading(text = "Cargando…") {
  return h("div", { class: "loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), text);
}

export function errorBox(msg: string) {
  return h("div", { class: "alert alert-err", role: "alert" }, msg);
}

/** Traduce errores comunes de Supabase/PostgREST a mensajes claros. */
export function friendlyError(e: { message?: string; code?: string } | null | undefined): string {
  if (!e) return "Error desconocido.";
  const m = e.message || "";
  if (e.code === "23505" || /duplicate key/.test(m)) return "Ya existe un registro con ese slug o clave. Usa otro.";
  if (e.code === "23514" || /check constraint/.test(m)) return "Algún valor no es válido (revisa longitudes, slug o precio).";
  if (e.code === "42501" || /row-level security|permission denied/.test(m)) return "No tienes permisos para esta acción.";
  if (/JWT|expired/i.test(m)) return "Tu sesión expiró. Vuelve a iniciar sesión.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión con el servidor. Revisa tu internet.";
  return m;
}
