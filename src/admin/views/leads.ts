// Leads (CRM): listado paginado con filtros EN LA BASE DE DATOS + ficha de detalle.
import { sb } from "../supabase";
import { h, clear, icon, loading, errorBox, friendlyError, toast, confirmDialog, statusBadge, sourceLabel, fmtDateTime, STATUS, SOURCE_OPTIONS, waFor } from "../ui";

const PAGE = 20;

/** Inicio (ISO) de hoy / semana / mes en hora de Lima, o una fecha yyyy-mm-dd. */
function limaStart(v: string): string | null {
  const now = new Date(Date.now() - 5 * 3600e3); // Lima = UTC-5 (sin horario de verano)
  let d: Date;
  if (v === "today") d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  else if (v === "week") {
    const dow = (now.getUTCDay() + 6) % 7; // lunes = 0
    d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
  } else if (v === "month") d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) d = new Date(`${v}T00:00:00Z`);
  else return null;
  return new Date(d.getTime() + 5 * 3600e3).toISOString();
}
const limaEnd = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(new Date(`${v}T00:00:00Z`).getTime() + 29 * 3600e3).toISOString() : null);

let servicesCache: Promise<{ id: string; name: string }[]> | null = null;
const servicesList = () =>
  (servicesCache ??= Promise.resolve(sb!.from("services").select("id, name").order("sort_order")).then((r) => (r.data ?? []) as { id: string; name: string }[]));

