// @ts-check
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import redirects from "./src/integrations/redirects.mjs";

const env = loadEnv(process.env.NODE_ENV ?? "production", process.cwd(), "");
const supabaseHost = env.PUBLIC_SUPABASE_URL ? new URL(env.PUBLIC_SUPABASE_URL).hostname : null;

export default defineConfig({
  // URL pública definitiva (dominio propio o *.pages.dev). Se usa en canonical, sitemap y Open Graph.
  site: env.PUBLIC_SITE_URL || "https://agroyauri.pages.dev",
  output: "static",
  trailingSlash: "never",
  build: {
    format: "file", // /servicios/riego-tecnificado-lima.html → servido como /servicios/riego-tecnificado-lima
    inlineStylesheets: "never",
  },
  image: {
    // Imágenes subidas desde el panel (Supabase Storage) también se optimizan en el build.
    domains: supabaseHost ? [supabaseHost] : [],
  },
  prefetch: false,
  integrations: [redirects({ env })],
  vite: {
    build: { assetsInlineLimit: 2048 },
  },
});
