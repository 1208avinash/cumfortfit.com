-- CUSTOM FIT PRIME / migration 005
begin;
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin new.updated_at:=now(); return new; end $$;

create or replace function private.current_admin_role()
returns text language sql stable security definer
set search_path=pg_catalog,public,auth as $$
 select role from public.admin_memberships
 where user_id=auth.uid() and active limit 1
$$;
revoke all on function private.current_admin_role() from public,anon;
grant execute on function private.current_admin_role() to authenticated;

create or replace function private.enforce_product_type_relations()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare v_type text;
begin
 select record_type into v_type from public.products where id=new.product_id;
 if v_type is distinct from 'orderable_product' then
  raise exception 'Pricing and availability are only allowed for orderable products';
 end if;
 return new;
end $$;
create trigger pricing_orderable_only before insert or update on public.product_pricing
 for each row execute function private.enforce_product_type_relations();
create trigger availability_orderable_only before insert or update on public.product_availability
 for each row execute function private.enforce_product_type_relations();

create or replace function private.validate_attribute_value()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare v_type text; v_count integer;
begin
 select data_type into v_type from public.attribute_definitions where id=new.attribute_definition_id;
 v_count:=num_nonnulls(new.text_value,new.number_value,new.boolean_value,new.option_id);
 if v_type='text' and (v_count<>1 or new.text_value is null) then raise exception 'Text attribute requires text_value only';
 elsif v_type='number' and (v_count<>1 or new.number_value is null) then raise exception 'Number attribute requires number_value only';
 elsif v_type='boolean' and (v_count<>1 or new.boolean_value is null) then raise exception 'Boolean attribute requires boolean_value only';
 elsif v_type='single_select' and (v_count<>1 or new.option_id is null) then raise exception 'Single select requires option_id only';
 elsif v_type='multi_select' and v_count<>0 then raise exception 'Multi select values must use option mapping rows';
 end if;
 return new;
end $$;
create trigger validate_attribute_value before insert or update on public.product_attribute_values
 for each row execute function private.validate_attribute_value();

create or replace function private.validate_multi_select_option()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare v_type text;
begin
 select d.data_type into v_type from public.product_attribute_values v
 join public.attribute_definitions d on d.id=v.attribute_definition_id
 where v.id=new.product_attribute_value_id and v.attribute_definition_id=new.attribute_definition_id;
 if v_type is distinct from 'multi_select' then raise exception 'Option mapping requires a multi_select attribute'; end if;
 return new;
end $$;
create trigger validate_multi_select_option before insert or update on public.product_attribute_option_values
 for each row execute function private.validate_multi_select_option();

create or replace function private.guard_editor_product_update()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if private.current_admin_role()='editor' and
   (new.status is distinct from old.status or new.homepage_visible is distinct from old.homepage_visible
    or new.lookbook_visible is distinct from old.lookbook_visible
    or new.pricing_public is distinct from old.pricing_public
    or new.homepage_sort_order is distinct from old.homepage_sort_order
    or new.slug is distinct from old.slug or new.record_type is distinct from old.record_type
    or new.legacy_code is distinct from old.legacy_code) then
   raise exception 'Editors cannot change protected catalogue fields';
 end if;
 return new;
end $$;
create trigger guard_editor_product before update on public.products
 for each row execute function private.guard_editor_product_update();

create or replace function private.guard_editor_content_update()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if private.current_admin_role()='editor' and
   (new.status is distinct from old.status or new.sort_order is distinct from old.sort_order) then
  raise exception 'Editors cannot publish or reorder site content';
 end if;
 return new;
end $$;
create trigger guard_editor_content before update on public.site_content
 for each row execute function private.guard_editor_content_update();

create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare oldj jsonb; newj jsonb; actor uuid;
begin
 actor:=auth.uid();
 if tg_op<>'INSERT' then oldj:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then newj:=to_jsonb(new); end if;
 if oldj is not null then oldj:=oldj-'created_at'-'updated_at'; end if;
 if newj is not null then newj:=newj-'created_at'-'updated_at'; end if;
 insert into public.admin_audit_logs(actor_user_id,actor_kind,action,entity_type,entity_id,old_values,new_values)
 values(actor,case when actor is null then 'system' else 'user' end,tg_op, tg_table_name,
   coalesce((newj->>'id')::uuid,(oldj->>'id')::uuid),oldj,newj);
 if tg_op='DELETE' then return old; else return new; end if;
