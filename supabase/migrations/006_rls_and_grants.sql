-- CUSTOM FIT PRIME / migration 006
-- Explicit table grants + RLS. Validate policy composition on a disposable Supabase project.
begin;
revoke all on all tables in schema public from anon,authenticated;
revoke all on all sequences in schema public from anon,authenticated;
grant usage on schema public to anon,authenticated;
grant select on public.currencies,public.categories,public.lookbook_chapters,public.products,
 public.product_images,public.product_lookbook_chapters,public.attribute_definitions,
 public.attribute_options,public.product_attribute_values,public.product_attribute_option_values,
 public.product_pricing,public.product_availability,public.site_content to anon,authenticated;
grant select,insert,update on public.categories,public.lookbook_chapters,public.products,
 public.product_images,public.product_lookbook_chapters,public.attribute_definitions,
 public.attribute_options,public.product_attribute_values,public.product_attribute_option_values,
 public.product_pricing,public.product_availability,public.site_content to authenticated;
grant select,insert,update on public.admin_memberships to authenticated;
grant select on public.admin_audit_logs,public.product_slug_history to authenticated;
grant usage,select on all sequences in schema public to authenticated;

alter table public.currencies enable row level security;
alter table public.categories enable row level security;
alter table public.lookbook_chapters enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_lookbook_chapters enable row level security;
alter table public.attribute_definitions enable row level security;
alter table public.attribute_options enable row level security;
alter table public.product_attribute_values enable row level security;
alter table public.product_attribute_option_values enable row level security;
alter table public.product_pricing enable row level security;
alter table public.product_availability enable row level security;
alter table public.site_content enable row level security;
alter table public.admin_memberships enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.product_slug_history enable row level security;

create policy currency_public_read on public.currencies for select to anon,authenticated using(active);
create policy categories_public_read on public.categories for select to anon,authenticated using(active);
create policy chapters_public_read on public.lookbook_chapters for select to anon,authenticated using(active);
create policy products_public_read on public.products for select to anon,authenticated
 using(status='published' and (homepage_visible or lookbook_visible));
create policy images_public_read on public.product_images for select to anon,authenticated
 using(bucket_id='catalogue-public' and approved_at is not null and exists(
  select 1 from public.products p where p.id=product_id and p.status='published'));
create policy product_chapters_public_read on public.product_lookbook_chapters for select to anon,authenticated
 using(exists(select 1 from public.products p where p.id=product_id and p.status='published' and p.lookbook_visible));
create policy attributes_public_read on public.attribute_definitions for select to anon,authenticated
 using(active and exists(select 1 from public.products p where p.status='published'));
create policy options_public_read on public.attribute_options for select to anon,authenticated using(active);
create policy product_attribute_public_read on public.product_attribute_values for select to anon,authenticated
 using(exists(select 1 from public.products p where p.id=product_id and p.status='published'));
create policy product_attribute_options_public_read on public.product_attribute_option_values for select to anon,authenticated
 using(exists(select 1 from public.product_attribute_values v join public.products p on p.id=v.product_id
  where v.id=product_attribute_value_id and p.status='published'));
create policy pricing_public_read on public.product_pricing for select to anon,authenticated
 using(is_active and (valid_from is null or valid_from<=now()) and (valid_until is null or valid_until>now())
  and exists(select 1 from public.products p where p.id=product_id and p.record_type='orderable_product'
   and p.status='published' and p.pricing_public));
create policy availability_public_read on public.product_availability for select to anon,authenticated
 using(exists(select 1 from public.products p where p.id=product_id and p.status='published' and p.record_type='orderable_product'));
create policy site_content_public_read on public.site_content for select to anon,authenticated using(status='published');

-- Memberships and audit are private to owner/admin. Membership self-read supports app role resolution.
create policy memberships_self_or_owner_read on public.admin_memberships for select to authenticated
 using(user_id=auth.uid() or private.current_admin_role() in ('owner','admin'));
create policy memberships_owner_manage on public.admin_memberships for all to authenticated
 using(private.current_admin_role()='owner') with check(private.current_admin_role()='owner');
create policy audit_admin_read on public.admin_audit_logs for select to authenticated
 using(private.current_admin_role() in ('owner','admin'));
create policy slug_history_admin_read on public.product_slug_history for select to authenticated
 using(private.current_admin_role() in ('owner','admin'));

-- Catalogue writes are explicitly role-scoped; editor updates further constrained by DB triggers.
do $$
declare tab text;
begin
 foreach tab in array array['categories','lookbook_chapters','products','product_images','product_lookbook_chapters',
 'attribute_definitions','attribute_options','product_attribute_values','product_attribute_option_values',
 'product_pricing','product_availability','site_content'] loop
  execute format('create policy %I on public.%I for select to authenticated using(private.current_admin_role() in (''owner'',''admin'',''editor''))',tab||'_staff_read',tab);
  execute format('create policy %I on public.%I for insert to authenticated with check(private.current_admin_role() in (''owner'',''admin'',''editor''))',tab||'_staff_insert',tab);
  execute format('create policy %I on public.%I for update to authenticated using(private.current_admin_role() in (''owner'',''admin'',''editor'')) with check(private.current_admin_role() in (''owner'',''admin'',''editor''))',tab||'_staff_update',tab);
 end loop;
end $$;
revoke insert,update,delete on public.admin_audit_logs from anon,authenticated;
revoke delete on public.admin_memberships from anon,authenticated;
revoke insert,update,delete on public.product_slug_history from anon,authenticated;
commit;