export async function renderLeads(root: HTMLElement, params: URLSearchParams) {
  const status = params.get("status") ?? "";
  const service = params.get("service") ?? "";
  const source = params.get("source") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const q = (params.get("q") ?? "").replace(/[,()*%\\]/g, " ").trim().slice(0, 60);
  const page = Math.max(1, Number(params.get("page")) || 1);

  const go = (patch: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? p.set(k, v) : p.delete(k));
    if (!("page" in patch)) p.delete("page");
    location.hash = `#/leads${p.toString() ? `?${p}` : ""}`;
  };

  const services = await servicesList();
  const sel = (name: string, value: string, opts: [string, string][], all: string) =>
    h("select", { class: "input", "aria-label": all, onchange: (e: Event) => go({ [name]: (e.target as HTMLSelectElement).value }) },
      h("option", { value: "" }, all),
      ...opts.map(([v, l]) => h("option", { value: v, selected: v === value }, l))
    );
  const search = h("input", { class: "input", type: "search", placeholder: "Buscar nombre, empresa o teléfono", value: q, "aria-label": "Buscar" });
  const fromIn = h("input", { class: "input", type: "date", value: /^\d{4}/.test(from) ? from : "", "aria-label": "Desde", onchange: (e: Event) => go({ from: (e.target as HTMLInputElement).value }) });
  const toIn = h("input", { class: "input", type: "date", value: to, "aria-label": "Hasta", onchange: (e: Event) => go({ to: (e.target as HTMLInputElement).value }) });

  clear(root).append(
    h("div", { class: "page-head" }, h("h1", null, "Leads"), h("button", { class: "btn btn-ghost", type: "button", onclick: () => renderLeads(root, params) }, icon("i-refresh"), "Actualizar")),
    h("form", { class: "filters", onsubmit: (e: Event) => { e.preventDefault(); go({ q: search.value.trim() }); } },
      search,
      sel("status", status, Object.entries(STATUS), "Todos los estados"),
      sel("service", service, services.map((s) => [s.id, s.name]), "Todos los servicios"),
      sel("source", source, SOURCE_OPTIONS, "Todos los orígenes"),
      h("label", { class: "inline" }, "Desde", fromIn),
      h("label", { class: "inline" }, "Hasta", toIn),
      h("button", { class: "btn btn-primary", type: "submit" }, "Buscar"),
      [status, service, source, from, to, q].some(Boolean) ? h("a", { class: "btn btn-ghost", href: "#/leads" }, "Limpiar") : null
    ),
    loading()
  );
  if (["today", "week", "month"].includes(from)) root.querySelector(".filters")!.append(h("span", { class: "chip-info" }, { today: "Hoy", week: "Esta semana", month: "Este mes" }[from]!));

  let query = sb!
    .from("leads")
    .select("id, name, company, phone, service_label, district, source, created_at, status, services(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (status) query = query.eq("status", status);
  if (service) query = query.eq("service_id", service);
  if (source) query = query.eq("source", source);
  const fromIso = from && limaStart(from);
  if (fromIso) query = query.gte("created_at", fromIso);
  const toIso = to && limaEnd(to);
  if (toIso) query = query.lt("created_at", toIso);
  if (q) query = query.or(`name.ilike.*${q}*,company.ilike.*${q}*,phone.ilike.*${q}*`);

  const { data, error, count } = await query;
  root.querySelector(".loading")?.remove();
  if (error) return root.append(errorBox(friendlyError(error)));
  const total = count ?? 0;
  if (!data?.length) return root.append(h("p", { class: "empty" }, total === 0 && !params.toString() ? "Aún no hay leads." : "No hay leads con estos filtros."));

  root.append(
    h("p", { class: "muted" }, `${total} lead${total === 1 ? "" : "s"}`),
    h("div", { class: "table-wrap" },
      h("table", { class: "table" },
        h("thead", null, h("tr", null, ...["Nombre", "Empresa", "Teléfono", "Servicio", "Distrito", "Origen", "Fecha", "Estado"].map((t) => h("th", null, t)))),
        h("tbody", null,
          ...(data as any[]).map((l) =>
            h("tr", { class: `row-link ${l.status === "new" ? "row-new" : ""}`, onclick: (e: Event) => { if ((e.target as HTMLElement).tagName !== "A") location.hash = `#/leads/${l.id}`; } },
              h("td", { "data-label": "Nombre" }, h("a", { href: `#/leads/${l.id}` }, l.name)),
              h("td", { "data-label": "Empresa" }, l.company ?? "—"),
              h("td", { "data-label": "Teléfono" }, l.phone),
              h("td", { "data-label": "Servicio" }, l.services?.name ?? l.service_label ?? "—"),
              h("td", { "data-label": "Distrito" }, l.district ?? "—"),
              h("td", { "data-label": "Origen" }, sourceLabel(l.source)),
              h("td", { "data-label": "Fecha" }, fmtDateTime(l.created_at)),
              h("td", { "data-label": "Estado" }, statusBadge(l.status))
            )
          )
        )
      )
    ),
    pager(page, Math.ceil(total / PAGE), (p) => go({ page: String(p) }))
  );
}

function pager(page: number, pages: number, go: (p: number) => void) {
  if (pages <= 1) return null;
  return h("nav", { class: "pager", "aria-label": "Paginación" },
    h("button", { class: "btn btn-sm btn-ghost", type: "button", disabled: page <= 1, onclick: () => go(page - 1) }, "← Anterior"),
    h("span", null, `Página ${page} de ${pages}`),
    h("button", { class: "btn btn-sm btn-ghost", type: "button", disabled: page >= pages, onclick: () => go(page + 1) }, "Siguiente →")
  );
}

