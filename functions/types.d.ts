// Tipos mínimos de Cloudflare Pages Functions (evita depender de @cloudflare/workers-types).
type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  waitUntil: (p: Promise<unknown>) => void;
  next: () => Promise<Response>;
}) => Response | Promise<Response>;
