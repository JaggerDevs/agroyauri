// Navegación del panel con rutas reales (/admin/leads, /admin/leads/<id>…).
// Cloudflare sirve /admin para cualquier /admin/* (regla 200 en _redirects).
export const ADMIN = "/admin";

/** Navega sin recargar la página. */
export function go(path: string) {
  if (location.pathname + location.search !== path) history.pushState(null, "", path);
  window.dispatchEvent(new Event("admin:navigate"));
}
