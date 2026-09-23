// Precios: tarifas de servicios + planes de la sección "Costos" del inicio.
import { sb } from "../supabase";
import { h, clear, loading, errorBox, friendlyError, toast } from "../ui";
import { markPending } from "../publish";
import { PRICE_TYPES } from "../entities";

type Plan = { name: string; subtitle: string; icon: "leaf" | "gear"; price: number | null; price_label: string; show_price: boolean; featured: boolean; features: string[] };

export async function renderPrices(root: HTMLElement) {
  clear(root).append(h("div", { class: "page-head" }, h("h1", null, "Precios")), loading());
  const [svc, plansR] = await Promise.all([
    sb!.from("services").select("id, name, price_type, price_from, price_unit, show_price, is_active").order("sort_order"),
    sb!.from("site_settings").select("value").eq("key", "plans").maybeSingle(),
  ]);
  root.querySelector(".loading")?.remove();
  if (svc.error) return root.append(errorBox(friendlyError(svc.error)));

  // ---------- servicios ----------
  const tbody = h("tbody");
  for (const s of svc.data as any[]) {
    const type = h("select", { class: "input", "aria-label": `Tipo de precio de ${s.name}` }, ...PRICE_TYPES.map(([v, l]) => h("option", { value: v, selected: v === s.price_type }, l)));
    const price = h("input", { class: "input", type: "number", min: "0", step: "0.01", value: s.price_from ?? "", "aria-label": `Precio de ${s.name}` });
    const unit = h("input", { class: "input", type: "text", maxlength: 30, value: s.price_unit ?? "", placeholder: "m², mes…", "aria-label": `Unidad de ${s.name}` });
    const show = h("input", { type: "checkbox", checked: s.show_price, "aria-label": `Mostrar precio de ${s.name}` });
    const save = h("button", { class: "btn btn-sm btn-primary", type: "button" }, "Guardar");
    const sync = () => { const q = type.value === "quote"; price.disabled = q; unit.disabled = q || type.value === "per_m2"; };
    type.addEventListener("change", sync);
    sync();
    save.addEventListener("click", async () => {
      const p = price.value === "" ? null : Number(price.value);
      if (type.value !== "quote" && show.checked && p === null) return toast(`Indica el precio de ${s.name} o elige “Solicitar cotización”.`, "err");
      save.disabled = true;
      const { error } = await sb!.from("services").update({ price_type: type.value, price_from: p, price_unit: unit.value.trim() || null, show_price: show.checked }).eq("id", s.id);
      save.disabled = false;
      if (error) return toast(friendlyError(error), "err");
      markPending("Precios");
      toast(`Precio de “${s.name}” guardado.`);
    });
    tbody.append(
      h("tr", null,
        h("td", { "data-label": "Servicio" }, s.name, s.is_active ? null : h("span", { class: "muted" }, " (inactivo)")),
        h("td", { "data-label": "Tipo" }, type),
        h("td", { "data-label": "Precio S/" }, price),
        h("td", { "data-label": "Unidad" }, unit),
        h("td", { "data-label": "Mostrar" }, h("label", { class: "check" }, show, h("span", null, "Sí"))),
        h("td", { class: "td-actions" }, save)
      )
    );
  }
  root.append(
    h("section", { class: "panel" },
      h("h2", null, "Precios de servicios"),
      h("p", { class: "muted" }, "“Solicitar cotización” oculta el precio y muestra el botón de cotizar. Solo se muestra un precio si marcas “Mostrar”."),
      h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("thead", null, h("tr", null, ...["Servicio", "Tipo", "Precio S/", "Unidad", "Mostrar", ""].map((t) => h("th", null, t)))), tbody))
    )
  );

  // ---------- planes ----------
  const plans = (plansR.data?.value ?? { title: "Inversión en un entorno mejor", note: "", items: [] }) as { title: string; note: string; items: Plan[] };
  const title = h("input", { class: "input", type: "text", maxlength: 120, value: plans.title });
  const note = h("textarea", { class: "input", rows: 2, maxlength: 400, value: plans.note ?? "" });
  const list = h("div", { class: "plans-edit" });
  const readers: (() => Plan)[] = [];

  const addPlanCard = (p: Plan) => {
    const f = {
      name: h("input", { class: "input", type: "text", maxlength: 60, value: p.name }),
      subtitle: h("input", { class: "input", type: "text", maxlength: 80, value: p.subtitle }),
      price: h("input", { class: "input", type: "number", min: "0", step: "1", value: p.price ?? "" }),
      price_label: h("input", { class: "input", type: "text", maxlength: 20, value: p.price_label, placeholder: "desde, /mes" }),
      icon: h("select", { class: "input" }, h("option", { value: "leaf", selected: p.icon !== "gear" }, "Hoja"), h("option", { value: "gear", selected: p.icon === "gear" }, "Engranaje")),
      show: h("input", { type: "checkbox", checked: p.show_price }),
      featured: h("input", { type: "checkbox", checked: p.featured }),
      features: h("textarea", { class: "input", rows: 5, value: p.features.join("\n") }),
    };
    const card = h("div", { class: "plan-edit" },
      h("div", { class: "grid2" },
        h("label", null, "Nombre", f.name), h("label", null, "Subtítulo", f.subtitle),
        h("label", null, "Precio (S/)", f.price), h("label", null, "Etiqueta del precio", f.price_label),
        h("label", null, "Ícono", f.icon),
        h("div", { class: "checks-row" }, h("label", { class: "check" }, f.show, h("span", null, "Mostrar precio")), h("label", { class: "check" }, f.featured, h("span", null, "“Más solicitado”")))
      ),
      h("label", null, "Características (una por línea)", f.features),
      h("button", { class: "btn btn-sm btn-danger-ghost", type: "button", onclick: () => { card.remove(); readers.splice(readers.indexOf(read), 1); } }, "Quitar plan")
    );
    const read = (): Plan => ({
      name: f.name.value.trim(),
      subtitle: f.subtitle.value.trim(),
      icon: f.icon.value as Plan["icon"],
      price: f.price.value === "" ? null : Number(f.price.value),
      price_label: f.price_label.value.trim(),
      show_price: f.show.checked,
      featured: f.featured.checked,
      features: f.features.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 10),
    });
    readers.push(read);
    list.append(card);
  };
  plans.items.forEach(addPlanCard);

  const savePlans = h("button", { class: "btn btn-primary", type: "button" }, "Guardar planes");
  savePlans.addEventListener("click", async () => {
    const items = readers.map((r) => r());
    if (items.some((p) => !p.name)) return toast("Cada plan necesita un nombre.", "err");
    if (items.some((p) => p.show_price && p.price === null)) return toast("Indica el precio de los planes que muestran precio.", "err");
    if (items.length > 4) return toast("Máximo 4 planes para mantener el diseño.", "err");
    savePlans.disabled = true;
    const { error } = await sb!.from("site_settings").upsert({ key: "plans", value: { title: title.value.trim(), note: note.value.trim(), items } });
    savePlans.disabled = false;
    if (error) return toast(friendlyError(error), "err");
    markPending("Planes");
    toast("Planes guardados.");
  });

  root.append(
    h("section", { class: "panel" },
      h("h2", null, "Planes (sección “Costos” del inicio)"),
      h("label", null, "Título de la sección", title),
      h("label", null, "Nota al pie (p. ej. “Precios referenciales…”)", note),
      list,
      h("div", { class: "form-actions" },
        h("button", { class: "btn btn-ghost", type: "button", onclick: () => addPlanCard({ name: "", subtitle: "", icon: "leaf", price: null, price_label: "desde", show_price: false, featured: false, features: [] }) }, "+ Agregar plan"),
        savePlans
      )
    )
  );
}
