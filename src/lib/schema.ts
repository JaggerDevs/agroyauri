// Datos estructurados Schema.org — solo con información real (configuración del sitio).
import type { Settings, Service, Project, BlogPost } from "./data";

export function organization(settings: Settings, site: URL) {
  const c = settings.contact;
  const sameAs = Object.values(settings.social).filter((v): v is string => !!v);
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": new URL("/#organizacion", site).href,
    name: c.company,
    legalName: c.legal_name,
    url: site.href,
    logo: new URL("/favicon.png", site).href,
    image: new URL("/og-default.jpg", site).href,
    telephone: c.phones.map((p) => `+51 ${p}`),
    email: c.email,
    taxID: c.ruc,
    address: { "@type": "PostalAddress", addressLocality: c.city, addressRegion: c.region, addressCountry: c.country },
    areaServed: { "@type": "City", name: "Lima" },
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export function breadcrumbs(site: URL, items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: new URL(it.path, site).href,
    })),
  };
}

export function service(s: Service, site: URL, image?: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: s.name,
    description: s.seo_description || s.short_description || undefined,
    url: new URL(`/servicios/${s.slug}`, site).href,
    serviceType: s.name,
    areaServed: { "@type": "City", name: "Lima" },
    provider: { "@id": new URL("/#organizacion", site).href },
    ...(image ? { image } : {}),
  };
}

export function article(p: BlogPost, site: URL, image?: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: p.title,
    description: p.seo_description || p.excerpt || undefined,
    datePublished: p.published_at || undefined,
    dateModified: p.updated_at || p.published_at || undefined,
    author: { "@type": "Organization", name: p.author || "AGROYAURI SAC" },
    publisher: { "@id": new URL("/#organizacion", site).href },
    mainEntityOfPage: new URL(`/blog/${p.slug}`, site).href,
    ...(image ? { image } : {}),
  };
}

export function projectPage(p: Project, site: URL, image?: string) {
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: p.title,
    description: p.seo_description || p.short_description || undefined,
    url: new URL(`/proyectos/${p.slug}`, site).href,
    creator: { "@id": new URL("/#organizacion", site).href },
    ...(p.location ? { locationCreated: { "@type": "Place", name: p.location } } : {}),
    ...(image ? { image } : {}),
  };
}
