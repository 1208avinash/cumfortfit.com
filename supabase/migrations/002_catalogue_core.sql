-- CUSTOM FIT PRIME / migration 002
begin;
create table public.products (
  id uuid primary key default gen_random_uuid(),
  legacy_code text not null unique,
  slug text not null unique,
  title text not null,
  description text,
  record_type text not null check(record_type in ('orderable_product','design_reference')),
  audience text not null default 'not_set' check(audience in ('women','men','unisex','not_set')),
  category_id uuid references public.categories(id) on delete restrict,
  status text not null default 'draft' check(status in ('draft','published','archived')),
  homepage_visible boolean not null default false,
  lookbook_visible boolean not null default false,
  pricing_public boolean not null default false,
  homepage_sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(status <> 'archived' or (not homepage_visible and not lookbook_visible and not pricing_public))
);
create index products_category_idx on public.products(category_id);
create index products_homepage_idx on public.products(homepage_sort_order,id)
 where status='published' and homepage_visible;
create index products_lookbook_idx on public.products(id)
 where status='published' and lookbook_visible;
create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  bucket_id text not null check(bucket_id in ('catalogue-staging','catalogue-public')),
  storage_path text not null,
  alt_text text, caption text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  approved_at timestamptz, approved_by uuid references auth.users(id) on delete set null,
  width integer check(width is null or width>0),
  height integer check(height is null or height>0),
  created_at timestamptz not null default now(),
  unique(bucket_id,storage_path),
  check((bucket_id='catalogue-staging' and approved_at is null) or
        (bucket_id='catalogue-public' and approved_at is not null))
);
create index product_images_product_sort_idx on public.product_images(product_id,sort_order);
create unique index product_images_one_primary_idx on public.product_images(product_id) where is_primary;
create table public.product_lookbook_chapters (
  product_id uuid not null references public.products(id) on delete restrict,
  chapter_id uuid not null references public.lookbook_chapters(id) on delete restrict,
  sort_order integer not null default 0,
  primary key(product_id,chapter_id)
);
create index product_lookbook_chapter_sort_idx on public.product_lookbook_chapters(chapter_id,sort_order);
commit;
