-- CUSTOM FIT PRIME / migration 004
begin;
create table public.admin_memberships (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references auth.users(id) on delete restrict,
 role text not null check(role in ('owner','admin','editor')),
 active boolean not null default true,
 invited_by uuid references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.admin_audit_logs (
 id uuid primary key default gen_random_uuid(),
 actor_user_id uuid references auth.users(id) on delete set null,
 actor_kind text not null default 'user' check(actor_kind in ('user','system')),
 action text not null, entity_type text not null, entity_id uuid,
 old_values jsonb, new_values jsonb, created_at timestamptz not null default now()
);
create index admin_audit_actor_time_idx on public.admin_audit_logs(actor_user_id,created_at desc);
create index admin_audit_entity_time_idx on public.admin_audit_logs(entity_type,entity_id,created_at desc);
create table public.product_slug_history (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id) on delete restrict,
 old_slug text not null unique, new_slug text not null,
 changed_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index product_slug_history_product_idx on public.product_slug_history(product_id);
commit;
