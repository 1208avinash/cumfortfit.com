-- CUSTOM FIT PRIME / migration 001
-- Candidate migration. Apply only to a verified disposable Supabase project first.
begin;
create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
create table public.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  name text not null, symbol text not null,
  minor_unit smallint not null check (minor_unit between 0 and 4),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.currencies(code,name,symbol,minor_unit)
values ('INR','Indian Rupee','₹',2);
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text not null unique,
  parent_id uuid references public.categories(id) on delete restrict,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(parent_id is null or parent_id <> id)
);
create table public.lookbook_chapters (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text not null unique, description text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
commit;
