// Subida de imágenes: se redimensionan y comprimen EN EL NAVEGADOR (WebP ≤1600px)
// antes de subirlas a Supabase Storage. Nunca se sube una foto de 10 MB.
import { sb } from "./supabase";
import { siteId } from "./site";

const MAX_INPUT = 20 * 1024 * 1024; // archivo original aceptado
const MAX_OUTPUT = 4.5 * 1024 * 1024; // límite del bucket: 5 MB

export async function compressImage(file: File, maxW = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("El archivo no es una imagen.");
  if (file.size > MAX_INPUT) throw new Error("La imagen supera 20 MB. Usa una foto más liviana.");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.round(bmp.width * scale);
  const hgt = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = hgt;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, hgt);
  bmp.close();
  let q = quality;
  let blob: Blob | null = null;
  while (q >= 0.5) {
    blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/webp", q));
    if (blob && blob.size <= MAX_OUTPUT) break;
    q -= 0.1;
  }
  if (!blob || blob.size > MAX_OUTPUT) throw new Error("No se pudo comprimir la imagen por debajo de 5 MB.");
  return blob;
}

/** Comprime y sube; devuelve la URL pública. */
export async function uploadImage(bucket: "projects" | "products" | "blog", file: File, prefix = ""): Promise<string> {
  const blob = await compressImage(file);
  const d = new Date();
  // Cada web en su carpeta: <site_id>/<sección>/archivo.webp (lo exige la política de Storage).
  const path = `${siteId()}/${prefix ? prefix.replace(/[^a-z0-9-]/g, "") + "/" : ""}${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}-${crypto.randomUUID().slice(0, 8)}.webp`;
  const { error } = await sb!.storage.from(bucket).upload(path, blob, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
  if (error) throw new Error(error.message);
  return sb!.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// Vista previa de imágenes locales del proyecto (/media/...): el build publica
// /admin-media.json con miniaturas optimizadas.
let mediaMap: Promise<Record<string, string>> | null = null;
export function previewUrl(src: string | null | undefined): Promise<string | null> {
  if (!src) return Promise.resolve(null);
  if (/^https?:\/\//.test(src)) return Promise.resolve(src);
  if (!mediaMap) mediaMap = fetch("/admin-media.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return mediaMap.then((m) => m[src] ?? null);
}
