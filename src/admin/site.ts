// Web (site) que se está administrando. Un admin normal solo tiene las suyas;
// el super_admin puede cambiar de web. La seguridad real está en RLS: esto solo
// decide qué site_id se envía en las consultas.
export type Site = { id: string; name: string; slug: string };

const KEY = "ay_admin_site";
let current: Site | null = null;
let all: Site[] = [];

export function setSites(list: Site[], preferredSlug: string) {
  all = list;
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  current = list.find((s) => s.id === saved) ?? list.find((s) => s.slug === preferredSlug) ?? list[0] ?? null;
}

export function selectSite(id: string) {
  const s = all.find((x) => x.id === id);
  if (!s) return;
  current = s;
  try { localStorage.setItem(KEY, id); } catch {}
  window.dispatchEvent(new CustomEvent("site-changed"));
}

export const sites = () => all;
export const site = () => current!;
export const siteId = () => current!.id;
