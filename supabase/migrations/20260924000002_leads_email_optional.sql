-- Formulario corto (sept 2026): nombre, teléfono, servicio y mensaje opcional.
-- El correo deja de ser obligatorio (el check de formato sigue aplicando si viene).
alter table public.leads alter column email drop not null;
