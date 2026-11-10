-- CUSTOM FIT PRIME / migration 003
begin;
create table public.attribute_definitions (
 id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
 data_type text not null check(data_type in ('text','number','boolean','single_select','multi_select')),
 applies_to text not null default 'all' check(applies_to in ('all','women','men','unisex')),
 required boolean not null default false, sort_order integer not null default 0,
 active boolean not null default true, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.attribute_options (
 id uuid primary key default gen_random_uuid(),
 attribute_definition_id uuid not null references public.attribute_definitions(id) on delete restrict,
 label text not null, value text not null, sort_order integer not null default 0,
 active boolean not null default true,
 unique(attribute_definition_id,value),
 unique(attribute_definition_id,id)
);
alter table public.product_attribute_values add constraint product_attribute_values_id_definition_uq unique(id,attribute_definition_id);
create table public.product_attribute_values (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id) on delete restrict,
 attribute_definition_id uuid not null references public.attribute_definitions(id) on delete restrict,
 text_value text, number_value numeric(14,4), boolean_value boolean, option_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(product_id,attribute_definition_id),
 foreign key(attribute_definition_id,option_id)
  references public.attribute_options(attribute_definition_id,id) on delete restrict,
 check(num_nonnulls(text_value,number_value,boolean_value,option_id)<=1)
);
create table public.product_attribute_option_values (
 product_attribute_value_id uuid not null,
 attribute_definition_id uuid not null,
 option_id uuid not null,
 primary key(product_attribute_value_id,option_id),
 foreign key(product_attribute_value_id,attribute_definition_id)
  references public.product_attribute_values(id,attribute_definition_id) on delete restrict,
 foreign key(attribute_definition_id,option_id)
  references public.attribute_options(attribute_definition_id,id) on delete restrict
);
create table public.product_pricing (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id) on delete restrict,
 price_type text not null check(price_type in ('fixed','starting_from','price_on_request')),
 amount_minor bigint,
 currency_code text not null default 'INR' references public.currencies(code) on delete restrict,
 is_active boolean not null default true,
 valid_from timestamptz, valid_until timestamptz,
 created_at timestamptz not null default now(),
 check(amount_minor is null or amount_minor>=0),
 check((price_type in ('fixed','starting_from') and amount_minor is not null)
    or (price_type='price_on_request' and amount_minor is null)),
 check(valid_until is null or valid_from is null or valid_until>valid_from)
);
create unique index product_pricing_one_active_currency_idx
 on public.product_pricing(product_id,currency_code) where is_active;
create index product_pricing_product_idx on public.product_pricing(product_id);
create table public.product_availability (
 product_id uuid primary key references public.products(id) on delete restrict,
 availability_status text not null check(availability_status in ('available','made_to_order','unavailable')),
 notes text, updated_at timestamptz not null default now()
);
create table public.site_content (
 id uuid primary key default gen_random_uuid(), content_key text not null unique,
 content_type text not null check(content_type in ('text_block','image_block','hero','announcement','faq_item')),
 title text, body text, media_path text,
 status text not null default 'draft' check(status in ('draft','published','archived')),
 sort_order integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
commit;
