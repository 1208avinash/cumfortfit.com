-- Run after migrations on a disposable Supabase project.
-- 1) Structural checks
select table_name from information_schema.tables
 where table_schema='public' and table_name in
 ('products','categories','product_images','product_pricing','product_availability','admin_memberships','admin_audit_logs');
-- 2) Verify policies enabled
select relname,relrowsecurity from pg_class
 where relnamespace='public'::regnamespace and relkind='r' order by relname;
-- 3) No design-reference pricing or availability rows
select p.id,p.legacy_code,p.record_type from public.products p
join public.product_pricing x on x.product_id=p.id where p.record_type<>'orderable_product';
select p.id,p.legacy_code,p.record_type from public.products p
join public.product_availability x on x.product_id=p.id where p.record_type<>'orderable_product';
-- 4) Attribute option definitions must match parent assignment
select v.id,v.attribute_definition_id,o.attribute_definition_id
 from public.product_attribute_option_values x
 join public.product_attribute_values v on v.id=x.product_attribute_value_id
 join public.attribute_options o on o.id=x.option_id
 where v.attribute_definition_id<>o.attribute_definition_id;
-- 5) Historical slug collision scan
select h.old_slug,p.id,p.slug from public.product_slug_history h
join public.products p on p.slug=h.old_slug;
-- 6) Price visibility leakage scan
select x.id from public.product_pricing x join public.products p on p.id=x.product_id
 where p.status<>'published' or p.record_type<>'orderable_product' or not p.pricing_public;
-- 7) Storage bucket configuration
select id,name,public,file_size_limit,allowed_mime_types from storage.buckets
 where id in ('catalogue-staging','catalogue-public');
-- Auth/RLS role matrix must additionally be exercised with actual anon, ordinary user,
-- editor, admin and owner JWTs; SQL structural queries do not replace those negative tests.

-- 8) Owner safety guard must be installed.
select tgname, tgenabled
 from pg_trigger
 where tgrelid='public.admin_memberships'::regclass
   and not tgisinternal
   and tgname='guard_admin_owner_integrity';
select proname
 from pg_proc
 where pronamespace='private'::regnamespace
   and proname='guard_admin_owner_integrity';

-- 9) Membership grants: authenticated clients may not delete memberships directly.
select
 has_table_privilege('authenticated','public.admin_memberships','SELECT') as can_read_memberships,
 has_table_privilege('authenticated','public.admin_memberships','INSERT') as can_insert_memberships,
 has_table_privilege('authenticated','public.admin_memberships','UPDATE') as can_update_memberships,
 has_table_privilege('authenticated','public.admin_memberships','DELETE') as can_delete_memberships;

-- 10) Confirm editor policies are draft-scoped and do not grant taxonomy/pricing writes.
select tablename, policyname, cmd, qual, with_check
 from pg_policies
 where schemaname='public'
   and (policyname like '%_editor_%' or policyname like '%_admin_%')
 order by tablename,policyname;

-- 11) Review active Owner count before and after any team-management test.
select count(*) as active_owner_count
 from public.admin_memberships
 where role='owner' and active;

-- These are inspection queries, not a substitute for negative tests executed with
-- actual anon, ordinary-user, editor, admin and owner JWTs on a disposable project.