// ======================================================================
// FICHA DEL LEAD
// ======================================================================
export async function renderLead(root: HTMLElement, id: string) {
  clear(root).append(loading());
  const { data: l, error } = await sb!.from("leads").select("*, services(name, slug)").eq("id", id).maybeSingle();
  if (error) return clear(root).append(errorBox(friendlyError(error)));
  if (!l) return clear(root).append(errorBox("Este lead no existe."));

  const statusSel = h("select", { class: "input", id: "lead-status" }, ...Object.entries(STATUS).map(([v, t]) => h("option", { value: v, selected: v === l.status }, t)));
  const notes = h("textarea", { class: "input", id: "lead-notes", rows: 6, maxlength: 5000, value: l.admin_notes ?? "", placeholder: "Notas internas: llamadas, visitas, montos cotizados…" });
  const save = h("button", { class: "btn btn-primary", type: "button" }, "Guardar");
  const badge = h("span", null, statusBadge(l.status));

  save.addEventListener("click", async () => {
    save.disabled = true;
    const { error } = await sb!.from("leads").update({ status: statusSel.value, admin_notes: notes.value.trim() || null }).eq("id", id);
    save.disabled = false;
    if (error) return toast(friendlyError(error), "err");
    clear(badge).append(statusBadge(statusSel.value));
    toast("Lead actualizado.");
  });

  const del = h("button", { class: "btn btn-danger-ghost", type: "button" }, "Eliminar lead");
  del.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Eliminar lead", text: `Se eliminará definitivamente el lead de ${l.name}. Si solo no avanzó, mejor márcalo como “Perdido”.`, confirmText: "Eliminar", danger: true, requireWord: "ELIMINAR" });
    if (!ok) return;
    const { error } = await sb!.from("leads").delete().eq("id", id);
    if (error) return toast(friendlyError(error), "err");
    toast("Lead eliminado.");
    location.hash = "#/leads";
  });

  const row = (label: string, value: unknown) => (value === null || value === undefined || value === "" ? null : h("div", { class: "kv" }, h("dt", null, label), h("dd", null, String(value))));
  const svcName = l.services?.name ?? l.service_label;
  const waText = `Hola ${l.name.split(" ")[0]}, te escribimos de AGROYAURI SAC por tu solicitud${svcName ? ` de ${svcName}` : ""}.`;

  clear(root).append(
    h("div", { class: "page-head" },
      h("div", null, h("a", { class: "back", href: "#/leads" }, "← Leads"), h("h1", null, l.name), h("p", { class: "muted" }, `Recibido: ${fmtDateTime(l.created_at)} · `, badge))
    ),
    h("div", { class: "actions-bar" },
      h("a", { class: "btn btn-wa", href: `${waFor(l.phone)}?text=${encodeURIComponent(waText)}`, target: "_blank", rel: "noopener" }, icon("i-wa"), "WhatsApp"),
      h("a", { class: "btn btn-ghost", href: `tel:${l.phone.replace(/[^\d+]/g, "")}` }, icon("i-phone"), "Llamar"),
      h("a", { class: "btn btn-ghost", href: `mailto:${l.email}?subject=${encodeURIComponent(`Tu solicitud de cotización – AGROYAURI SAC`)}` }, icon("i-mail"), "Enviar correo")
    ),
    h("div", { class: "detail-cols" },
      h("section", { class: "panel" },
        h("h2", null, "Datos del cliente"),
        h("dl", { class: "kvs" },
          row("Nombre", l.name), row("Empresa", l.company), row("Teléfono", l.phone), row("Correo", l.email),
          row("Servicio", svcName), row("Distrito", l.district), row("Ubicación", l.location),
          row("Área aproximada", l.area_m2 ? `${Number(l.area_m2)} m²` : null)
        ),
        l.message ? h("div", { class: "message" }, h("h3", null, "Mensaje"), h("p", null, l.message)) : null
      ),
      h("div", null,
        h("section", { class: "panel" },
          h("h2", null, "Seguimiento"),
          h("label", { for: "lead-status" }, "Estado"), statusSel,
          h("label", { for: "lead-notes" }, "Notas internas"), notes,
          h("div", { class: "form-actions" }, save)
        ),
        h("section", { class: "panel" },
          h("h2", null, "Origen del lead"),
          h("dl", { class: "kvs" },
            row("Origen", sourceLabel(l.source)), row("Página de entrada", l.landing_page), row("Referrer", l.referrer),
            row("utm_source", l.utm_source), row("utm_medium", l.utm_medium), row("utm_campaign", l.utm_campaign),
            row("utm_content", l.utm_content), row("utm_term", l.utm_term)
          )
        ),
        h("div", { class: "danger-zone" }, del)
      )
    )
  );
}
