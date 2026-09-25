// Configuración: datos de contacto y redes sociales (se usan en toda la web y en el schema).
import { sb } from "../supabase";
import { h, clear, loading, errorBox, friendlyError, toast } from "../ui";
import { markPending } from "../publish";
import { siteId } from "../site";

export async function renderSettings(root: HTMLElement) {
  clear(root).append(h("div", { class: "page-head" }, h("h1", null, "Configuración")), loading());
  const { data, error } = await sb!.from("site_settings").select("key, value").eq("site_id", siteId()).in("key", ["contact", "social"]);
  root.querySelector(".loading")?.remove();
  if (error) return root.append(errorBox(friendlyError(error)));
  const kv = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
  const c = kv.contact ?? {};
  const s = kv.social ?? {};

  const inp = (value: string, attrs: Record<string, unknown> = {}) => h("input", { class: "input", type: "text", value: value ?? "", ...attrs });
  const f = {
    company: inp(c.company, { maxlength: 80 }),
    legal_name: inp(c.legal_name, { maxlength: 120 }),
    phones: inp((c.phones ?? []).join(", "), { placeholder: "931-637-047, 991-554-666" }),
    whatsapp: inp(c.whatsapp, { placeholder: "51931637047", pattern: "[0-9]{9,15}" }),
    email: inp(c.email, { type: "email" }),
    city: inp(c.city),
    region: inp(c.region),
    ruc: inp(c.ruc, { pattern: "[0-9]{11}" }),
    tagline: inp(c.tagline, { maxlength: 120 }),
    facebook: inp(s.facebook, { type: "url", placeholder: "https://facebook.com/…" }),
    instagram: inp(s.instagram, { type: "url", placeholder: "https://instagram.com/…" }),
    tiktok: inp(s.tiktok, { type: "url", placeholder: "https://www.tiktok.com/@…" }),
    youtube: inp(s.youtube, { type: "url", placeholder: "https://www.youtube.com/@…" }),
    linkedin: inp(s.linkedin, { type: "url", placeholder: "https://linkedin.com/company/…" }),
  };
  const lab = (t: string, el: HTMLElement, help?: string) => h("label", null, t, el, help ? h("span", { class: "help" }, help) : null);
  const save = h("button", { class: "btn btn-primary", type: "submit" }, "Guardar configuración");

  const form = h("form", { class: "form-card", novalidate: true },
    h("h2", { class: "form-section" }, "Datos de contacto"),
    h("div", { class: "grid2" },
      lab("Nombre comercial", f.company), lab("Razón social", f.legal_name),
      lab("Teléfonos", f.phones, "Separados por coma."), lab("WhatsApp (con código de país)", f.whatsapp, "Solo números, ej. 51931637047."),
      lab("Correo", f.email), lab("RUC", f.ruc),
      lab("Distrito / ciudad", f.city), lab("Región", f.region)
    ),
    lab("Frase del pie de página", f.tagline),
    h("h2", { class: "form-section" }, "Redes sociales"),
    h("p", { class: "muted" }, "Deja vacío lo que no exista: los íconos solo aparecen si hay una URL real."),
    h("div", { class: "grid2" }, lab("Facebook", f.facebook), lab("Instagram", f.instagram), lab("TikTok", f.tiktok), lab("YouTube", f.youtube), lab("LinkedIn", f.linkedin)),
    h("div", { class: "form-actions" }, save)
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    for (const el of Object.values(f)) {
      if (!el.checkValidity()) { el.focus(); return toast("Revisa el campo marcado.", "err"); }
    }
    if (!f.email.value.trim() || !f.whatsapp.value.trim()) return toast("El correo y el WhatsApp son obligatorios.", "err");
    const contact = {
      ...c,
      company: f.company.value.trim(),
      legal_name: f.legal_name.value.trim(),
      phones: f.phones.value.split(",").map((x) => x.trim()).filter(Boolean),
      whatsapp: f.whatsapp.value.replace(/\D/g, ""),
      email: f.email.value.trim(),
      city: f.city.value.trim(),
      region: f.region.value.trim(),
      ruc: f.ruc.value.trim(),
      tagline: f.tagline.value.trim(),
    };
    const social = { ...s, facebook: f.facebook.value.trim(), instagram: f.instagram.value.trim(), tiktok: f.tiktok.value.trim(), youtube: f.youtube.value.trim(), linkedin: f.linkedin.value.trim() };
    save.disabled = true;
    const { error } = await sb!
      .from("site_settings")
      .upsert([{ site_id: siteId(), key: "contact", value: contact }, { site_id: siteId(), key: "social", value: social }], { onConflict: "site_id,key" });
    save.disabled = false;
    if (error) return toast(friendlyError(error), "err");
    markPending("Configuración");
    toast("Configuración guardada.");
  });

  root.append(form);
}
