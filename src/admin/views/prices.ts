// Precios de servicios. Por defecto NO se muestran: el administrador decide con
// "Mostrar" si la web enseña el precio o solo "Solicitar cotización".
import { sb } from "../supabase";
import { h, clear, loading, errorBox, friendlyError, toast } from "../ui";
import { markPending } from "../publish";
import { PRICE_TYPES } from "../entities";
import { siteId } from "../site";

export async function renderPrices(root: HTMLElement) {
  clear(root).append(h("div", { class: "page-head" }, h("h1", null, "Precios")), loading());
  const svc = await sb!.from("services").select("id, name, price_type, price_from, price_unit, show_price, is_active").eq("site_id", siteId()).order("sort_order");
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
      h("p", { class: "muted" }, "El precio solo aparece en la web si marcas “Mostrar”. Si no, la web muestra “Solicitar cotización”. Los precios de productos se editan en cada producto."),
      h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("thead", null, h("tr", null, ...["Servicio", "Tipo", "Precio S/", "Unidad", "Mostrar", ""].map((t) => h("th", null, t)))), tbody))
    )
  );
}
