// Dashboard: 1 llamada RPC para todas las métricas + 1 consulta de últimos leads.
import { sb } from "../supabase";
import { h, clear, loading, errorBox, friendlyError, statusBadge, sourceLabel, fmtDateTime, fmtDay, icon } from "../ui";

export async function renderDashboard(root: HTMLElement) {
  clear(root).append(
    h("div", { class: "page-head" },
      h("h1", null, "Dashboard"),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => renderDashboard(root) }, icon("i-refresh"), "Actualizar")
    ),
    loading()
  );

  const [stats, latest] = await Promise.all([
    sb!.rpc("admin_lead_stats", { days: 30 }),
    sb!.from("leads").select("id, name, service_label, district, source, created_at, status, services(name)").order("created_at", { ascending: false }).limit(8),
  ]);
  root.querySelector(".loading")?.remove();
  if (stats.error) return root.append(errorBox(friendlyError(stats.error)));
  const s = stats.data as { today: number; week: number; month: number; new: number; quotation_sent: number; won: number; daily: { day: string; n: number }[] };

  const kpi = (label: string, value: number, href: string, accent = false) =>
    h("a", { class: `kpi ${accent ? "kpi-accent" : ""}`, href }, h("span", { class: "kpi-value" }, value), h("span", { class: "kpi-label" }, label));

  root.append(
    h("div", { class: "kpis" },
      kpi("Leads de hoy", s.today, "#/leads?from=today"),
      kpi("Leads esta semana", s.week, "#/leads?from=week"),
      kpi("Leads este mes", s.month, "#/leads?from=month"),
      kpi("Leads nuevos (sin atender)", s.new, "#/leads?status=new", s.new > 0),
      kpi("Cotizaciones enviadas", s.quotation_sent, "#/leads?status=quotation_sent"),
      kpi("Clientes ganados", s.won, "#/leads?status=won")
    ),
    h("section", { class: "panel" }, h("h2", null, "Leads por día (últimos 30 días)"), chart(s.daily)),
    h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", null, "Últimos leads"), h("a", { class: "btn btn-sm btn-ghost", href: "#/leads" }, "Ver todos")),
      latest.error
        ? errorBox(friendlyError(latest.error))
        : !latest.data?.length
          ? h("p", { class: "empty" }, "Aún no hay leads. Cuando alguien envíe el formulario aparecerá aquí.")
          : h("div", { class: "table-wrap" },
              h("table", { class: "table" },
                h("thead", null, h("tr", null, ...["Nombre", "Servicio", "Distrito", "Origen", "Fecha", "Estado"].map((t) => h("th", null, t)))),
                h("tbody", null,
                  ...(latest.data as any[]).map((l) =>
                    h("tr", { class: "row-link", onclick: () => (location.hash = `#/leads/${l.id}`) },
                      h("td", { "data-label": "Nombre" }, h("a", { href: `#/leads/${l.id}` }, l.name)),
                      h("td", { "data-label": "Servicio" }, l.services?.name ?? l.service_label ?? "—"),
                      h("td", { "data-label": "Distrito" }, l.district ?? "—"),
                      h("td", { "data-label": "Origen" }, sourceLabel(l.source)),
                      h("td", { "data-label": "Fecha" }, fmtDateTime(l.created_at)),
                      h("td", { "data-label": "Estado" }, statusBadge(l.status))
                    )
                  )
                )
              )
            )
    )
  );
}

/** Gráfico de barras en SVG puro (sin librerías). */
function chart(daily: { day: string; n: number }[]) {
  const NS = "http://www.w3.org/2000/svg";
  const W = 720, H = 200, P = 26;
  const max = Math.max(1, ...daily.map((d) => d.n));
  const bw = (W - P * 2) / Math.max(daily.length, 1);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Leads por día: total ${daily.reduce((a, d) => a + d.n, 0)} en ${daily.length} días`);
  const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    svg.appendChild(e);
    return e;
  };
  for (const t of [0, 0.5, 1]) {
    const y = H - P - t * (H - P * 2);
    el("line", { x1: P, x2: W - P, y1: y, y2: y, class: "grid" });
    el("text", { x: P - 6, y: y + 4, class: "axis", "text-anchor": "end" }, String(Math.round(max * t)));
  }
  daily.forEach((d, i) => {
    const bh = (d.n / max) * (H - P * 2);
    const x = P + i * bw + bw * 0.18;
    const rect = el("rect", { x, y: H - P - bh, width: bw * 0.64, height: Math.max(bh, d.n ? 2 : 0), rx: 3, class: "bar" });
    const title = document.createElementNS(NS, "title");
    title.textContent = `${fmtDay(d.day)}: ${d.n} lead${d.n === 1 ? "" : "s"}`;
    rect.appendChild(title);
    if (i % 5 === 0 || i === daily.length - 1) el("text", { x: x + bw * 0.32, y: H - 6, class: "axis", "text-anchor": "middle" }, fmtDay(d.day));
  });
  return svg;
}
