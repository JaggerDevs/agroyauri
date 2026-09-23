// Normaliza src/data/seed.json a la forma exacta de las filas de Supabase.
// Lo usan el generador de seed.sql y el build (cuando no hay credenciales).

const pad = (n) => String(n).padStart(2, "0");

export function expandSeed(raw) {
  const services = raw.services.map((s) => ({
    price_type: "quote",
    price_from: null,
    price_unit: null,
    show_price: false,
    is_active: true,
    seo_title: null,
    seo_description: null,
    ...s,
  }));

  const projects = raw.projects.map((p) => {
    const gallery = Array.from({ length: p.count }, (_, i) => `/media/projects/${p.dir}/${pad(i + 1)}.jpg`);
    const { dir, count, before, after, ...rest } = p;
    return {
      is_published: true,
      seo_title: null,
      seo_description: null,
      ...rest,
      featured_image: gallery[0],
      gallery,
      before_image: before ? gallery[before - 1] : null,
      after_image: after ? gallery[after - 1] : null,
    };
  });

  const products = raw.products.map((p) => ({
    price: null,
    price_unit: null,
    show_price: false,
    available: true,
    is_published: true,
    seo_title: null,
    seo_description: null,
    ...p,
  }));

  const blog_posts = raw.blog_posts.map((b) => ({
    featured_image: null,
    published_at: null,
    seo_title: null,
    seo_description: null,
    ...b,
  }));

  const redirects = [
    { from_path: "/servicios/fumigacion-lima", to_path: "/servicios/fumigacion-control-plagas-lima" },
    { from_path: "/servicios/control-plagas-lima", to_path: "/servicios/fumigacion-control-plagas-lima" },
  ];

  return {
    site_settings: raw.site_settings,
    categories: raw.categories,
    services,
    projects,
    products,
    blog_posts,
    redirects,
  };
}