end $$;


-- Editors may create drafts, but cannot create published or publicly promoted records.
create or replace function private.guard_editor_product_insert()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if private.current_admin_role()='editor' and
   (new.status<>'draft' or new.homepage_visible or new.lookbook_visible or new.pricing_public) then
  raise exception 'Editors may only create unpublished, non-public products';
 end if;
 return new;
end $$;
create trigger guard_editor_product_insert before insert on public.products
 for each row execute function private.guard_editor_product_insert();

create or replace function private.guard_editor_content_insert()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if private.current_admin_role()='editor' and new.status<>'draft' then
  raise exception 'Editors may only create draft site content';
 end if;
 return new;
end $$;
create trigger guard_editor_content_insert before insert on public.site_content
 for each row execute function private.guard_editor_content_insert();

create or replace function private.guard_editor_image_write()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if private.current_admin_role()='editor' then
  if tg_op='INSERT' then
   if new.bucket_id<>'catalogue-staging' or new.approved_at is not null or new.approved_by is not null then
    raise exception 'Editors may only add unapproved staging images';
   end if;
  elsif new.bucket_id is distinct from old.bucket_id
     or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by then
   raise exception 'Editors cannot promote or approve catalogue images';
  end if;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger guard_editor_image_insert before insert on public.product_images
 for each row execute function private.guard_editor_image_write();
create trigger guard_editor_image_update before update on public.product_images
 for each row execute function private.guard_editor_image_write();

create or replace function private.prevent_product_type_downgrade()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if old.record_type='orderable_product' and new.record_type='design_reference'
   and (exists(select 1 from public.product_pricing where product_id=old.id)
     or exists(select 1 from public.product_availability where product_id=old.id)) then
  raise exception 'Remove pricing and availability before changing an orderable product to a design reference';
 end if;
 return new;
end $$;
create trigger prevent_product_type_downgrade before update of record_type on public.products
 for each row execute function private.prevent_product_type_downgrade();

create trigger audit_products after insert or update or delete on public.products for each row execute function private.audit_row_change();
create trigger audit_categories after insert or update or delete on public.categories for each row execute function private.audit_row_change();
create trigger audit_images after insert or update or delete on public.product_images for each row execute function private.audit_row_change();
create trigger audit_pricing after insert or update or delete on public.product_pricing for each row execute function private.audit_row_change();
create trigger audit_site_content after insert or update or delete on public.site_content for each row execute function private.audit_row_change();

create or replace function private.record_product_slug_change()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,auth as $$
begin
 if old.slug is distinct from new.slug then
  insert into public.product_slug_history(product_id,old_slug,new_slug,changed_by)
  values(old.id,old.slug,new.slug,auth.uid());
 end if;
 return new;
end $$;
create trigger record_product_slug_change after update of slug on public.products
 for each row execute function private.record_product_slug_change();

do $$
declare t text;
begin
 foreach t in array array['categories','lookbook_chapters','products','product_attribute_values','product_availability','site_content','admin_memberships'] loop
  execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()',t||'_updated_at',t);
 end loop;
end $$;

-- Protect the studio's final active Owner account from accidental lockout.
create or replace function private.guard_admin_owner_integrity()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
declare active_other_owners integer;
begin
 if tg_op='UPDATE' then
  if new.user_id is distinct from old.user_id
     or new.invited_by is distinct from old.invited_by then
   raise exception 'Admin membership identity fields are immutable';
  end if;
 end if;

 if old.role='owner' and old.active then
  if tg_op='DELETE' then
   perform pg_advisory_xact_lock(20261110,1);
   select count(*) into active_other_owners
   from public.admin_memberships
   where role='owner' and active and id<>old.id;
   if active_other_owners=0 then
    raise exception 'Cannot remove or deactivate the last active Owner';
   end if;
  elsif new.role is distinct from 'owner' or not new.active then
   perform pg_advisory_xact_lock(20261110,1);
   select count(*) into active_other_owners
   from public.admin_memberships
   where role='owner' and active and id<>old.id;
   if active_other_owners=0 then
    raise exception 'Cannot remove or deactivate the last active Owner';
   end if;
  end if;
 end if;

 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.guard_admin_owner_integrity() from public,anon,authenticated;
create trigger guard_admin_owner_integrity
 before update or delete on public.admin_memberships
 for each row execute function private.guard_admin_owner_integrity();

commit;
