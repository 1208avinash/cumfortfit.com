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
