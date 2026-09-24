// Capa de datos del BUILD. El navegador del visitante nunca consulta Supabase:
// todo se lee una vez al generar el sitio estático.
// Sin credenciales (desarrollo local / primera vez) usa src/data/seed.json.
import { createClient } from "@supabase/supabase-js";
import rawSeed from "../data/seed.json";
import { expandSeed } from "./seed-expand.mjs";

export type Service = {
  id: string;
  name: string;
  slug: string;
  short_description: string | null;
  description: string | null;
  image_url: string | null;
  icon: string | null;
  price_type: "fixed" | "from" | "per_m2" | "quote";
  price_from: number | null;
  price_unit: string | null;
  show_price: boolean;
  show_in_home: boolean;
  sort_order: number;
  seo_title: string | null;
  seo_description: string | null;
  updated_at?: string;
};

export type Project = {
  id: string;
  title: string;
  slug: string;
  client: string | null;
  location: string | null;
  service_id: string | null;
  short_description: string | null;
  description: string | null;
  featured_image: string | null;
  gallery: string[];
  before_image: string | null;
  after_image: string | null;
  is_featured: boolean;
  sort_order: number;
  seo_title: string | null;
  seo_description: string | null;
  updated_at?: string;
};

export type Category = { id: string; name: string; slug: string; sort_order: number };

export type Product = {
  id: string;
  name: string;
  slug: string;
  category_id: string | null;
  description: string | null;
  image_url: string | null;
  price: number | null;
  price_unit: string | null;
  show_price: boolean;
  available: boolean;
  featured: boolean;
  sort_order: number;
  updated_at?: string;
};

export type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  featured_image: string | null;
  author: string | null;
  published_at: string | null;
  seo_title: string | null;
  seo_description: string | null;
  updated_at?: string;
};

export type Plan = {
  name: string;
  subtitle: string;
  icon: "leaf" | "gear";
  price: number | null;
  price_label: string;
  show_price: boolean;
  featured: boolean;
  features: string[];
};

export type Settings = {
  contact: {
    company: string;
    legal_name: string;
    phones: string[];
    whatsapp: string;
    email: string;
    city: string;
    region: string;
    country: string;
    ruc: string;
    tagline: string;
  };
  social: { facebook?: string; instagram?: string; linkedin?: string };
  plans: { title: string; note: string; items: Plan[] };
};

export type SiteData = {
  settings: Settings;
  services: Service[];
  projects: Project[];
  categories: Category[];
  products: Product[];
  posts: BlogPost[];
  source: "supabase" | "seed";
};

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
/** Web que genera este build (tabla public.sites). */
export const SITE_SLUG = import.meta.env.PUBLIC_SITE_SLUG || "agroyauri";

function fromSeed(): SiteData {
  const s = expandSeed(rawSeed as any);
  const services = s.services.map((x: any) => ({ ...x, id: `seed-svc-${x.slug}` }));
  const bySlug = new Map(services.map((x: any) => [x.slug, x.id]));
  const categories = s.categories.map((c: any) => ({ ...c, id: `seed-cat-${c.slug}` }));
  const catBySlug = new Map(categories.map((c: any) => [c.slug, c.id]));
  return {
    settings: s.site_settings as Settings,
    services,
    projects: s.projects
      .filter((p: any) => p.is_published)
      .map((p: any) => ({ ...p, id: `seed-prj-${p.slug}`, service_id: bySlug.get(p.service_slug) ?? null })),
    categories,
    products: s.products
      .filter((p: any) => p.is_published)
      .map((p: any) => ({ ...p, id: `seed-prd-${p.slug}`, category_id: catBySlug.get(p.category_slug) ?? null })),
    posts: s.blog_posts.filter((b: any) => b.is_published && b.published_at),
    source: "seed",
  };
}

async function fromSupabase(): Promise<SiteData> {
  const sb = createClient(url!, key!, { auth: { persistSession: false } });
  const ok = <T>(r: { data: T | null; error: any }, what: string): T => {
    // Si Supabase falla, el build falla: Cloudflare mantiene publicada la versión anterior.
    if (r.error) throw new Error(`Supabase (${what}): ${r.error.message}`);
    return r.data as T;
  };

  // Multi-site: todo se filtra por la web de este build.
  const siteR = await sb.from("sites").select("id").eq("slug", SITE_SLUG).eq("is_active", true).maybeSingle();
  const site = ok(siteR, "sites") as { id: string } | null;
  if (!site) throw new Error(`Supabase: no existe una web activa con slug "${SITE_SLUG}" (PUBLIC_SITE_SLUG).`);

  const [settingsR, servicesR, projectsR, categoriesR, productsR, postsR] = await Promise.all([
    sb.from("site_settings").select("key, value").eq("site_id", site.id),
    sb
      .from("services")
      .select("id, name, slug, short_description, description, image_url, icon, price_type, price_from, price_unit, show_price, show_in_home, sort_order, seo_title, seo_description, updated_at")
      .eq("site_id", site.id)
      .eq("is_active", true)
      .order("sort_order"),
    sb
      .from("projects")
      .select("id, title, slug, client, location, service_id, short_description, description, featured_image, gallery, before_image, after_image, is_featured, sort_order, seo_title, seo_description, updated_at")
      .eq("site_id", site.id)
      .eq("is_published", true)
      .order("sort_order"),
    sb.from("categories").select("id, name, slug, sort_order").eq("site_id", site.id).order("sort_order"),
    sb
      .from("products")
      .select("id, name, slug, category_id, description, image_url, price, price_unit, show_price, available, featured, sort_order, updated_at")
      .eq("site_id", site.id)
      .eq("is_published", true)
      .order("sort_order"),
    sb
      .from("blog_posts")
      .select("id, title, slug, excerpt, content, featured_image, author, published_at, seo_title, seo_description, updated_at")
      .eq("site_id", site.id)
      .eq("is_published", true)
      .lte("published_at", new Date().toISOString())
      .order("published_at", { ascending: false }),
  ]);

  const seed = fromSeed().settings;
  const kv = Object.fromEntries(ok(settingsR, "site_settings").map((r: any) => [r.key, r.value]));
  return {
    settings: {
      contact: { ...seed.contact, ...(kv.contact ?? {}) },
      social: { ...seed.social, ...(kv.social ?? {}) },
      plans: kv.plans ?? seed.plans,
    },
    services: ok(servicesR, "services").map((s: any) => ({ ...s, price_from: s.price_from === null ? null : Number(s.price_from) })),
    projects: ok(projectsR, "projects"),
    categories: ok(categoriesR, "categories"),
    products: ok(productsR, "products").map((p: any) => ({ ...p, price: p.price === null ? null : Number(p.price) })),
    posts: ok(postsR, "blog_posts"),
    source: "supabase",
  };
}

let cache: Promise<SiteData> | null = null;

/** Datos del sitio (una sola descarga por build). */
export function getSiteData(): Promise<SiteData> {
  if (!cache) {
    cache = url && key ? fromSupabase() : Promise.resolve(fromSeed());
    cache.then((d) => {
      if (d.source === "seed") console.warn("[agroyauri] Sin credenciales de Supabase: usando src/data/seed.json");
    });
  }
  return cache;
}
