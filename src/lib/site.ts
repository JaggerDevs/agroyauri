// Utilidades compartidas por las páginas públicas.
import type { Service, Settings, Project } from "./data";
import { marked } from "marked";

export const SITE_NAME = "AGROYAURI SAC";

const soles = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 });
export const formatSoles = (n: number) => `S/ ${soles.format(n)}`;

/** Texto de precio de un servicio o null si no debe mostrarse. */
export function servicePrice(s: Pick<Service, "price_type" | "price_from" | "price_unit" | "show_price">): string | null {
  if (!s.show_price || s.price_type === "quote" || s.price_from === null) return null;
  const base = formatSoles(s.price_from);
  if (s.price_type === "from") return `Desde ${base}${s.price_unit ? ` / ${s.price_unit}` : ""}`;
  if (s.price_type === "per_m2") return `${base} por m²`;
  return `${base}${s.price_unit ? ` / ${s.price_unit}` : ""}`;
}

/** Enlace de WhatsApp con mensaje prellenado (no incluye datos personales). */
export function waLink(settings: Settings, text?: string): string {
  const base = `https://wa.me/${settings.contact.whatsapp}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

export const waServiceText = (name: string) => `Hola Agroyauri, quisiera solicitar una cotización para ${name}.`;
export const waProductText = (name: string) => `Hola Agroyauri, quisiera consultar por el producto: ${name}.`;
export const waGeneralText = "Hola AGROYAURI SAC, quisiera información sobre sus servicios.";

/** "Cliente – Ubicación" o, si no hay datos reales, el nombre del servicio. */
export function projectSubtitle(p: Project, services: Service[]): string {
  const parts = [p.client, p.location].filter(Boolean);
  if (parts.length) return parts.join(" – ");
  return services.find((s) => s.id === p.service_id)?.name ?? "";
}

marked.setOptions({ gfm: true, breaks: false });
/** Markdown del CMS → HTML (en el build; el contenido lo escriben solo administradores). */
export function md(src: string | null | undefined): string {
  if (!src) return "";
  // Se escapan etiquetas HTML crudas: el panel escribe Markdown, no HTML.
  return marked.parse(src.replace(/</g, "&lt;"), { async: false }) as string;
}

export const telHref = (phone: string) => `tel:+51${phone.replace(/\D/g, "")}`;

export const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");

/** Título SEO ≤ 70 caracteres: agrega la marca si cabe; si no, recorta sin cortar palabras. */
export function seoTitle(base: string, max = 70): string {
  for (const suffix of [" | AGROYAURI SAC", " | Agroyauri"]) if ((base + suffix).length <= max) return base + suffix;
  const cut = base.slice(0, max - 13).replace(/\s+\S*$/, "");
  return `${cut} | Agroyauri`;
}

/** Descripción SEO de 50–160 caracteres a partir de los textos disponibles. */
export function seoDescription(parts: (string | null | undefined)[], max = 160): string {
  let out = "";
  for (const p of parts) {
    if (!p) continue;
    const next = out ? `${out} ${p}` : p;
    if (next.length > max) break;
    out = next;
    if (out.length >= 110) break;
  }
  return out || truncate(parts.filter(Boolean).join(" "), max);
}
