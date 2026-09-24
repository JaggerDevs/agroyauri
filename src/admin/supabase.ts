import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
/** Web de este despliegue (la que se publica con "Publicar cambios"). */
export const SITE_SLUG = import.meta.env.PUBLIC_SITE_SLUG || "agroyauri";

/** Cliente del panel: clave ANÓNIMA pública + sesión del administrador. RLS protege los datos. */
export const sb: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: "agroyauri-admin" },
        realtime: { params: { eventsPerSecond: 1 } },
      })
    : null;

export const configured = !!sb;

export async function accessToken(): Promise<string | null> {
  const { data } = await sb!.auth.getSession();
  return data.session?.access_token ?? null;
}
