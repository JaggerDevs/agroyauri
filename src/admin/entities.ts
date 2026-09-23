// Configuración de cada tabla administrable (lo que ve y edita el panel).
import type { Entity, Field } from "./crud";
import { soles } from "./ui";

const seo: Field[] = [
  { name: "seo_title", label: "Título SEO", type: "text", max: 70, section: "SEO", help: "Lo que aparece en Google. Si lo dejas vacío se genera automáticamente." },
  { name: "seo_description", label: "Descripción SEO", type: "textarea", max: 170, help: "Resumen de 1–2 frases para Google (máx. 170)." },
];

export const PRICE_TYPES: [string, string][] = [
  ["quote", "Solicitar cotización (sin precio)"],
  ["from", "Desde S/ …"],
  ["per_m2", "Precio por m²"],
  ["fixed", "Precio fijo"],
];

export const ICONS: [string, string][] = [
  ["paisajismo", "Hoja (paisajismo)"],
  ["mantenimiento", "Tijeras (mantenimiento)"],
  ["riego", "Gota (riego)"],
  ["plagas", "Insecto (plagas)"],
  ["saneamiento", "Tacho (saneamiento)"],
  ["insumos", "Envase (insumos)"],
  ["plantas", "Planta (ornamentales)"],
];

export const services: Entity = {
  key: "services",
  table: "services",
  title: "Servicios",
  singular: "Servicio",
  listSelect: "id, name, slug, price_type, price_from, show_price, show_in_home, is_active, image_url",
  order: [{ column: "sort_order" }, { column: "name" }],
  thumbField: "image_url",
  columns: [
    { label: "Servicio", get: (r) => r.name },
    { label: "URL", get: (r) => `/servicios/${r.slug}` },
    { label: "Precio", get: (r) => (r.show_price && r.price_type !== "quote" ? soles(r.price_from) : "Cotización") },
    { label: "En el inicio", get: (r) => (r.show_in_home ? "Sí" : "No") },
  ],
  nameField: "name",
  publicPath: (s) => `/servicios/${s}`,
  toggle: { field: "is_active", on: "Activo", off: "Inactivo" },
  canDelete: false, // se desactivan: los leads históricos apuntan al servicio
  fields: [
    { name: "name", label: "Nombre", type: "text", required: true, max: 120, section: "Contenido" },
    { name: "slug", label: "Slug (URL)", type: "slug", required: true, help: "Ej.: riego-tecnificado-lima → /servicios/riego-tecnificado-lima. Cambiarlo afecta al SEO." },
    { name: "short_description", label: "Descripción corta", type: "textarea", max: 300, help: "Se muestra en las tarjetas." },
    { name: "description", label: "Descripción completa", type: "markdown" },
    { name: "image_url", label: "Imagen", type: "image", bucket: "projects" },
    { name: "icon", label: "Ícono", type: "select", options: ICONS },
    { name: "sort_order", label: "Orden", type: "number" },
    { name: "show_in_home", label: "Mostrar en el inicio (máx. 6)", type: "bool" },
    { name: "is_active", label: "Activo (visible en la web)", type: "bool" },
    { name: "price_type", label: "Tipo de precio", type: "select", options: PRICE_TYPES, required: true, section: "Precio" },
    { name: "price_from", label: "Precio (S/)", type: "money" },
    { name: "price_unit", label: "Unidad", type: "text", max: 30, help: "Ej.: m², mes, visita." },
    { name: "show_price", label: "Mostrar precio en la web", type: "bool" },
    ...seo,
  ],
};

export const projects: Entity = {
  key: "projects",
  table: "projects",
  title: "Proyectos",
  singular: "Proyecto",
  listSelect: "id, title, slug, client, location, is_featured, is_published, featured_image, services(name)",
  order: [{ column: "sort_order" }, { column: "created_at", ascending: false }],
  thumbField: "featured_image",
  columns: [
    { label: "Proyecto", get: (r) => r.title },
    { label: "Cliente / ubicación", get: (r) => [r.client, r.location].filter(Boolean).join(" – ") || "—" },
    { label: "Servicio", get: (r) => r.services?.name ?? "—" },
    { label: "Destacado", get: (r) => (r.is_featured ? "★" : "") },
  ],
  nameField: "title",
  publicPath: (s) => `/proyectos/${s}`,
  toggle: { field: "is_published", on: "Publicado", off: "Borrador" },
  canDelete: true,
  fields: [
    { name: "title", label: "Título", type: "text", required: true, max: 160, section: "Contenido" },
    { name: "slug", label: "Slug (URL)", type: "slug", required: true, help: "Ej.: riego-automatizado-la-molina" },
    { name: "client", label: "Cliente", type: "text", max: 120, help: "Solo datos reales." },
    { name: "location", label: "Ubicación", type: "text", max: 120, help: "Ej.: La Planicie – La Molina" },
    { name: "service_id", label: "Servicio", type: "select", fk: { table: "services", label: "name" } },
    { name: "short_description", label: "Descripción corta", type: "textarea", max: 300 },
    { name: "description", label: "Descripción", type: "markdown" },
    { name: "featured_image", label: "Portada", type: "image", bucket: "projects", section: "Imágenes" },
    { name: "gallery", label: "Galería", type: "gallery", bucket: "projects", help: "★ usa la foto como portada. Las fotos se comprimen automáticamente." },
    { name: "before_image", label: "Foto ANTES", type: "image", bucket: "projects" },
    { name: "after_image", label: "Foto DESPUÉS", type: "image", bucket: "projects" },
    { name: "is_featured", label: "Destacado (aparece en el inicio)", type: "bool", section: "Publicación" },
    { name: "is_published", label: "Publicado", type: "bool" },
    { name: "sort_order", label: "Orden", type: "number" },
    ...seo,
  ],
};

