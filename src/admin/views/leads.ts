// Leads (CRM): listado paginado con filtros EN LA BASE DE DATOS + ficha de detalle
// con notas, asignación y acciones rápidas. Todo filtrado por la web actual (y RLS).
import { sb } from "../supabase";
import { h, clear, icon, loading, errorBox, friendlyError, toast, confirmDialog, statusBadge, sourceLabel, fmtDateTime, STATUS, SOURCE_OPTIONS, waFor } from "../ui";
import { ADMIN, go } from "../nav";
import { site, siteId } from "../site";

const PAGE = 20;
const OPEN = "open"; // filtro especial: todo lo que no está ganado ni perdido

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

// Catálogos pequeños de la web actual: se piden una vez por web.
const servicesCache = new Map<string, Promise<{ id: string; name: string }[]>>();
const servicesList = () => {
  const sid = siteId();
  if (!servicesCache.has(sid))
    servicesCache.set(sid, Promise.resolve(sb!.from("services").select("id, name").eq("site_id", sid).order("sort_order")).then((r) => (r.data ?? []) as { id: string; name: string }[]));
  return servicesCache.get(sid)!;
};

type Member = { id: string; name: string };
const membersCache = new Map<string, Promise<Member[]>>();
/** Usuarios que administran la web actual (para asignar leads). */
const membersList = () => {
  const sid = siteId();
  if (!membersCache.has(sid))
    membersCache.set(
      sid,
      Promise.resolve(sb!.from("site_users").select("user_id, profiles(full_name)").eq("site_id", sid)).then((r) =>
        ((r.data ?? []) as any[]).map((m) => ({ id: m.user_id, name: m.profiles?.full_name ?? "Usuario" }))
      )
    );
  return membersCache.get(sid)!;
};

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast("Teléfono copiado.");
  } catch {
    toast("No se pudo copiar. Selecciónalo manualmente.", "err");
  }
};

