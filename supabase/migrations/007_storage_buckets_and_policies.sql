-- CUSTOM FIT PRIME / migration 007
-- Bucket policy candidate. Public bucket is public-read; uploads only to private staging.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values
 ('catalogue-staging','catalogue-staging',false,10485760,array['image/jpeg','image/png','image/webp','image/avif']),
 ('catalogue-public','catalogue-public',true,10485760,array['image/jpeg','image/png','image/webp','image/avif']);
create policy staging_staff_read on storage.objects for select to authenticated
 using(bucket_id='catalogue-staging' and private.current_admin_role() in ('owner','admin','editor'));
create policy staging_editor_upload on storage.objects for insert to authenticated
 with check(bucket_id='catalogue-staging' and private.current_admin_role() in ('owner','admin','editor')
  and (storage.foldername(name))[1]='products');
create policy staging_admin_delete on storage.objects for delete to authenticated
 using(bucket_id='catalogue-staging' and private.current_admin_role() in ('owner','admin'));
create policy public_catalogue_read on storage.objects for select to anon,authenticated
 using(bucket_id='catalogue-public');
create policy public_catalogue_admin_insert on storage.objects for insert to authenticated
 with check(bucket_id='catalogue-public' and private.current_admin_role() in ('owner','admin'));
create policy public_catalogue_admin_update on storage.objects for update to authenticated
 using(bucket_id='catalogue-public' and private.current_admin_role() in ('owner','admin'))
 with check(bucket_id='catalogue-public' and private.current_admin_role() in ('owner','admin'));
create policy public_catalogue_admin_delete on storage.objects for delete to authenticated
 using(bucket_id='catalogue-public' and private.current_admin_role() in ('owner','admin'));
commit;
