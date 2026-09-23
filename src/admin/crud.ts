// Motor CRUD genérico del panel (listado + formulario) para las tablas de contenido.
import { sb } from "./supabase";
import { h, icon, clear, toast, confirmDialog, loading, errorBox, friendlyError, slugify, fmtDateTime } from "./ui";
import { uploadImage, previewUrl } from "./images";
import { markPending } from "./publish";

export type FieldType = "text" | "textarea" | "markdown" | "slug" | "number" | "money" | "bool" | "select" | "image" | "gallery" | "datetime";
export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  max?: number;
  options?: [string, string][];
  fk?: { table: string; label: string };
  bucket?: "projects" | "products" | "blog";
  wide?: boolean;
  section?: string;
}
export interface Column { label: string; get: (r: any) => Node | string | null }
export interface Entity {
  key: string;
  table: string;
  title: string;
  singular: string;
  listSelect: string;
  order: { column: string; ascending?: boolean }[];
  columns: Column[];
  fields: Field[];
  nameField: string;
  publicPath?: (slug: string) => string;
  toggle?: { field: string; on: string; off: string };
  canDelete: boolean;
  thumbField?: string;
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ======================================================================
// LISTADO
// ======================================================================
export async function renderList(root: HTMLElement, e: Entity) {
  clear(root).append(
    h("div", { class: "page-head" },
      h("h1", null, e.title),
      h("a", { class: "btn btn-primary", href: `#/${e.key}/new` }, icon("i-plus"), `Nuevo ${e.singular.toLowerCase()}`)
    ),
    loading()
  );
  let q = sb!.from(e.table).select(e.listSelect).limit(500);
  for (const o of e.order) q = q.order(o.column, { ascending: o.ascending ?? true });
  const { data, error } = await q;
  root.querySelector(".loading")?.remove();
  if (error) return root.append(errorBox(friendlyError(error)));
  if (!data?.length) return root.append(h("div", { class: "empty" }, `Todavía no hay ${e.title.toLowerCase()}.`));

  const tbody = h("tbody");
  for (const row of data as any[]) {
    const thumb = h("span", { class: "thumb" });
    if (e.thumbField) previewUrl(row[e.thumbField]).then((u) => u && thumb.append(h("img", { src: u, alt: "", loading: "lazy" })));
    const toggle = e.toggle
      ? h("button", {
          class: `switch ${row[e.toggle.field] ? "on" : ""}`,
          type: "button",
          role: "switch",
          "aria-checked": String(!!row[e.toggle.field]),
          title: row[e.toggle.field] ? e.toggle.on : e.toggle.off,
          onclick: async (ev: Event) => {
            const btn = ev.currentTarget as HTMLButtonElement;
            const next = !row[e.toggle!.field];
            btn.disabled = true;
            const { error } = await sb!.from(e.table).update({ [e.toggle!.field]: next }).eq("id", row.id);
            btn.disabled = false;
            if (error) return toast(friendlyError(error), "err");
            row[e.toggle!.field] = next;
            btn.classList.toggle("on", next);
            btn.setAttribute("aria-checked", String(next));
            btn.title = next ? e.toggle!.on : e.toggle!.off;
            (btn.nextElementSibling as HTMLElement).textContent = next ? e.toggle!.on : e.toggle!.off;
            markPending(e.title);
            toast(`${e.singular}: ${next ? e.toggle!.on : e.toggle!.off}`);
          },
        })
      : null;
    tbody.append(
      h("tr", null,
        e.thumbField ? h("td", { class: "td-thumb" }, thumb) : null,
        ...e.columns.map((c) => h("td", { "data-label": c.label }, c.get(row) ?? "—")),
        e.toggle ? h("td", { class: "td-toggle" }, toggle, h("span", { class: "switch-label" }, row[e.toggle.field] ? e.toggle.on : e.toggle.off)) : null,
        h("td", { class: "td-actions" },
          h("a", { class: "btn btn-sm btn-ghost", href: `#/${e.key}/${row.id}` }, "Editar"),
          e.publicPath && row.slug ? h("a", { class: "btn btn-sm btn-ghost", href: e.publicPath(row.slug), target: "_blank", rel: "noopener", title: "Ver en la web" }, icon("i-external")) : null
        )
      )
    );
  }
  root.append(
    h("div", { class: "table-wrap" },
      h("table", { class: "table" },
        h("thead", null, h("tr", null, e.thumbField ? h("th", null, "") : null, ...e.columns.map((c) => h("th", null, c.label)), e.toggle ? h("th", null, "Estado") : null, h("th", null, ""))),
        tbody
      )
    )
  );
}

// ======================================================================
// FORMULARIO
// ======================================================================
const fkCache = new Map<string, Promise<[string, string][]>>();
function fkOptions(fk: { table: string; label: string }) {
  if (!fkCache.has(fk.table)) {
    fkCache.set(
      fk.table,
      Promise.resolve(sb!.from(fk.table).select(`id, ${fk.label}`).order(fk.label).limit(500)).then(({ data }) => (data ?? []).map((r: any) => [r.id, r[fk.label]] as [string, string]))
    );
  }
  return fkCache.get(fk.table)!;
}
export const invalidateFk = (table: string) => fkCache.delete(table);

type Getter = () => unknown;

export async function renderForm(root: HTMLElement, e: Entity, id: string | "new") {
  clear(root).append(loading());
  const isNew = id === "new";
  const cols = ["id", ...new Set(e.fields.map((f) => f.name))].join(", ");
  let row: any = {};
  if (!isNew) {
    const { data, error } = await sb!.from(e.table).select(cols).eq("id", id).maybeSingle();
    if (error) return clear(root).append(errorBox(friendlyError(error)));
    if (!data) return clear(root).append(errorBox("No existe este registro."));
    row = data;
  }
  const originalSlug: string | null = row.slug ?? null;
  const getters = new Map<string, Getter>();
  const form = h("form", { class: "form-card", novalidate: true });
  let slugInput: HTMLInputElement | null = null;
  let slugTouched = !isNew;

  let currentSection = "";
  for (const f of e.fields) {
    if (f.section && f.section !== currentSection) {
      currentSection = f.section;
      form.append(h("h2", { class: "form-section" }, f.section));
    }
    const wrap = h("div", { class: `field ${f.wide || ["markdown", "textarea", "gallery"].includes(f.type) ? "field-wide" : ""}` });
    const id_ = `f-${f.name}`;
    const label = h("label", { for: id_ }, f.label, f.required ? h("span", { class: "req" }, " *") : null);
    const value = row[f.name];

    switch (f.type) {
      case "text":
      case "slug": {
        const inp = h("input", { id: id_, class: "input", type: "text", value: value ?? "", maxlength: f.max ?? (f.type === "slug" ? 80 : 200), required: f.required });
        if (f.type === "slug") {
          slugInput = inp;
          inp.addEventListener("input", () => { slugTouched = true; inp.value = inp.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"); });
          inp.addEventListener("blur", () => (inp.value = slugify(inp.value)));
        }
        if (f.name === e.nameField) inp.addEventListener("input", () => { if (!slugTouched && slugInput) slugInput.value = slugify(inp.value); });
        wrap.append(label, inp);
        if (f.max) counter(inp, f.max, wrap);
        getters.set(f.name, () => inp.value.trim() || null);
        break;
      }
      case "textarea":
      case "markdown": {
        const ta = h("textarea", { id: id_, class: "input", rows: f.type === "markdown" ? 14 : 3, maxlength: f.max, value: value ?? "" });
        wrap.append(label, ta);
        if (f.type === "markdown") {
          const prev = h("div", { class: "md-preview prose", hidden: true });
          const tog = h("button", { type: "button", class: "btn btn-sm btn-ghost" }, "Vista previa");
          tog.addEventListener("click", async () => {
            if (prev.hidden) {
              const { marked } = await import("marked");
              // Vista previa local del propio administrador; se escapa HTML crudo igual que en la web.
              prev.innerHTML = marked.parse(ta.value.replace(/</g, "&lt;"), { async: false }) as string;
            }
            prev.hidden = !prev.hidden;
            ta.hidden = !prev.hidden ? true : false;
            tog.textContent = prev.hidden ? "Vista previa" : "Editar";
          });
          wrap.append(h("div", { class: "md-bar" }, h("span", { class: "muted" }, "Markdown: ## Subtítulo · - lista · **negrita** · [enlace](https://…)"), tog), prev);
        }
        if (f.max) counter(ta, f.max, wrap);
        getters.set(f.name, () => ta.value.trim() || null);
        break;
      }
      case "number":
      case "money": {
        const inp = h("input", { id: id_, class: "input", type: "number", step: f.type === "money" ? "0.01" : "1", min: "0", value: value ?? "" });
        wrap.append(label, inp);
        getters.set(f.name, () => (inp.value === "" ? (f.type === "number" ? 0 : null) : Number(inp.value)));
        break;
      }
      case "bool": {
        const inp = h("input", { id: id_, type: "checkbox", checked: isNew ? f.name !== "is_published" && f.name !== "is_featured" && f.name !== "featured" && f.name !== "show_price" : !!value });
        wrap.classList.add("field-check");
        wrap.append(h("label", { class: "check" }, inp, h("span", null, f.label)));
        getters.set(f.name, () => inp.checked);
        break;
      }
      case "select": {
        const sel = h("select", { id: id_, class: "input" }, h("option", { value: "" }, "— Ninguno —"));
        const opts = f.fk ? await fkOptions(f.fk) : f.options ?? [];
        for (const [v, l] of opts) sel.append(h("option", { value: v, selected: v === value }, l));
        if (f.required) sel.firstElementChild!.remove();
        wrap.append(label, sel);
        getters.set(f.name, () => sel.value || null);
        break;
      }
      case "datetime": {
        const local = value ? new Date(new Date(value).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
        const inp = h("input", { id: id_, class: "input", type: "datetime-local", value: local });
        wrap.append(label, inp);
        getters.set(f.name, () => (inp.value ? new Date(inp.value).toISOString() : null));
        break;
      }
      case "image": {
        let current: string | null = value ?? null;
        const img = h("img", { alt: "", class: "img-preview" });
        const empty = h("span", { class: "muted" }, "Sin imagen");
        const show = async () => {
          const u = await previewUrl(current);
          img.hidden = !u;
          empty.hidden = !!u;
          if (u) img.src = u;
        };
        const file = h("input", { type: "file", accept: "image/*", hidden: true });
        const up = h("button", { type: "button", class: "btn btn-sm btn-ghost" }, icon("i-upload"), "Subir imagen");
        const rm = h("button", { type: "button", class: "btn btn-sm btn-ghost" }, "Quitar");
        up.addEventListener("click", () => file.click());
        rm.addEventListener("click", () => { current = null; show(); });
        file.addEventListener("change", async () => {
          const fl = file.files?.[0];
          if (!fl) return;
          up.disabled = true;
          up.lastChild!.textContent = "Subiendo…";
          try {
            current = await uploadImage(f.bucket ?? "projects", fl, e.key);
            await show();
            toast("Imagen subida (optimizada a WebP).");
          } catch (err) {
            toast((err as Error).message, "err", 6000);
          } finally {
            up.disabled = false;
            up.lastChild!.textContent = "Subir imagen";
            file.value = "";
          }
        });
        wrap.append(label, h("div", { class: "img-field" }, img, empty, h("div", { class: "img-actions" }, up, rm)), file);
        show();
        getters.set(f.name, () => current);
        break;
      }
      case "gallery": {
        let items: string[] = Array.isArray(value) ? [...value] : [];
        const list = h("div", { class: "gallery-edit" });
        const draw = () => {
          clear(list);
          items.forEach((src, i) => {
            const im = h("img", { alt: `Foto ${i + 1}` });
            previewUrl(src).then((u) => u && (im.src = u));
            list.append(
              h("div", { class: "g-item" }, im,
                h("div", { class: "g-actions" },
                  h("button", { type: "button", title: "Mover a la izquierda", disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); } }, "◀"),
                  h("button", { type: "button", title: "Usar como portada", onclick: () => { const cover = form.querySelector<HTMLElement>('[data-cover-target]'); cover?.dispatchEvent(new CustomEvent("set-cover", { detail: src })); toast("Portada actualizada (guarda para aplicar)."); } }, "★"),
                  h("button", { type: "button", title: "Quitar", onclick: () => { items.splice(i, 1); draw(); } }, "✕")
                )
              )
            );
          });
          list.append(addBtn);
        };
        const file = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
        const addBtn = h("button", { type: "button", class: "g-add" }, icon("i-upload"), h("span", null, "Agregar fotos"));
        addBtn.addEventListener("click", () => file.click());
        file.addEventListener("change", async () => {
          const files = Array.from(file.files ?? []);
          addBtn.disabled = true;
          for (const [n, fl] of files.entries()) {
            (addBtn.lastChild as HTMLElement).textContent = `Subiendo ${n + 1}/${files.length}…`;
            try { items.push(await uploadImage(f.bucket ?? "projects", fl, e.key)); } catch (err) { toast(`${fl.name}: ${(err as Error).message}`, "err", 6000); }
          }
          addBtn.disabled = false;
          file.value = "";
          draw();
        });
        draw();
        wrap.append(label, list, file);
        getters.set(f.name, () => items);
        break;
      }
    }
    if (f.help) wrap.append(h("p", { class: "help" }, f.help));
    form.append(wrap);
  }

  // Botón ★ de la galería → cambia la portada (campo featured_image)
  const coverField = e.fields.find((f) => f.name === "featured_image");
  if (coverField) {
    const coverWrap = form.querySelector<HTMLElement>(`#f-featured_image`)?.closest(".field") ?? form.querySelector<HTMLElement>(".img-field")?.closest(".field");
    coverWrap?.setAttribute("data-cover-target", "");
    coverWrap?.addEventListener("set-cover", (ev) => {
      getters.set("featured_image", () => (ev as CustomEvent).detail);
      previewUrl((ev as CustomEvent).detail).then((u) => { const im = coverWrap.querySelector<HTMLImageElement>(".img-preview"); if (im && u) { im.src = u; im.hidden = false; coverWrap.querySelector<HTMLElement>(".muted")!.hidden = true; } });
    });
  }

  const saveBtn = h("button", { type: "submit", class: "btn btn-primary" }, isNew ? "Crear" : "Guardar cambios");
  const delBtn = !isNew && e.canDelete ? h("button", { type: "button", class: "btn btn-danger-ghost" }, "Eliminar") : null;
  form.append(
    h("div", { class: "form-actions" },
      h("a", { class: "btn btn-ghost", href: `#/${e.key}` }, "Volver"),
      delBtn,
      saveBtn
    )
  );

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const [k, g] of getters) payload[k] = g();

    // ---- validación ----
    for (const f of e.fields) {
      const v = payload[f.name];
      if (f.required && (v === null || v === "" || v === undefined)) return toast(`Completa: ${f.label}`, "err");
      if (f.max && typeof v === "string" && v.length > f.max) return toast(`${f.label}: máximo ${f.max} caracteres.`, "err");
    }
    if ("slug" in payload && !SLUG_RE.test(String(payload.slug))) return toast("El slug solo admite minúsculas, números y guiones.", "err");
    if (e.table === "blog_posts" && payload.is_published && !payload.published_at) payload.published_at = new Date().toISOString();

    // ---- cambio de slug: advertencia SEO + redirección 301 ----
    const slugChanged = !isNew && e.publicPath && originalSlug && payload.slug !== originalSlug;
    if (slugChanged) {
      const ok = await confirmDialog({
        title: "¿Cambiar la URL?",
        text: `La dirección ${e.publicPath!(originalSlug!)} cambiará a ${e.publicPath!(String(payload.slug))}. Esto afecta al posicionamiento en Google. Crearemos una redirección 301 automática desde la URL antigua para no perder visitas.`,
        confirmText: "Cambiar y redirigir",
      });
      if (!ok) return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando…";
    const res = isNew
      ? await sb!.from(e.table).insert(payload).select("id").single()
      : await sb!.from(e.table).update(payload).eq("id", id).select("id").single();
    saveBtn.disabled = false;
    saveBtn.textContent = isNew ? "Crear" : "Guardar cambios";
    if (res.error) return toast(friendlyError(res.error), "err", 6000);

    if (slugChanged && !e.publicPath!(originalSlug!).includes("#")) {
      const from = e.publicPath!(originalSlug!);
      const to = e.publicPath!(String(payload.slug));
      await sb!.from("redirects").delete().eq("from_path", to); // la nueva URL no debe redirigir
      await sb!.from("redirects").update({ to_path: to }).eq("to_path", from); // evita cadenas de redirección
      const r = await sb!.from("redirects").upsert({ from_path: from, to_path: to }, { onConflict: "from_path" });
      if (r.error) toast(`Guardado, pero no se creó la redirección: ${friendlyError(r.error)}`, "err", 8000);
    }
    if (e.table === "services" || e.table === "categories") invalidateFk(e.table);
    markPending(e.title);
    toast(isNew ? `${e.singular} creado.` : "Cambios guardados.");
    location.hash = `#/${e.key}`;
  });