export async function renderLeads(root: HTMLElement, params: URLSearchParams) {
  const status = params.get("status") ?? "";
  const service = params.get("service") ?? "";
  const source = params.get("source") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const q = (params.get("q") ?? "").replace(/[,()*%\\"]/g, " ").trim().slice(0, 60);
  const page = Math.max(1, Number(params.get("page")) || 1);

  const nav = (patch: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? p.set(k, v) : p.delete(k));
    if (!("page" in patch)) p.delete("page");
    go(`${ADMIN}/leads${p.toString() ? `?${p}` : ""}`);
  };

  const services = await servicesList();
  const sel = (name: string, value: string, opts: [string, string][], all: string) =>
    h("select", { class: "input", "aria-label": all, onchange: (e: Event) => nav({ [name]: (e.target as HTMLSelectElement).value }) },
      h("option", { value: "" }, all),
      ...opts.map(([v, l]) => h("option", { value: v, selected: v === value }, l))
    );
  const search = h("input", { class: "input", type: "search", placeholder: "Buscar nombre, teléfono, correo o empresa", value: q, "aria-label": "Buscar" });
  const fromIn = h("input", { class: "input", type: "date", value: /^\d{4}/.test(from) ? from : "", "aria-label": "Desde", onchange: (e: Event) => nav({ from: (e.target as HTMLInputElement).value }) });
  const toIn = h("input", { class: "input", type: "date", value: to, "aria-label": "Hasta", onchange: (e: Event) => nav({ to: (e.target as HTMLInputElement).value }) });

  clear(root).append(
    h("div", { class: "page-head" }, h("h1", null, "Leads"), h("button", { class: "btn btn-ghost", type: "button", onclick: () => renderLeads(root, params) }, icon("i-refresh"), "Actualizar")),
    h("form", { class: "filters", onsubmit: (e: Event) => { e.preventDefault(); nav({ q: search.value.trim() }); } },
      search,
      sel("status", status, [[OPEN, "Pendientes (en proceso)"], ...Object.entries(STATUS)], "Todos los estados"),
      sel("service", service, services.map((s) => [s.id, s.name]), "Todos los servicios"),
      sel("source", source, SOURCE_OPTIONS, "Todos los orígenes"),
      h("label", { class: "inline" }, "Desde", fromIn),
      h("label", { class: "inline" }, "Hasta", toIn),
      h("button", { class: "btn btn-primary", type: "submit" }, "Buscar"),
      [status, service, source, from, to, q].some(Boolean) ? h("a", { class: "btn btn-ghost", href: `${ADMIN}/leads` }, "Limpiar") : null
    ),
    loading()
  );
  if (["today", "week", "month"].includes(from)) root.querySelector(".filters")!.append(h("span", { class: "chip-info" }, { today: "Hoy", week: "Esta semana", month: "Este mes" }[from]!));

  // Solo las columnas que se muestran; paginado y filtrado en PostgreSQL.
  let query = sb!
    .from("leads")
    .select("id, name, company, phone, email, service_label, source, created_at, status, services(name)", { count: "exact" })
    .eq("site_id", siteId())
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (status === OPEN) query = query.not("status", "in", "(won,lost)");
  else if (status) query = query.eq("status", status);
  if (service) query = query.eq("service_id", service);
  if (source) query = query.eq("source", source);
  const fromIso = from && limaStart(from);
  if (fromIso) query = query.gte("created_at", fromIso);
  const toIso = to && limaEnd(to);
  if (toIso) query = query.lt("created_at", toIso);
  if (q) query = query.or(`name.ilike.*${q}*,phone.ilike.*${q}*,email.ilike.*${q}*,company.ilike.*${q}*`);

  const { data, error, count } = await query;
  root.querySelector(".loading")?.remove();
  if (error) return root.append(errorBox(friendlyError(error)));
  const total = count ?? 0;
  if (!data?.length) return root.append(h("p", { class: "empty" }, total === 0 && !params.toString() ? "Aún no hay leads." : "No hay leads con estos filtros."));

  root.append(
    h("p", { class: "muted" }, `${total} lead${total === 1 ? "" : "s"}`),
    h("div", { class: "table-wrap" },
      h("table", { class: "table" },
        h("thead", null, h("tr", null, ...["Nombre", "Empresa", "Teléfono", "Correo", "Servicio", "Origen", "Fecha", "Estado"].map((t) => h("th", null, t)))),
        h("tbody", null,
          ...(data as any[]).map((l) =>
            h("tr", { class: `row-link ${l.status === "new" ? "row-new" : ""}`, onclick: (e: Event) => { if ((e.target as HTMLElement).tagName !== "A") go(`${ADMIN}/leads/${l.id}`); } },
              h("td", { "data-label": "Nombre" }, h("a", { href: `${ADMIN}/leads/${l.id}` }, l.name)),
              h("td", { "data-label": "Empresa" }, l.company ?? "—"),
              h("td", { "data-label": "Teléfono" }, l.phone),
              h("td", { "data-label": "Correo" }, l.email ?? "—"),
              h("td", { "data-label": "Servicio" }, l.services?.name ?? l.service_label ?? "—"),
              h("td", { "data-label": "Origen" }, sourceLabel(l.source)),
              h("td", { "data-label": "Fecha" }, fmtDateTime(l.created_at)),
              h("td", { "data-label": "Estado" }, statusBadge(l.status))
            )
          )
        )
      )
    ),
    pager(page, Math.ceil(total / PAGE), (p) => nav({ page: String(p) }))
  );
}

function pager(page: number, pages: number, onGo: (p: number) => void) {
  if (pages <= 1) return null;
  return h("nav", { class: "pager", "aria-label": "Paginación" },
    h("button", { class: "btn btn-sm btn-ghost", type: "button", disabled: page <= 1, onclick: () => onGo(page - 1) }, "← Anterior"),
    h("span", null, `Página ${page} de ${pages}`),
    h("button", { class: "btn btn-sm btn-ghost", type: "button", disabled: page >= pages, onclick: () => onGo(page + 1) }, "Siguiente →")
  );
}

// ======================================================================
// FICHA DEL LEAD
// ======================================================================
const LEAD_COLS =
  "id, name, company, phone, email, message, service_label, district, location, area_m2, source, landing_page, referrer, " +
  "utm_source, utm_medium, utm_campaign, utm_content, utm_term, status, assigned_to, created_at, updated_at, services(name)";

export async function renderLead(root: HTMLElement, id: string) {
  clear(root).append(loading());
  const [leadR, notesR, members] = await Promise.all([
    sb!.from("leads").select(LEAD_COLS).eq("id", id).eq("site_id", siteId()).maybeSingle(),
    sb!.from("lead_notes").select("id, note, created_at, user_id, profiles(full_name)").eq("lead_id", id).order("created_at", { ascending: false }).limit(100),
    membersList(),
  ]);
  const l = leadR.data as any;
  if (leadR.error) return clear(root).append(errorBox(friendlyError(leadR.error)));
  if (!l) return clear(root).append(errorBox("Este lead no existe o no pertenece a esta web."));

  const badge = h("span", null, statusBadge(l.status));
  const statusSel = h("select", { class: "input", id: "lead-status" }, ...Object.entries(STATUS).map(([v, t]) => h("option", { value: v, selected: v === l.status }, t)));

  // Si el asignado ya no es miembro (p. ej. super_admin), se muestra igual.
  const opts = [...members];
  if (l.assigned_to && !opts.some((m) => m.id === l.assigned_to)) opts.push({ id: l.assigned_to, name: "Otro administrador" });
  const assignSel = h("select", { class: "input", id: "lead-assigned" },
    h("option", { value: "" }, "Sin asignar"),
    ...opts.map((m) => h("option", { value: m.id, selected: m.id === l.assigned_to }, m.name))
  );

  const update = async (patch: Record<string, unknown>, msg: string) => {
    const { error } = await sb!.from("leads").update(patch).eq("id", id).eq("site_id", siteId());
    if (error) { toast(friendlyError(error), "err"); return false; }
    if ("status" in patch) {
      l.status = patch.status;
      statusSel.value = String(patch.status);
      clear(badge).append(statusBadge(l.status));
    }
    toast(msg);
    return true;
  };
  statusSel.addEventListener("change", () => update({ status: statusSel.value }, `Estado: ${STATUS[statusSel.value]}.`));
  assignSel.addEventListener("change", () => update({ assigned_to: assignSel.value || null }, assignSel.value ? "Lead asignado." : "Lead sin asignar."));

  // ---------- notas ----------
  const notesList = h("ul", { class: "notes" });
  const drawNote = (n: any, prepend = false) => {
    const li = h("li", { class: "note" },
      h("p", null, n.note),
      h("span", { class: "muted" }, `${n.profiles?.full_name ?? "Administrador"} · ${fmtDateTime(n.created_at)}`)
    );
    prepend ? notesList.prepend(li) : notesList.append(li);
  };
  const noNotes = h("p", { class: "muted" }, "Sin notas todavía.");
  if (notesR.error) notesList.append(h("li", null, errorBox(friendlyError(notesR.error))));
  else if (!notesR.data?.length) notesList.append(noNotes);
  else (notesR.data as any[]).forEach((n) => drawNote(n));

  const noteIn = h("textarea", { class: "input", id: "lead-note", rows: 3, maxlength: 5000, placeholder: "Llamada, visita, monto cotizado…" });
  const addNote = h("button", { class: "btn btn-primary", type: "button" }, "Añadir nota");
  addNote.addEventListener("click", async () => {
    const note = noteIn.value.trim();
    if (!note) return toast("Escribe la nota.", "err");
    addNote.disabled = true;
    const { data, error } = await sb!.from("lead_notes").insert({ lead_id: id, note }).select("id, note, created_at, profiles(full_name)").single();
    addNote.disabled = false;
    if (error) return toast(friendlyError(error), "err");
    noNotes.remove();
    drawNote(data, true);
    noteIn.value = "";
    toast("Nota añadida.");
  });

  const del = h("button", { class: "btn btn-danger-ghost", type: "button" }, "Eliminar lead");
  del.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Eliminar lead", text: `Se eliminará definitivamente el lead de ${l.name} y sus notas. Si solo no avanzó, mejor márcalo como “Perdido”.`, confirmText: "Eliminar", danger: true, requireWord: "ELIMINAR" });
    if (!ok) return;
    const { error } = await sb!.from("leads").delete().eq("id", id).eq("site_id", siteId());
    if (error) return toast(friendlyError(error), "err");
    toast("Lead eliminado.");
    go(`${ADMIN}/leads`);
  });

  const row = (label: string, value: unknown) => (value === null || value === undefined || value === "" ? null : h("div", { class: "kv" }, h("dt", null, label), h("dd", null, String(value))));
  const svcName = l.services?.name ?? l.service_label;
  const waText = `Hola ${l.name.split(" ")[0]}, te escribimos de ${site().name} por tu solicitud${svcName ? ` de ${svcName}` : ""}.`;
  const assignedName = opts.find((m) => m.id === l.assigned_to)?.name;

  clear(root).append(
    h("div", { class: "page-head" },
      h("div", null, h("a", { class: "back", href: `${ADMIN}/leads` }, "← Leads"), h("h1", null, l.name), h("p", { class: "muted" }, `Recibido: ${fmtDateTime(l.created_at)} · `, badge))
    ),
    h("div", { class: "actions-bar" },
      l.phone ? h("a", { class: "btn btn-wa", href: `${waFor(l.phone)}?text=${encodeURIComponent(waText)}`, target: "_blank", rel: "noopener" }, icon("i-wa"), "Abrir WhatsApp") : null,
      l.phone ? h("a", { class: "btn btn-ghost", href: `tel:${l.phone.replace(/[^\d+]/g, "")}` }, icon("i-phone"), "Llamar") : null,
      l.phone ? h("button", { class: "btn btn-ghost", type: "button", onclick: () => copy(l.phone) }, "Copiar teléfono") : null,
      l.email ? h("a", { class: "btn btn-ghost", href: `mailto:${l.email}?subject=${encodeURIComponent(`Tu solicitud de cotización – ${site().name}`)}` }, icon("i-mail"), "Enviar correo") : null,
      h("span", { class: "actions-sep" }),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => update({ status: "contacted" }, "Marcado como contactado.") }, "Marcar como contactado"),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => update({ status: "won" }, "Cerrado como ganado.") }, "Cerrar: ganado"),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => update({ status: "lost" }, "Cerrado como perdido.") }, "Cerrar: perdido")
    ),
    h("div", { class: "detail-cols" },
      h("div", null,
        h("section", { class: "panel" },
          h("h2", null, "Datos del cliente"),
          h("dl", { class: "kvs" },
            row("Nombre", l.name), row("Empresa", l.company), row("Teléfono", l.phone), row("Correo", l.email),
            row("Servicio", svcName), row("Distrito", l.district), row("Ubicación", l.location),
            row("Área aproximada", l.area_m2 ? `${Number(l.area_m2)} m²` : null),
            row("Asignado a", assignedName)
          ),
          l.message ? h("div", { class: "message" }, h("h3", null, "Mensaje"), h("p", null, l.message)) : null
        ),
        h("section", { class: "panel" },
          h("h2", null, "Notas"),
          h("label", { for: "lead-note", class: "sr-only" }, "Nueva nota"), noteIn,
          h("div", { class: "form-actions" }, addNote),
          notesList
        )
      ),
      h("div", null,
        h("section", { class: "panel" },
          h("h2", null, "Seguimiento"),
          h("label", { for: "lead-status" }, "Estado"), statusSel,
          h("label", { for: "lead-assigned" }, "Asignado a"), assignSel
        ),
        h("section", { class: "panel" },
          h("h2", null, "Origen del lead"),
          h("dl", { class: "kvs" },
            row("Fuente", sourceLabel(l.source)), row("Página de llegada", l.landing_page), row("Referrer", l.referrer),
            row("utm_source", l.utm_source), row("utm_medium", l.utm_medium), row("utm_campaign", l.utm_campaign),
            row("utm_content", l.utm_content), row("utm_term", l.utm_term)
          )
        ),
        h("div", { class: "danger-zone" }, del)
      )
    )
  );
}
