-- CUSTOM FIT PRIME / migration 008
-- Versioned homepage content with Owner/Admin-only draft writes.
begin;

alter table public.products
  add column if not exists homepage_card_summary text;

create or replace function private.homepage_has_text(p_content jsonb, p_key text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    jsonb_typeof(p_content -> p_key) = 'string'
      and length(btrim(p_content ->> p_key)) > 0,
    false
  )
$$;

create or replace function private.homepage_array_has_length(
  p_content jsonb, p_key text, p_expected_length integer
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when jsonb_typeof(p_content -> p_key) = 'array'
      then jsonb_array_length(p_content -> p_key) = p_expected_length
    else false
  end
$$;

create or replace function private.homepage_array_has_text_items(
  p_content jsonb, p_key text, p_expected_length integer
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
begin
  if jsonb_typeof(p_content -> p_key) is distinct from 'array' then
    return false;
  end if;
  if p_expected_length is not null
    and jsonb_array_length(p_content -> p_key) <> p_expected_length then
    return false;
  end if;

  for v_item in
    select value from jsonb_array_elements(p_content -> p_key)
  loop
    if jsonb_typeof(v_item) is distinct from 'string'
      or length(btrim(v_item #>> '{}')) = 0 then
      return false;
    end if;
  end loop;
  return true;
end
$$;

create or replace function private.homepage_is_safe_relative_asset_path(p_path text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    p_path ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
    and p_path !~ '(^|/)\.\.?(/|$)'
    and p_path !~ '//'
    and p_path !~ '/$',
    false
  )
$$;

create or replace function private.homepage_is_safe_image_path(p_path text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select private.homepage_is_safe_relative_asset_path(p_path)
    and lower(p_path) ~ '\.(avif|jpe?g|png|webp)$'
$$;

create or replace function private.homepage_is_safe_video_url(p_url text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    p_url ~ '^https://videos[.]pexels[.]com/video-files/[0-9]+/[A-Za-z0-9._-]+[.]mp4$',
    false
  )
$$;

create or replace function private.homepage_is_safe_video_source_url(p_url text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    p_url ~ '^https://www[.]pexels[.]com/video/[A-Za-z0-9-]+/$',
    false
  )
$$;

create or replace function private.homepage_video_scenes_are_valid(p_content jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_scene jsonb;
  v_seconds numeric;
begin
  if jsonb_typeof(p_content -> 'scenes') is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_content -> 'scenes') <> 4 then
    return false;
  end if;

  for v_scene in
    select value from jsonb_array_elements(p_content -> 'scenes')
  loop
    if jsonb_typeof(v_scene) is distinct from 'object'
      or not private.homepage_has_text(v_scene, 'caption')
      or not private.homepage_has_text(v_scene, 'label')
      or not private.homepage_has_text(v_scene, 'title')
      or not private.homepage_is_safe_video_url(v_scene ->> 'src')
      or not private.homepage_is_safe_video_source_url(v_scene ->> 'sourcePage')
      or jsonb_typeof(v_scene -> 'seconds') is distinct from 'number' then
      return false;
    end if;

    v_seconds := (v_scene ->> 'seconds')::numeric;
    if v_seconds <= 0 then
      return false;
    end if;
  end loop;
  return true;
end
$$;

create or replace function private.homepage_is_safe_cta_href(p_href text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    p_href ~ '^#[A-Za-z][A-Za-z0-9_-]*$'
    or (
      left(p_href, 1) = '/'
      and left(p_href, 2) <> '//'
      and p_href !~ '[[:space:][:cntrl:]]'
      and strpos(p_href, chr(92)) = 0
      and p_href !~ '(^|/)\.\.?(/|$)'
    ),
    false
  )
$$;

create or replace function private.homepage_has_approved_public_image(p_path text)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.product_images i
    join public.products p on p.id = i.product_id
    where i.bucket_id = 'catalogue-public'
      and i.approved_at is not null
      and i.storage_path = p_path
      and p.status = 'published'
  )
$$;

create or replace function private.homepage_section_content_is_valid(
  p_section_key text, p_content jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, private
as $$
declare
  v_item jsonb;
begin
  if jsonb_typeof(p_content) is distinct from 'object' then
    return false;
  end if;

  case p_section_key
    when 'hero' then
      return private.homepage_has_text(p_content, 'eyebrow')
        and private.homepage_has_text(p_content, 'heading')
        and private.homepage_has_text(p_content, 'body')
        and private.homepage_has_text(p_content, 'image_path')
        and private.homepage_is_safe_image_path(p_content ->> 'image_path')
        and private.homepage_has_text(p_content, 'image_alt')
        and private.homepage_has_text(p_content, 'primary_cta_label')
        and private.homepage_has_text(p_content, 'primary_cta_href')
        and private.homepage_is_safe_cta_href(p_content ->> 'primary_cta_href');
    when 'introduction' then
      return private.homepage_has_text(p_content, 'eyebrow')
        and private.homepage_has_text(p_content, 'heading')
        and private.homepage_has_text(p_content, 'body')
        and private.homepage_has_text(p_content, 'supporting_body');
    when 'craft-film' then
      return private.homepage_has_text(p_content, 'eyebrow')
        and private.homepage_has_text(p_content, 'heading')
        and private.homepage_has_text(p_content, 'body')
        and private.homepage_has_text(p_content, 'video_path')
        and private.homepage_is_safe_video_url(p_content ->> 'video_path')
        and private.homepage_has_text(p_content, 'poster_path')
        and private.homepage_is_safe_image_path(p_content ->> 'poster_path')
        and private.homepage_video_scenes_are_valid(p_content);
    when 'collection' then
      return private.homepage_has_text(p_content, 'eyebrow')
        and private.homepage_has_text(p_content, 'heading')
        and private.homepage_has_text(p_content, 'body');
    when 'process' then
      return private.homepage_has_text(p_content, 'eyebrow')
        and private.homepage_has_text(p_content, 'heading')
        and private.homepage_has_text(p_content, 'body')
        and private.homepage_array_has_text_items(p_content, 'steps', 4);
    when 'atelier' then
      return private.homepage_has_text(p_content, 'eyebrow')
        and private.homepage_has_text(p_content, 'heading')
        and private.homepage_has_text(p_content, 'body')
        and private.homepage_has_text(p_content, 'image_path')
        and private.homepage_is_safe_image_path(p_content ->> 'image_path')
        and private.homepage_has_text(p_content, 'image_alt')
        and private.homepage_array_has_text_items(p_content, 'tags', null);
    when 'cta' then
      return private.homepage_has_text(p_content, 'eyebrow')
        and private.homepage_has_text(p_content, 'heading')
        and private.homepage_has_text(p_content, 'body')
        and private.homepage_has_text(p_content, 'button_label');
    when 'faq' then
      if not (
        private.homepage_has_text(p_content, 'eyebrow')
        and private.homepage_has_text(p_content, 'heading')
        and private.homepage_has_text(p_content, 'body')
        and private.homepage_array_has_length(p_content, 'items', 4)
      ) then
        return false;
      end if;
      for v_item in
        select value from jsonb_array_elements(p_content -> 'items')
      loop
        if not private.homepage_has_text(v_item, 'question')
          or not private.homepage_has_text(v_item, 'answer') then
          return false;
        end if;
      end loop;
      return true;
    else
      return false;
  end case;
end
$$;

create or replace function private.is_homepage_manager()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
set row_security = off
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.admin_memberships m
    where m.user_id = auth.uid()
      and m.active
      and m.role in ('owner', 'admin')
  )
$$;

create or replace function private.guard_editor_homepage_card_summary()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
begin
  if exists (
    select 1
    from public.admin_memberships m
    where m.user_id = auth.uid()
      and m.active
      and m.role = 'editor'
  ) then
    if tg_op = 'INSERT' and new.homepage_card_summary is not null then
      raise exception using errcode = '42501',
        message = 'Editors cannot change homepage card summaries';
    elsif tg_op = 'UPDATE'
      and new.homepage_card_summary is distinct from old.homepage_card_summary then
      raise exception using errcode = '42501',
        message = 'Editors cannot change homepage card summaries';
    end if;
  end if;
  return new;
end
$$;

create trigger guard_editor_homepage_card_summary_insert
  before insert on public.products
  for each row execute function private.guard_editor_homepage_card_summary();
create trigger guard_editor_homepage_card_summary_update
  before update of homepage_card_summary on public.products
  for each row execute function private.guard_editor_homepage_card_summary();

create table public.homepage_releases (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  lock_version integer not null default 1 check (lock_version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'published' and published_at is not null and published_by is not null)
    or (status = 'archived' and published_at is not null and published_by is not null)
    or (status = 'draft' and published_at is null and published_by is null)
  )
);
create unique index homepage_releases_single_published_idx
  on public.homepage_releases (status)
  where status = 'published';
create unique index homepage_releases_single_draft_idx
  on public.homepage_releases (status)
  where status = 'draft';

create table public.homepage_section_revisions (
  release_id uuid not null references public.homepage_releases(id) on delete cascade,
  section_key text not null
    check (section_key in (
      'hero', 'introduction', 'craft-film', 'collection',
      'process', 'atelier', 'cta', 'faq'
    )),
  section_type text not null
    check (section_type in (
      'hero', 'introduction', 'craft-film', 'collection',
      'process', 'atelier', 'cta', 'faq'
    )),
  content jsonb not null
    check (private.homepage_section_content_is_valid(section_key, content)),
  is_visible boolean not null default true,
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (release_id, section_key),
  unique (release_id, sort_order),
  check (section_type = section_key)
);
create index homepage_section_revisions_order_idx
  on public.homepage_section_revisions (release_id, sort_order);

create table public.homepage_release_products (
  release_id uuid not null references public.homepage_releases(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (release_id, product_id),
  unique (release_id, sort_order)
);
create index homepage_release_products_product_idx
  on public.homepage_release_products (product_id);

create or replace function private.set_homepage_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger homepage_releases_updated_at
  before update on public.homepage_releases
  for each row execute function private.set_homepage_updated_at();
create trigger homepage_section_revisions_updated_at
  before update on public.homepage_section_revisions
  for each row execute function private.set_homepage_updated_at();
create trigger homepage_release_products_updated_at
  before update on public.homepage_release_products
  for each row execute function private.set_homepage_updated_at();

create or replace function private.audit_homepage_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_actor uuid := auth.uid();
  v_entity_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_old := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    v_new := to_jsonb(new);
  end if;

  v_entity_id := coalesce(
    nullif(v_new ->> 'id', '')::uuid,
    nullif(v_new ->> 'release_id', '')::uuid,
    nullif(v_old ->> 'id', '')::uuid,
    nullif(v_old ->> 'release_id', '')::uuid
  );

  insert into public.admin_audit_logs (
    actor_user_id, actor_kind, action, entity_type, entity_id, old_values, new_values
  ) values (
    v_actor,
    case when v_actor is null then 'system' else 'user' end,
    tg_op,
    tg_table_name,
    v_entity_id,
    v_old,
    v_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create trigger audit_homepage_releases
  after insert or update or delete on public.homepage_releases
  for each row execute function private.audit_homepage_change();
create trigger audit_homepage_section_revisions
  after insert or update or delete on public.homepage_section_revisions
  for each row execute function private.audit_homepage_change();
create trigger audit_homepage_release_products
  after insert or update or delete on public.homepage_release_products
  for each row execute function private.audit_homepage_change();

-- Existing migration 005 installs a general products audit trigger. Add a
-- narrow fallback only when that trigger is absent, avoiding duplicate entries.
do $$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'products'
      and t.tgname = 'audit_products'
      and not t.tgisinternal
  ) then
    execute 'create trigger audit_homepage_card_summary
      after update of homepage_card_summary on public.products
      for each row execute function private.audit_homepage_change()';
  end if;
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'products'
      and t.tgname = 'products_updated_at'
      and not t.tgisinternal
  ) then
    execute 'create trigger products_updated_at
      before update on public.products
      for each row execute function private.set_homepage_updated_at()';
  end if;
end
$$;

alter table public.homepage_releases enable row level security;
alter table public.homepage_section_revisions enable row level security;
alter table public.homepage_release_products enable row level security;

revoke all on public.homepage_releases,
  public.homepage_section_revisions,
  public.homepage_release_products
  from public, anon, authenticated;
grant select on public.homepage_section_revisions,
  public.homepage_release_products
  to anon, authenticated;
grant select (id, status, lock_version, published_at, created_at, updated_at)
  on public.homepage_releases to anon, authenticated;

create policy homepage_releases_public_read
  on public.homepage_releases for select to anon, authenticated
  using (status = 'published');
create policy homepage_releases_manager_read
  on public.homepage_releases for select to authenticated
  using (private.is_homepage_manager());
create policy homepage_sections_public_read
  on public.homepage_section_revisions for select to anon, authenticated
  using (
    is_visible
    and exists (
      select 1 from public.homepage_releases r
      where r.id = release_id and r.status = 'published'
    )
  );
create policy homepage_sections_manager_read
  on public.homepage_section_revisions for select to authenticated
  using (private.is_homepage_manager());
create policy homepage_release_products_public_read
  on public.homepage_release_products for select to anon, authenticated
  using (
    exists (
      select 1
      from public.homepage_releases r
      join public.products p on p.id = product_id
      where r.id = release_id
        and r.status = 'published'
        and p.status = 'published'
        and p.homepage_visible
    )
  );
create policy homepage_release_products_manager_read
  on public.homepage_release_products for select to authenticated
  using (private.is_homepage_manager());

create or replace function public.create_homepage_draft()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_release_id uuid;
  v_published_id uuid;
begin
  if v_actor is null or not private.is_homepage_manager() then
    raise exception using errcode = '42501', message = 'Homepage manager access required';
  end if;

  perform pg_advisory_xact_lock(434821, 1);

  select id into v_release_id
  from public.homepage_releases
  where status = 'draft'
  for update;
  if found then
    return v_release_id;
  end if;

  insert into public.homepage_releases (status, created_by, updated_by)
  values ('draft', v_actor, v_actor)
  on conflict (status) where status = 'draft' do nothing
  returning id into v_release_id;

  if v_release_id is null then
    select id into v_release_id
    from public.homepage_releases
    where status = 'draft'
    for update;
    if not found then
      raise exception using errcode = '40001',
        message = 'Concurrent homepage draft creation could not be observed; retry the request';
    end if;
    return v_release_id;
  end if;

  select id into v_published_id
  from public.homepage_releases
  where status = 'published'
  for share;

  if v_published_id is not null then
    insert into public.homepage_section_revisions (
      release_id, section_key, section_type, content, is_visible, sort_order
    )
    select v_release_id, section_key, section_type, content, is_visible, sort_order
    from public.homepage_section_revisions
    where release_id = v_published_id;

    insert into public.homepage_release_products (release_id, product_id, sort_order)
    select v_release_id, product_id, sort_order
    from public.homepage_release_products
    where release_id = v_published_id;
  end if;

  return v_release_id;
end
$$;

create or replace function public.save_homepage_draft(
  p_release_id uuid,
  p_expected_version integer,
  p_sections jsonb,
  p_product_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_release public.homepage_releases%rowtype;
  v_new_version integer;
begin
  if v_actor is null or not private.is_homepage_manager() then
    raise exception using errcode = '42501', message = 'Homepage manager access required';
  end if;
  if p_sections is null or jsonb_typeof(p_sections) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Sections must be a JSON array';
  end if;
  if p_product_ids is null then
    raise exception using errcode = '22023', message = 'Product selection must be provided';
  end if;

  select * into v_release
  from public.homepage_releases
  where id = p_release_id
  for update;
  if not found or v_release.status <> 'draft' then
    raise exception using errcode = '22023', message = 'Draft release not found';
  end if;
  if p_expected_version is null or v_release.lock_version <> p_expected_version then
    raise exception using errcode = '40001', message = 'Homepage draft has changed; reload before saving';
  end if;

  update public.homepage_releases
  set lock_version = lock_version + 1, updated_by = v_actor
  where id = p_release_id
  returning lock_version into v_new_version;

  delete from public.homepage_section_revisions where release_id = p_release_id;
  insert into public.homepage_section_revisions (
    release_id, section_key, section_type, content, is_visible, sort_order
  )
  select
    p_release_id,
    item.section_key,
    item.section_type,
    item.content,
    item.is_visible,
    item.sort_order
  from jsonb_to_recordset(p_sections) as item(
    section_key text,
    section_type text,
    content jsonb,
    is_visible boolean,
    sort_order integer
  );

  delete from public.homepage_release_products where release_id = p_release_id;
  insert into public.homepage_release_products (release_id, product_id, sort_order)
  select p_release_id, selection.product_id, (selection.ordinality - 1)::integer
  from unnest(p_product_ids) with ordinality as selection(product_id, ordinality);

  return v_new_version;
end
$$;

create or replace function public.publish_homepage_release(
  p_release_id uuid,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_release public.homepage_releases%rowtype;
  v_previous_id uuid;
  v_section_count integer;
  v_product_count integer;
  v_new_version integer;
begin
  if v_actor is null or not private.is_homepage_manager() then
    raise exception using errcode = '42501', message = 'Homepage manager access required';
  end if;

  select * into v_release
  from public.homepage_releases
  where id = p_release_id
  for update;
  if not found or v_release.status <> 'draft' then
    raise exception using errcode = '22023', message = 'Draft release not found';
  end if;
  if p_expected_version is null or v_release.lock_version <> p_expected_version then
    raise exception using errcode = '40001', message = 'Homepage draft has changed; reload before publishing';
  end if;

  select count(*) into v_section_count
  from public.homepage_section_revisions
  where release_id = p_release_id;
  if v_section_count <> 8 or exists (
    select required.section_key
    from unnest(array[
      'hero', 'introduction', 'craft-film', 'collection',
      'process', 'atelier', 'cta', 'faq'
    ]) as required(section_key)
    except
    select section_key
    from public.homepage_section_revisions
    where release_id = p_release_id
  ) then
    raise exception using errcode = '23514', message = 'All eight required homepage sections must be present';
  end if;

  if not exists (
    select 1
    from public.homepage_section_revisions
    where release_id = p_release_id
      and section_key = 'hero'
      and is_visible
  ) then
    raise exception using errcode = '23514', message = 'The hero section must be visible';
  end if;

  perform p.id
  from public.homepage_release_products hp
  join public.products p on p.id = hp.product_id
  where hp.release_id = p_release_id
  order by p.id
  for share of p;

  select count(*) into v_product_count
  from public.homepage_release_products
  where release_id = p_release_id;
  if v_product_count <> 8 or exists (
    select 1
    from public.homepage_release_products hp
    join public.products p on p.id = hp.product_id
    where hp.release_id = p_release_id
      and (p.status <> 'published' or not p.homepage_visible)
  ) then
    raise exception using errcode = '23514',
      message = 'Exactly eight published, homepage-visible products are required';
  end if;

  perform i.id
  from public.homepage_section_revisions s
  cross join lateral (values
    (case when s.section_key in ('hero', 'atelier')
      then s.content ->> 'image_path' end),
    (case when s.section_key = 'craft-film'
      then s.content ->> 'poster_path' end)
  ) asset(storage_path)
  join public.product_images i
    on i.storage_path = asset.storage_path
   and i.bucket_id = 'catalogue-public'
   and i.approved_at is not null
  join public.products p on p.id = i.product_id
  where s.release_id = p_release_id
    and s.section_key in ('hero', 'atelier', 'craft-film')
  order by i.id
  for share of i, p;

  if exists (
    select 1
    from public.homepage_section_revisions s
    cross join lateral (values
      (case when s.section_key in ('hero', 'atelier')
        then s.content ->> 'image_path' end),
      (case when s.section_key = 'craft-film'
        then s.content ->> 'poster_path' end)
    ) asset(storage_path)
    where s.release_id = p_release_id
      and s.section_key in ('hero', 'atelier', 'craft-film')
      and not private.homepage_has_approved_public_image(asset.storage_path)
  ) then
    raise exception using errcode = '23514',
      message = 'Homepage images must reference approved public images on published products';
  end if;

  select id into v_previous_id
  from public.homepage_releases
  where status = 'published'
  for update;

  if v_previous_id is not null then
    update public.homepage_releases
    set status = 'archived', updated_by = v_actor
    where id = v_previous_id;
  end if;

  update public.homepage_releases
  set status = 'published',
      published_by = v_actor,
      published_at = clock_timestamp(),
      updated_by = v_actor,
      lock_version = lock_version + 1
  where id = p_release_id
  returning lock_version into v_new_version;

  return v_new_version;
end
$$;

revoke all on function private.homepage_has_text(jsonb, text) from public, anon, authenticated;
revoke all on function private.homepage_array_has_length(jsonb, text, integer) from public, anon, authenticated;
revoke all on function private.homepage_array_has_text_items(jsonb, text, integer) from public, anon, authenticated;
revoke all on function private.homepage_is_safe_relative_asset_path(text) from public, anon, authenticated;
revoke all on function private.homepage_is_safe_image_path(text) from public, anon, authenticated;
revoke all on function private.homepage_is_safe_video_url(text) from public, anon, authenticated;
revoke all on function private.homepage_is_safe_video_source_url(text) from public, anon, authenticated;
revoke all on function private.homepage_video_scenes_are_valid(jsonb) from public, anon, authenticated;
revoke all on function private.homepage_is_safe_cta_href(text) from public, anon, authenticated;
revoke all on function private.homepage_has_approved_public_image(text) from public, anon, authenticated;
revoke all on function private.homepage_section_content_is_valid(text, jsonb) from public, anon, authenticated;
revoke all on function private.is_homepage_manager() from public, anon, authenticated;
revoke all on function private.guard_editor_homepage_card_summary() from public, anon, authenticated;
revoke all on function private.set_homepage_updated_at() from public, anon, authenticated;
revoke all on function private.audit_homepage_change() from public, anon, authenticated;
grant execute on function private.is_homepage_manager() to authenticated;

revoke all on function public.create_homepage_draft() from public, anon, authenticated;
revoke all on function public.save_homepage_draft(uuid, integer, jsonb, uuid[]) from public, anon, authenticated;
revoke all on function public.publish_homepage_release(uuid, integer) from public, anon, authenticated;
grant execute on function public.create_homepage_draft() to authenticated;
grant execute on function public.save_homepage_draft(uuid, integer, jsonb, uuid[]) to authenticated;
grant execute on function public.publish_homepage_release(uuid, integer) to authenticated;

commit;
