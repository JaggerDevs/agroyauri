// "Publicar cambios": el contenido público es estático. Tras editar, el admin
// dispara UN rebuild (Cloudflare deploy hook) en vez de uno por cada guardado:
// así se respeta el límite de builds del plan gratuito.
import { accessToken } from "./supabase";
import { toast } from "./ui";

const KEY = "ay_pending_changes";

export function markPending(what: string) {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!list.includes(what)) list.push(what);
    localStorage.setItem(KEY, JSON.stringify(list.slice(-20)));
  } catch {}
  window.dispatchEvent(new CustomEvent("pending-changed"));
}

export function pending(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}

export async function publish(): Promise<boolean> {
  const token = await accessToken();
  const res = await fetch("/api/rebuild", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) {
    toast(data.error || "No se pudo iniciar la publicación.", "err", 6000);
    return false;
  }
  try { localStorage.removeItem(KEY); } catch {}
  window.dispatchEvent(new CustomEvent("pending-changed"));
  toast("Publicando… la web se actualizará en 1–3 minutos.", "ok", 6000);
  return true;
}
