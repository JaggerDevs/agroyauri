// Panel /admin: login con Supabase Auth, webs (sites) del usuario y rutas /admin/<sección>.
import { sb, configured, SITE_SLUG } from "./supabase";
import { h, clear, icon, toast, errorBox, friendlyError, loading } from "./ui";
import { pending, publish } from "./publish";
import { ENTITIES } from "./entities";
import { renderList, renderForm } from "./crud";
import { renderDashboard } from "./views/dashboard";
import { renderLeads, renderLead } from "./views/leads";
import { renderPrices } from "./views/prices";
import { renderSettings } from "./views/settings";
import { ADMIN, go } from "./nav";
import { setSites, sites, site, selectSite, type Site } from "./site";

const app = document.getElementById("app")!;

const MENU: { key: string; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "i-chart" },
  { key: "leads", label: "Leads", icon: "i-inbox" },
  { key: "services", label: "Servicios", icon: "i-leaf" },
  { key: "projects", label: "Proyectos", icon: "i-image" },
  { key: "products", label: "Productos", icon: "i-box" },
  { key: "prices", label: "Precios", icon: "i-tag" },
  { key: "blog", label: "Blog", icon: "i-doc" },
  { key: "settings", label: "Configuración", icon: "i-gear-sm" },
];

// ---------------------------------------------------------------- login
function renderLogin(message?: string) {
  const email = h("input", { class: "input", type: "email", id: "email", autocomplete: "username", required: true });
  const pass = h("input", { class: "input", type: "password", id: "password", autocomplete: "current-password", required: true });
  const btn = h("button", { class: "btn btn-primary btn-block", type: "submit" }, "Ingresar");
  const status = h("p", { class: "login-status", role: "alert" }, message ?? "");
  const form = h("form", { class: "login-card" },
    h("div", { class: "login-brand" }, h("img", { src: "/favicon.png", alt: "", width: 44, height: 44 }), h("div", null, h("strong", null, "AGROYAURI SAC"), h("span", null, "Panel de administración"))),
    h("label", { for: "email" }, "Correo"), email,
    h("label", { for: "password" }, "Contraseña"), pass,
    btn, status,
    h("a", { class: "login-back", href: "/" }, "← Volver a la web")
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = "Ingresando…";
    status.textContent = "";
    const { error } = await sb!.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    btn.disabled = false;
    btn.textContent = "Ingresar";
    if (error) {
      status.textContent = /Invalid login/i.test(error.message) ? "Correo o contraseña incorrectos." : friendlyError(error);
      return;
    }
    boot();
  });
  clear(app).append(h("main", { class: "login-wrap" }, form));
  email.focus();
}

// ---------------------------------------------------------------- shell
let content: HTMLElement;
let adminName = "";

function renderShell() {
  const nav = h("nav", { class: "side-nav", "aria-label": "Panel" },
    ...MENU.map((m) => h("a", { href: `${ADMIN}/${m.key}`, "data-key": m.key }, icon(m.icon), h("span", null, m.label)))
  );
  // Selector de web: solo si el usuario administra más de una (p. ej. super_admin).
  const siteSel = sites().length > 1
    ? h("select", { class: "input site-select", "aria-label": "Web", onchange: (e: Event) => selectSite((e.target as HTMLSelectElement).value) },
        ...sites().map((s) => h("option", { value: s.id, selected: s.id === site().id }, s.name)))
    : h("span", { class: "site-name" }, site().name);
  const publishBtn = h("button", { class: "btn btn-publish", type: "button", hidden: true }, icon("i-upload"), h("span", null, "Publicar cambios"));
  const pendingInfo = h("span", { class: "pending-info", hidden: true });
  const refreshPending = () => {
    // Este despliegue solo puede publicar SU web; las demás se publican desde su propio panel.
    const p = site().slug === SITE_SLUG ? pending() : [];
    publishBtn.hidden = p.length === 0;
    pendingInfo.hidden = p.length === 0;
    pendingInfo.textContent = p.length ? `Cambios sin publicar: ${p.join(", ")}` : "";
  };
  publishBtn.addEventListener("click", async () => {
    publishBtn.disabled = true;
    await publish();
    publishBtn.disabled = false;
  });
  window.addEventListener("pending-changed", refreshPending);
  window.addEventListener("storage", refreshPending);
  window.addEventListener("site-changed", () => { refreshPending(); route(); });

  const menuBtn = h("button", { class: "menu-btn", type: "button", "aria-label": "Menú", onclick: () => document.body.classList.toggle("nav-open") }, h("span"), h("span"), h("span"));
  content = h("main", { class: "content", id: "content", tabindex: "-1" });
  clear(app).append(
    h("div", { class: "shell" },
      h("aside", { class: "sidebar" },
        h("a", { class: "side-brand", href: `${ADMIN}/dashboard` }, h("img", { src: "/favicon.png", alt: "", width: 34, height: 34 }), h("span", null, "PANEL WEB")),
        nav,
        h("div", { class: "side-foot" },
          h("a", { href: "/", target: "_blank", rel: "noopener" }, icon("i-external"), "Ver la web"),
          h("button", { type: "button", onclick: async () => { await sb!.auth.signOut(); history.replaceState(null, "", ADMIN); renderLogin("Sesión cerrada."); } }, icon("i-logout"), "Cerrar sesión")
        )
      ),
      h("div", { class: "main-col" },
        h("header", { class: "topbar" }, menuBtn, siteSel, h("span", { class: "hello" }, `Hola, ${adminName}`), pendingInfo, publishBtn),
        content
      )
    )
  );
  nav.addEventListener("click", () => document.body.classList.remove("nav-open"));
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (document.body.classList.contains("nav-open") && !t.closest(".sidebar") && !t.closest(".menu-btn")) document.body.classList.remove("nav-open");
  });
  refreshPending();
}