export const products: Entity = {
  key: "products",
  table: "products",
  title: "Productos",
  singular: "Producto",
  listSelect: "id, name, slug, price, show_price, available, featured, is_published, image_url, categories(name)",
  order: [{ column: "sort_order" }, { column: "name" }],
  thumbField: "image_url",
  columns: [
    { label: "Producto", get: (r) => r.name },
    { label: "Categoría", get: (r) => r.categories?.name ?? "—" },
    { label: "Precio", get: (r) => (r.show_price ? soles(r.price) : "Consultar") },
    { label: "Disponible", get: (r) => (r.available ? "Sí" : "Agotado") },
    { label: "Destacado", get: (r) => (r.featured ? "★" : "") },
  ],
  nameField: "name",
  publicPath: (s) => `/productos#${s}`,
  toggle: { field: "is_published", on: "Publicado", off: "Oculto" },
  canDelete: true,
  fields: [
    { name: "name", label: "Nombre", type: "text", required: true, max: 120 },
    { name: "slug", label: "Slug", type: "slug", required: true },
    { name: "category_id", label: "Categoría", type: "select", fk: { table: "categories", label: "name" } },
    { name: "description", label: "Descripción", type: "textarea", max: 1000 },
    { name: "image_url", label: "Imagen", type: "image", bucket: "products" },
    { name: "price", label: "Precio (S/)", type: "money", section: "Precio y disponibilidad" },
    { name: "price_unit", label: "Unidad", type: "text", max: 30, help: "Ej.: saco, litro, kg." },
    { name: "show_price", label: "Mostrar precio", type: "bool" },
    { name: "available", label: "Disponible", type: "bool" },
    { name: "featured", label: "Destacado", type: "bool" },
    { name: "is_published", label: "Publicado", type: "bool" },
    { name: "sort_order", label: "Orden", type: "number" },
    ...seo,
  ],
};

export const categories: Entity = {
  key: "categories",
  table: "categories",
  title: "Categorías",
  singular: "Categoría",
  listSelect: "id, name, slug, sort_order",
  order: [{ column: "sort_order" }],
  columns: [
    { label: "Categoría", get: (r) => r.name },
    { label: "Slug", get: (r) => r.slug },
    { label: "Orden", get: (r) => String(r.sort_order) },
  ],
  nameField: "name",
  canDelete: true,
  fields: [
    { name: "name", label: "Nombre", type: "text", required: true, max: 80 },
    { name: "slug", label: "Slug", type: "slug", required: true },
    { name: "sort_order", label: "Orden", type: "number" },
  ],
};

export const blog: Entity = {
  key: "blog",
  table: "blog_posts",
  title: "Blog",
  singular: "Artículo",
  listSelect: "id, title, slug, published_at, is_published, featured_image",
  order: [{ column: "created_at", ascending: false }],
  thumbField: "featured_image",
  columns: [
    { label: "Título", get: (r) => r.title },
    { label: "Publicado el", get: (r) => (r.published_at ? new Date(r.published_at).toLocaleDateString("es-PE") : "—") },
  ],
  nameField: "title",
  publicPath: (s) => `/blog/${s}`,
  toggle: { field: "is_published", on: "Publicado", off: "Borrador" },
  canDelete: true,
  fields: [
    { name: "title", label: "Título", type: "text", required: true, max: 180 },
    { name: "slug", label: "Slug (URL)", type: "slug", required: true },
    { name: "excerpt", label: "Resumen", type: "textarea", max: 400 },
    { name: "content", label: "Contenido", type: "markdown" },
    { name: "featured_image", label: "Imagen destacada", type: "image", bucket: "blog" },
    { name: "author", label: "Autor", type: "text", max: 80 },
    { name: "published_at", label: "Fecha de publicación", type: "datetime", help: "Si publicas sin fecha, se usa la fecha actual." },
    { name: "is_published", label: "Publicado", type: "bool" },
    ...seo,
  ],
};

export const ENTITIES: Record<string, Entity> = { services, projects, products, categories, blog };
