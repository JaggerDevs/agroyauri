// Mapa /media/... → miniatura optimizada, para las vistas previas del panel.
// (Las imágenes locales del proyecto no se publican con su ruta original.)
import type { APIRoute } from "astro";
import type { ImageMetadata } from "astro";
import { getImage } from "astro:assets";

const local = import.meta.glob<{ default: ImageMetadata }>("/src/assets/media/**/*.{jpg,jpeg,png,webp}", { eager: true });

export const GET: APIRoute = async () => {
  const out: Record<string, string> = {};
  for (const [path, mod] of Object.entries(local)) {
    const img = await getImage({ src: mod.default, width: 320, format: "webp", quality: 70 });
    out[path.replace("/src/assets", "")] = img.src;
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
};
