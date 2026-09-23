// /sitemap.xml — generado en cada build con el contenido publicado.
import type { APIRoute } from "astro";
import { getSiteData } from "../lib/data";

export const GET: APIRoute = async ({ site }) => {
  const { services, projects, posts } = await getSiteData();
  const now = new Date().toISOString();
  const urls: { loc: string; lastmod?: string; priority: string }[] = [
    { loc: "/", priority: "1.0" },
    { loc: "/servicios", priority: "0.9" },
    ...services.map((s) => ({ loc: `/servicios/${s.slug}`, lastmod: s.updated_at, priority: "0.9" })),
    { loc: "/proyectos", priority: "0.8" },
    ...projects.map((p) => ({ loc: `/proyectos/${p.slug}`, lastmod: p.updated_at, priority: "0.7" })),
    { loc: "/productos", priority: "0.7" },
    { loc: "/nosotros", priority: "0.6" },
    { loc: "/contacto", priority: "0.6" },
    ...(posts.length ? [{ loc: "/blog", priority: "0.6" }] : []),
    ...posts.map((p) => ({ loc: `/blog/${p.slug}`, lastmod: p.updated_at || p.published_at || undefined, priority: "0.6" })),
  ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map((u) => `  <url><loc>${new URL(u.loc, site).href}</loc><lastmod>${(u.lastmod ?? now).slice(0, 10)}</lastmod><priority>${u.priority}</priority></url>`)
      .join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