  delBtn?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: `Eliminar ${e.singular.toLowerCase()}`,
      text: "Esta acción no se puede deshacer. Si solo quieres ocultarlo de la web, desactívalo o despublícalo.",
      confirmText: "Eliminar definitivamente",
      danger: true,
      requireWord: "ELIMINAR",
    });
    if (!ok) return;
    const { error } = await sb!.from(e.table).delete().eq("id", id);
    if (error) return toast(friendlyError(error), "err", 6000);
    if (e.table === "categories") invalidateFk("categories");
    markPending(e.title);
    toast(`${e.singular} eliminado.`);
    location.hash = `#/${e.key}`;
  });

  clear(root).append(
    h("div", { class: "page-head" },
      h("div", null,
        h("a", { class: "back", href: `#/${e.key}` }, "← ", e.title),
        h("h1", null, isNew ? `Nuevo ${e.singular.toLowerCase()}` : String(row[e.nameField] ?? e.singular))
      ),
      !isNew && e.publicPath && row.slug ? h("a", { class: "btn btn-ghost", href: e.publicPath(row.slug), target: "_blank", rel: "noopener" }, "Ver en la web ", icon("i-external")) : null
    ),
    !isNew && row.updated_at ? h("p", { class: "muted" }, `Última edición: ${fmtDateTime(row.updated_at)}`) : null,
    form
  );
}

function counter(el: HTMLInputElement | HTMLTextAreaElement, max: number, wrap: HTMLElement) {
  const c = h("span", { class: "counter" });
  const upd = () => {
    c.textContent = `${el.value.length}/${max}`;
    c.classList.toggle("warn", el.value.length > max * 0.9);
  };
  el.addEventListener("input", upd);
  upd();
  wrap.append(c);
}
