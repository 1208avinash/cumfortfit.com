-- CUSTOM FIT PRIME / migration 009
-- Allow structurally valid but incomplete sections in private homepage drafts.
begin;

-- Migration 008 declares an unnamed CHECK inline on the content column.
-- PostgreSQL names that constraint
-- homepage_section_revisions_content_check (table_column_check).
alter table public.homepage_section_revisions
  drop constraint if exists homepage_section_revisions_content_check;

create or replace function private.homepage_section_draft_content_is_safe(
  p_section_key text, p_content jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_key text;
  v_scene jsonb;
  v_item jsonb;
begin
  if jsonb_typeof(p_content) is distinct from 'object' then
    return false;
  end if;

  case p_section_key
    when 'hero' then
      foreach v_key in array array[
        'eyebrow', 'heading', 'body', 'image_path', 'image_alt',
        'primary_cta_label', 'primary_cta_href'
      ] loop
        if p_content ? v_key
          and jsonb_typeof(p_content -> v_key) is distinct from 'string' then
          return false;
        end if;
      end loop;
      if nullif(btrim(p_content ->> 'image_path'), '') is not null
        and not private.homepage_is_safe_image_path(p_content ->> 'image_path') then
        return false;
      end if;
      if nullif(btrim(p_content ->> 'primary_cta_href'), '') is not null
        and not private.homepage_is_safe_cta_href(p_content ->> 'primary_cta_href') then
        return false;
      end if;

    when 'introduction' then
      foreach v_key in array array['eyebrow', 'heading', 'body', 'supporting_body'] loop
        if p_content ? v_key
          and jsonb_typeof(p_content -> v_key) is distinct from 'string' then
          return false;
        end if;
      end loop;

    when 'craft-film' then
      foreach v_key in array array['eyebrow', 'heading', 'body', 'video_path', 'poster_path'] loop
        if p_content ? v_key
          and jsonb_typeof(p_content -> v_key) is distinct from 'string' then
          return false;
        end if;
      end loop;
      if nullif(btrim(p_content ->> 'video_path'), '') is not null
        and not private.homepage_is_safe_video_url(p_content ->> 'video_path') then
        return false;
      end if;
      if nullif(btrim(p_content ->> 'poster_path'), '') is not null
        and not private.homepage_is_safe_image_path(p_content ->> 'poster_path') then
        return false;
      end if;
      if p_content ? 'scenes' then
        if jsonb_typeof(p_content -> 'scenes') is distinct from 'array' then
          return false;
        end if;
        if jsonb_array_length(p_content -> 'scenes') <> 4 then
          return false;
        end if;
        for v_scene in
          select value from jsonb_array_elements(p_content -> 'scenes')
        loop
          if jsonb_typeof(v_scene) is distinct from 'object' then
            return false;
          end if;
          foreach v_key in array array['src', 'caption', 'label', 'title', 'sourcePage'] loop
            if v_scene ? v_key
              and jsonb_typeof(v_scene -> v_key) is distinct from 'string' then
              return false;
            end if;
          end loop;
          if v_scene ? 'seconds' then
            if jsonb_typeof(v_scene -> 'seconds') not in ('number', 'string') then
              return false;
            end if;
            if jsonb_typeof(v_scene -> 'seconds') = 'string'
              and btrim(v_scene ->> 'seconds') <> '' then
              return false;
            end if;
          end if;
          if nullif(btrim(v_scene ->> 'src'), '') is not null
            and not private.homepage_is_safe_video_url(v_scene ->> 'src') then
            return false;
          end if;
          if nullif(btrim(v_scene ->> 'sourcePage'), '') is not null
            and not private.homepage_is_safe_video_source_url(v_scene ->> 'sourcePage') then
            return false;
          end if;
        end loop;
      end if;

    when 'collection' then
      foreach v_key in array array['eyebrow', 'heading', 'body'] loop
        if p_content ? v_key
          and jsonb_typeof(p_content -> v_key) is distinct from 'string' then
          return false;
        end if;
      end loop;

    when 'process' then
      foreach v_key in array array['eyebrow', 'heading', 'body'] loop
        if p_content ? v_key
          and jsonb_typeof(p_content -> v_key) is distinct from 'string' then
          return false;
        end if;
      end loop;
      if p_content ? 'steps' then
        if jsonb_typeof(p_content -> 'steps') is distinct from 'array' then
          return false;
        end if;
        if jsonb_array_length(p_content -> 'steps') > 4 then
          return false;
        end if;
        if exists (
          select 1
          from jsonb_array_elements(p_content -> 'steps') as s(value)
          where jsonb_typeof(s.value) is distinct from 'string'
        ) then
          return false;
        end if;
      end if;

    when 'atelier' then
      foreach v_key in array array['eyebrow', 'heading', 'body', 'image_path', 'image_alt'] loop
        if p_content ? v_key
          and jsonb_typeof(p_content -> v_key) is distinct from 'string' then
          return false;
        end if;
      end loop;
      if nullif(btrim(p_content ->> 'image_path'), '') is not null
        and not private.homepage_is_safe_image_path(p_content ->> 'image_path') then
        return false;
      end if;
      if p_content ? 'tags' then
        if jsonb_typeof(p_content -> 'tags') is distinct from 'array' then
          return false;
        end if;
        if exists (
          select 1
          from jsonb_array_elements(p_content -> 'tags') as tag(value)
          where jsonb_typeof(tag.value) is distinct from 'string'
        ) then
          return false;
        end if;
      end if;

    when 'cta' then
      foreach v_key in array array['eyebrow', 'heading', 'body', 'button_label'] loop
        if p_content ? v_key
          and jsonb_typeof(p_content -> v_key) is distinct from 'string' then
          return false;
        end if;
      end loop;

    when 'faq' then
      foreach v_key in array array['eyebrow', 'heading', 'body'] loop
        if p_content ? v_key
          and jsonb_typeof(p_content -> v_key) is distinct from 'string' then
          return false;
        end if;
      end loop;
      if p_content ? 'items' then
        if jsonb_typeof(p_content -> 'items') is distinct from 'array' then
          return false;
        end if;
        if jsonb_array_length(p_content -> 'items') <> 4 then
          return false;
        end if;
        for v_item in
          select value from jsonb_array_elements(p_content -> 'items')
        loop
          if jsonb_typeof(v_item) is distinct from 'object' then
            return false;
          end if;
          foreach v_key in array array['question', 'answer'] loop
            if v_item ? v_key
              and jsonb_typeof(v_item -> v_key) is distinct from 'string' then
              return false;
            end if;
          end loop;
        end loop;
      end if;

    else
      return false;
  end case;

  return true;
end
$$;

alter table public.homepage_section_revisions
  add constraint homepage_section_revisions_content_draft_safety_check
  check (private.homepage_section_draft_content_is_safe(section_key, content));

revoke all on function private.homepage_section_draft_content_is_safe(text, jsonb)
  from public, anon, authenticated;

create or replace function private.enforce_homepage_publish_content()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_invalid_section text;
begin
  if new.status = 'published' and old.status is distinct from new.status then
    if (select count(*)
        from public.homepage_section_revisions
        where release_id = new.id) <> 8
      or exists (
        select required.section_key
        from unnest(array[
          'hero', 'introduction', 'craft-film', 'collection',
          'process', 'atelier', 'cta', 'faq'
        ]) as required(section_key)
        except
        select section_key
        from public.homepage_section_revisions
        where release_id = new.id
      ) then
      raise exception using
        errcode = '23514',
        message = 'All eight required homepage sections must be present';
    end if;

    select section_key into v_invalid_section
    from public.homepage_section_revisions
    where release_id = new.id
      and not private.homepage_section_content_is_valid(section_key, content)
    limit 1;

    if found then
      raise exception using
        errcode = '23514',
        message = format('Homepage section %s is incomplete or invalid', v_invalid_section);
    end if;
  end if;

  return new;
end
$$;

create trigger homepage_releases_validate_publish_content
  before update of status on public.homepage_releases
  for each row execute function private.enforce_homepage_publish_content();

revoke all on function private.enforce_homepage_publish_content()
  from public, anon, authenticated;

commit;
