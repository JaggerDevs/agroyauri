// Resuelve las rutas de imagen guardadas en la base de datos:
//  - "/media/..."  → archivo local en src/assets/media (optimizado por Astro)
//  - "https://..." → imagen subida a Supabase Storage (optimizada en el build)
import type { ImageMetadata } from "astro";

const local = import.meta.glob<{ default: ImageMetadata }>("/src/assets/media/**/*.{jpg,jpeg,png,webp}", { eager: true });

export function resolveImage(src: string | null | undefined): ImageMetadata | string | null {
  if (!src) return null;
  if (src.startsWith("/media/")) {
    const hit = local[`/src/assets${src}`];
    if (!hit) console.warn(`[media] No existe src/assets${src}`);
    return hit?.default ?? null;
  }
  // https en producción; http solo para el emulador local (127.0.0.1)
  if (/^https:\/\//.test(src) || /^http:\/\/127\.0\.0\.1[:/]/.test(src)) return src;
  return null;
}
