// Genera dist/_redirects (Cloudflare Pages) con las redirecciones 301 guardadas
// en Supabase (tabla redirects) cuando el administrador cambia un slug.
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export default function redirects({ env }) {
  return {
    name: "agroyauri-redirects",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        let rows = [];
        const url = env.PUBLIC_SUPABASE_URL;
        const key = env.PUBLIC_SUPABASE_ANON_KEY;
        if (url && key) {
          const slug = encodeURIComponent(env.PUBLIC_SITE_SLUG || "agroyauri");
          const res = await fetch(`${url}/rest/v1/redirects?select=from_path,to_path,sites!inner(slug)&sites.slug=eq.${slug}`, {
            headers: { apikey: key, Authorization: `Bearer ${key}` },
          });
          if (!res.ok) throw new Error(`Supabase redirects: HTTP ${res.status}`);
          rows = await res.json();
        } else {
          const { expandSeed } = await import("../lib/seed-expand.mjs");
          const seed = JSON.parse(readFileSync(new URL("../data/seed.json", import.meta.url), "utf8"));
          rows = expandSeed(seed).redirects;
        }
        const lines = [
          "# Generado en el build — no editar a mano",
          "/nosotros/ /nosotros 301",
          // Panel: /admin/leads, /admin/leads/<id>… los resuelve el JS de /admin.
          "/admin/* /admin 200",
          ...rows.filter((r) => r.from_path !== r.to_path).map((r) => `${r.from_path} ${r.to_path} 301`),
        ];
        writeFileSync(fileURLToPath(new URL("_redirects", dir)), lines.join("\n") + "\n");
        logger.info(`_redirects: ${rows.length} redirección(es) desde ${url && key ? "Supabase" : "seed"}`);
      },
    },
  };
}