// ---------------------------------------------------------------- router
async function route() {
  const path = location.pathname.replace(/^\/admin\/?/, "").replace(/\/+$/, "") || "dashboard";
  const [section, id] = path.split("/");
  const params = new URLSearchParams(location.search);
  const active = section === "categories" ? "products" : section;
  document.querySelectorAll<HTMLAnchorElement>(".side-nav a").forEach((a) => a.classList.toggle("active", a.dataset.key === active));
  document.title = `${MENU.find((m) => m.key === active)?.label ?? "Panel"} · ${site().name}`;

  try {
    if (section === "dashboard") return await renderDashboard(content);
    if (section === "leads") return id ? await renderLead(content, id) : await renderLeads(content, params);
    if (section === "prices") return await renderPrices(content);
    if (section === "settings") return await renderSettings(content);
    const ent = ENTITIES[section];
    if (ent) {
      if (id) return await renderForm(content, ent, id);
      await renderList(content, ent);
      if (section === "products" || section === "categories") {
        content.querySelector(".page-head")?.after(
          h("div", { class: "tabs" },
            h("a", { href: `${ADMIN}/products`, class: section === "products" ? "active" : "" }, "Productos"),
            h("a", { href: `${ADMIN}/categories`, class: section === "categories" ? "active" : "" }, "Categorías")
          )
        );
      }
      return;
    }
    clear(content).append(errorBox("Sección no encontrada."));
  } catch (e) {
    clear(content).append(errorBox(friendlyError(e as Error)));
  } finally {
    content.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

// ---------------------------------------------------------------- arranque
async function boot() {
  if (!configured) {
    clear(app).append(h("main", { class: "login-wrap" }, h("div", { class: "login-card" }, h("h1", null, "Panel no configurado"), h("p", null, "Faltan PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY en el build. Ver docs/SUPABASE.md."))));
    return;
  }
  clear(app).append(h("main", { class: "login-wrap" }, loading("Verificando sesión…")));
  const { data } = await sb!.auth.getSession();
  if (!data.session) return renderLogin();

  // Rol + webs asignadas. RLS vuelve a exigir lo mismo en cada consulta.
  const [{ data: profile, error }, sitesR] = await Promise.all([
    sb!.from("profiles").select("role, full_name").eq("id", data.session.user.id).maybeSingle(),
    sb!.rpc("admin_sites"),
  ]);
  const list = (sitesR.data ?? []) as Site[];
  if (error || sitesR.error || !profile || profile.role === "pending" || list.length === 0) {
    await sb!.auth.signOut();
    return renderLogin(error || sitesR.error ? friendlyError(error ?? sitesR.error) : "Tu cuenta no tiene permisos para administrar ninguna web.");
  }
  setSites(list, SITE_SLUG);
  adminName = profile.full_name || data.session.user.email || "Admin";

  // Enlaces antiguos /admin#/leads → /admin/leads
  if (location.hash.startsWith("#/")) history.replaceState(null, "", `${ADMIN}/${location.hash.slice(2)}`);
  renderShell();
  window.addEventListener("popstate", route);
  window.addEventListener("admin:navigate", route);
  // Enlaces internos del panel: navegación sin recargar.
  document.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a || a.target || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = a.getAttribute("href") ?? "";
    if (href === ADMIN || href.startsWith(`${ADMIN}/`) || href.startsWith(`${ADMIN}?`)) {
      e.preventDefault();
      go(href);
    }
  });
  route();
}

sb?.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" && document.querySelector(".shell")) {
    toast("Tu sesión terminó. Vuelve a ingresar.", "info");
    renderLogin();
  }
});

boot();
