\set ON_ERROR_STOP on
\if :{?cfp_staging_project_ref}
\else
  \echo 'FAIL: pass -vcfp_staging_project_ref=dkcjzisqufqgjtrgstch'
  \quit 3
\endif
SELECT (:'cfp_staging_project_ref' = 'dkcjzisqufqgjtrgstch') AS cfp_is_expected_staging \gset
\if :cfp_is_expected_staging
\else
  \echo 'FAIL: staging project reference does not match the approved staging project'
  \quit 3
\endif

-- This transaction uses SET ROLE plus JWT-claim settings to exercise RLS in PostgreSQL.
-- It is a database-level role simulation, not an Auth-issued JWT/PostgREST session.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE cfp_permission_results (
  test_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL DEFAULT ''
);
CREATE FUNCTION pg_temp.cfp_assert(test_name text, passed boolean, detail text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  INSERT INTO pg_temp.cfp_permission_results(test_name, passed, detail)
  VALUES (test_name, coalesce(passed, false), coalesce(detail, ''));
END
$fn$;
GRANT EXECUTE ON FUNCTION pg_temp.cfp_assert(text, boolean, text) TO public;

SELECT set_config('cfp.test.owner_id',
  (SELECT user_id::text FROM public.admin_memberships WHERE active AND role='owner' LIMIT 1), true) AS ignored \gset
SELECT set_config('cfp.test.admin_id',
  (SELECT user_id::text FROM public.admin_memberships WHERE active AND role='admin' LIMIT 1), true) AS ignored \gset
SELECT set_config('cfp.test.editor_id',
  (SELECT user_id::text FROM public.admin_memberships WHERE active AND role='editor' LIMIT 1), true) AS ignored \gset
SELECT set_config('cfp.test.ordinary_id',
  (SELECT u.id::text FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.admin_memberships m WHERE m.user_id=u.id)
   LIMIT 1), true) AS ignored \gset
SELECT set_config('cfp.test.run_id', 'cfp-rls-test-' || gen_random_uuid()::text, true) AS ignored \gset

DO $check_identities$
BEGIN
  PERFORM pg_temp.cfp_assert('fixture: active Owner exists',
    nullif(current_setting('cfp.test.owner_id', true), '') IS NOT NULL);
  PERFORM pg_temp.cfp_assert('fixture: active Admin exists',
    nullif(current_setting('cfp.test.admin_id', true), '') IS NOT NULL);
  PERFORM pg_temp.cfp_assert('fixture: active Editor exists',
    nullif(current_setting('cfp.test.editor_id', true), '') IS NOT NULL);
  PERFORM pg_temp.cfp_assert('fixture: ordinary authenticated user exists',
    nullif(current_setting('cfp.test.ordinary_id', true), '') IS NOT NULL);
END
$check_identities$;

-- Create isolated fixtures as the database test connection. The enclosing transaction
-- is always rolled back, including fixture rows, trigger effects, and attempted writes.
INSERT INTO public.categories(name, slug)
VALUES ('RLS Audit Fixture', current_setting('cfp.test.run_id') || '-category')
RETURNING id \gset cfp_fixture_
INSERT INTO public.lookbook_chapters(name, slug)
VALUES ('RLS Audit Fixture', current_setting('cfp.test.run_id') || '-chapter')
RETURNING id \gset cfp_chapter_

INSERT INTO public.products
 (legacy_code, slug, title, record_type, audience, category_id, status,
  homepage_visible, lookbook_visible, pricing_public)
VALUES
 (current_setting('cfp.test.run_id')||'-home', current_setting('cfp.test.run_id')||'-home',
  'RLS test homepage product', 'orderable_product','women', :'cfp_fixture_id','published',true,false,true),
 (current_setting('cfp.test.run_id')||'-lookbook', current_setting('cfp.test.run_id')||'-lookbook',
  'RLS test Lookbook product', 'orderable_product','women', :'cfp_fixture_id','published',false,true,true),
 (current_setting('cfp.test.run_id')||'-hidden', current_setting('cfp.test.run_id')||'-hidden',
  'RLS test hidden product', 'orderable_product','women', :'cfp_fixture_id','published',false,false,true),
 (current_setting('cfp.test.run_id')||'-draft', current_setting('cfp.test.run_id')||'-draft',
  'RLS test draft product', 'orderable_product','women', :'cfp_fixture_id','draft',true,true,true),
 (current_setting('cfp.test.run_id')||'-no-price', current_setting('cfp.test.run_id')||'-no-price',
  'RLS test private pricing product', 'orderable_product','women', :'cfp_fixture_id','published',true,false,false),
 (current_setting('cfp.test.run_id')||'-archived', current_setting('cfp.test.run_id')||'-archived',
  'RLS test archived product', 'orderable_product','women', :'cfp_fixture_id','archived',false,false,false),
 (current_setting('cfp.test.run_id')||'-reference', current_setting('cfp.test.run_id')||'-reference',
  'RLS test design reference', 'design_reference','women', :'cfp_fixture_id','published',true,true,false)
;

-- Fetch fixture IDs by their unique transaction-only legacy codes.
SELECT id AS cfp_home_product_id FROM public.products
 WHERE legacy_code=current_setting('cfp.test.run_id')||'-home' \gset
SELECT id AS cfp_lookbook_product_id FROM public.products
 WHERE legacy_code=current_setting('cfp.test.run_id')||'-lookbook' \gset
SELECT id AS cfp_hidden_product_id FROM public.products
 WHERE legacy_code=current_setting('cfp.test.run_id')||'-hidden' \gset
SELECT id AS cfp_draft_product_id FROM public.products
 WHERE legacy_code=current_setting('cfp.test.run_id')||'-draft' \gset
SELECT id AS cfp_no_price_product_id FROM public.products
 WHERE legacy_code=current_setting('cfp.test.run_id')||'-no-price' \gset
SELECT id AS cfp_archived_product_id FROM public.products
 WHERE legacy_code=current_setting('cfp.test.run_id')||'-archived' \gset
SELECT id AS cfp_reference_product_id FROM public.products
 WHERE legacy_code=current_setting('cfp.test.run_id')||'-reference' \gset

INSERT INTO public.product_lookbook_chapters(product_id, chapter_id, sort_order)
VALUES (:'cfp_lookbook_product_id', :'cfp_chapter_id', 1);
INSERT INTO public.product_images
 (product_id,bucket_id,storage_path,alt_text,sort_order,is_primary,approved_at)
VALUES
 (:'cfp_home_product_id','catalogue-public',current_setting('cfp.test.run_id')||'/home.webp',
  'RLS fixture',1,true,now()),
 (:'cfp_draft_product_id','catalogue-public',current_setting('cfp.test.run_id')||'/draft.webp',
  'RLS fixture draft',1,true,now()),
 (:'cfp_draft_product_id','catalogue-staging',current_setting('cfp.test.run_id')||'/staging.webp',
  'RLS fixture staging',2,false,null);

INSERT INTO public.product_pricing(product_id,price_type,amount_minor,currency_code,is_active)
VALUES
 (:'cfp_home_product_id','fixed',10000,'INR',true),
 (:'cfp_hidden_product_id','fixed',20000,'INR',true),
 (:'cfp_no_price_product_id','fixed',30000,'INR',true);
INSERT INTO public.product_availability(product_id,availability_status)
VALUES
 (:'cfp_home_product_id','available'),
 (:'cfp_hidden_product_id','available');

INSERT INTO public.attribute_definitions(name,slug,data_type,applies_to,active)
VALUES ('RLS Audit Fixture',current_setting('cfp.test.run_id')||'-attribute','text','all',true)
RETURNING id \gset cfp_attribute_
INSERT INTO public.product_attribute_values(product_id,attribute_definition_id,text_value)
VALUES
 (:'cfp_home_product_id',:'cfp_attribute_id','public fixture'),
 (:'cfp_draft_product_id',:'cfp_attribute_id','draft fixture');
INSERT INTO public.site_content(content_key,content_type,title,body,status)
VALUES
 (current_setting('cfp.test.run_id')||'-published-content','text_block','RLS published fixture','fixture','published'),
 (current_setting('cfp.test.run_id')||'-draft-content','text_block','RLS draft fixture','fixture','draft');

-- Anonymous reads: only published, explicitly channel-visible products; no staff data.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','anon',true);
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $anonymous_reads$
DECLARE run_id text := current_setting('cfp.test.run_id'); n integer;
BEGIN
  SELECT count(*) INTO n FROM public.products
   WHERE legacy_code IN (run_id||'-home',run_id||'-lookbook');
  PERFORM pg_temp.cfp_assert('anon: reads eligible published catalogue rows', n=2, 'expected homepage and Lookbook fixtures');
  PERFORM pg_temp.cfp_assert('fixture: homepage-only visibility is explicit',
    (SELECT count(*)=1 FROM public.products
      WHERE legacy_code=run_id||'-home' AND homepage_visible AND NOT lookbook_visible));
  PERFORM pg_temp.cfp_assert('fixture: Lookbook-only visibility is explicit',
    (SELECT count(*)=1 FROM public.products
      WHERE legacy_code=run_id||'-lookbook' AND lookbook_visible AND NOT homepage_visible));
  SELECT count(*) INTO n FROM public.products
   WHERE legacy_code IN (run_id||'-hidden',run_id||'-draft',run_id||'-archived');
  PERFORM pg_temp.cfp_assert('anon: cannot read hidden, draft, or archived products', n=0);
  SELECT count(*) INTO n FROM public.product_images
   WHERE storage_path=run_id||'/draft.webp';
  PERFORM pg_temp.cfp_assert('anon: cannot read unpublished product image metadata', n=0);
  SELECT count(*) INTO n FROM public.product_pricing x JOIN public.products p ON p.id=x.product_id
   WHERE p.legacy_code=run_id||'-home';
  PERFORM pg_temp.cfp_assert('anon: reads eligible public product pricing', n=1);
  SELECT count(*) INTO n FROM public.product_pricing x JOIN public.products p ON p.id=x.product_id
   WHERE p.legacy_code=run_id||'-hidden';
  PERFORM pg_temp.cfp_assert('anon: cannot read pricing for non-visible product', n=0);
  SELECT count(*) INTO n FROM public.product_pricing x JOIN public.products p ON p.id=x.product_id
   WHERE p.legacy_code=run_id||'-no-price';
  PERFORM pg_temp.cfp_assert('anon: cannot read pricing when pricing_public is false', n=0);
  SELECT count(*) INTO n FROM public.product_images
   WHERE storage_path=run_id||'/home.webp' AND approved_at IS NOT NULL;
  PERFORM pg_temp.cfp_assert('anon: can read approved public image metadata for eligible product', n=1);
  SELECT count(*) INTO n FROM public.product_images
   WHERE storage_path=run_id||'/staging.webp';
  PERFORM pg_temp.cfp_assert('anon: cannot read staging image metadata', n=0);
  SELECT count(*) INTO n FROM public.product_availability x JOIN public.products p ON p.id=x.product_id
   WHERE p.legacy_code=run_id||'-hidden';
  PERFORM pg_temp.cfp_assert('anon: cannot read availability for non-visible product', n=0);
  SELECT count(*) INTO n FROM public.site_content
   WHERE content_key=run_id||'-draft-content';
  PERFORM pg_temp.cfp_assert('anon: cannot read draft site content', n=0);
  SELECT count(*) INTO n FROM public.admin_memberships;
  PERFORM pg_temp.cfp_assert('anon: cannot read admin memberships',n=0);
  SELECT count(*) INTO n FROM public.admin_audit_logs;
  PERFORM pg_temp.cfp_assert('anon: cannot read audit history',n=0);
END
$anonymous_reads$;

-- Ordinary authenticated user: public reads only and no catalogue/admin writes.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('cfp.test.ordinary_id'),true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub',current_setting('cfp.test.ordinary_id'),'role','authenticated')::text,true);
DO $ordinary_permissions$
DECLARE run_id text := current_setting('cfp.test.run_id'); n integer; affected integer;
BEGIN
  SELECT count(*) INTO n FROM public.products WHERE legacy_code=run_id||'-draft';
  PERFORM pg_temp.cfp_assert('ordinary: cannot read draft catalogue rows',n=0);
  SELECT count(*) INTO n FROM public.admin_memberships
   WHERE user_id<>current_setting('cfp.test.ordinary_id')::uuid;
  PERFORM pg_temp.cfp_assert('ordinary: cannot read other staff memberships',n=0);
  SELECT count(*) INTO n FROM public.admin_audit_logs;
  PERFORM pg_temp.cfp_assert('ordinary: cannot read audit history',n=0);
  BEGIN
    INSERT INTO public.products(legacy_code,slug,title,record_type)
    VALUES (run_id||'-ordinary-insert',run_id||'-ordinary-insert','ordinary test','design_reference');
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM pg_temp.cfp_assert('ordinary: cannot insert catalogue records',affected=0);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.cfp_assert('ordinary: cannot insert catalogue records',true);
  END;
  BEGIN
    UPDATE public.products SET title=title WHERE legacy_code=run_id||'-home';
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM pg_temp.cfp_assert('ordinary: cannot update catalogue records',affected=0);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.cfp_assert('ordinary: cannot update catalogue records',true);
  END;
  SELECT count(*) INTO n FROM public.site_content WHERE status<>'published';
  PERFORM pg_temp.cfp_assert('ordinary: cannot read staff-only content',n=0);
END
$ordinary_permissions$;

-- Editor: draft create/edit allowed; publishing, published-record edits, and privileged
-- associated-data edits are expected to be denied. Failed assertions expose policy gaps.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('cfp.test.editor_id'),true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub',current_setting('cfp.test.editor_id'),'role','authenticated')::text,true);
INSERT INTO public.products(legacy_code,slug,title,record_type,audience,status)
VALUES (current_setting('cfp.test.run_id')||'-editor-draft',
        current_setting('cfp.test.run_id')||'-editor-draft','editor draft','design_reference','women','draft')
RETURNING id \gset cfp_editor_product_
DO $editor_permissions$
DECLARE run_id text := current_setting('cfp.test.run_id'); n integer; affected integer;
BEGIN
  PERFORM pg_temp.cfp_assert('editor: can read staff catalogue data',
    (SELECT count(*)>0 FROM public.products WHERE legacy_code=run_id||'-draft'));
  UPDATE public.products SET title='editor draft edited'
   WHERE legacy_code=run_id||'-editor-draft';
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM pg_temp.cfp_assert('editor: can edit own draft product',affected=1);
  BEGIN
    UPDATE public.products SET status='published' WHERE legacy_code=run_id||'-editor-draft';
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM pg_temp.cfp_assert('editor: cannot publish draft product',affected=0);
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    PERFORM pg_temp.cfp_assert('editor: cannot publish draft product',true);
  END;
  BEGIN
    UPDATE public.products SET title=title WHERE legacy_code=run_id||'-home';
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM pg_temp.cfp_assert('editor: cannot edit published product',affected=0);
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    PERFORM pg_temp.cfp_assert('editor: cannot edit published product',true);
  END;
  BEGIN
    UPDATE public.products SET status='draft' WHERE legacy_code=run_id||'-home';
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM pg_temp.cfp_assert('editor: cannot unpublish product',affected=0);
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    PERFORM pg_temp.cfp_assert('editor: cannot unpublish product',true);
  END;
  UPDATE public.product_pricing SET amount_minor=amount_minor
   WHERE product_id=(SELECT id FROM public.products WHERE legacy_code=run_id||'-home');
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM pg_temp.cfp_assert('editor: cannot edit pricing on published product',affected=0);
  UPDATE public.product_availability SET notes=notes
   WHERE product_id=(SELECT id FROM public.products WHERE legacy_code=run_id||'-home');
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM pg_temp.cfp_assert('editor: cannot edit availability on published product',affected=0);
  UPDATE public.product_attribute_values SET text_value=text_value
   WHERE product_id=(SELECT id FROM public.products WHERE legacy_code=run_id||'-home');
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM pg_temp.cfp_assert('editor: cannot edit attributes on published product',affected=0);
  BEGIN
    UPDATE public.site_content SET body=body
     WHERE content_key=run_id||'-published-content';
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM pg_temp.cfp_assert('editor: cannot edit published site content',affected=0);
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    PERFORM pg_temp.cfp_assert('editor: cannot edit published site content',true);
  END;
  BEGIN
    INSERT INTO public.product_images
     (product_id,bucket_id,storage_path,is_primary,approved_at,approved_by)
    VALUES ((SELECT id FROM public.products WHERE legacy_code=run_id||'-draft'),
     'catalogue-public',run_id||'/editor-unapproved.webp',false,now(),
     current_setting('cfp.test.editor_id')::uuid);
    PERFORM pg_temp.cfp_assert('editor: cannot approve/publish product images',false);
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    PERFORM pg_temp.cfp_assert('editor: cannot approve/publish product images',true);
  END;
  UPDATE public.site_content SET body='editor draft edited'
   WHERE content_key=run_id||'-draft-content';
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM pg_temp.cfp_assert('editor: can edit draft site content',affected=1);
  SELECT count(*) INTO n FROM public.admin_audit_logs;
  PERFORM pg_temp.cfp_assert('editor: cannot read restricted audit history',n=0);
  SELECT count(*) INTO n FROM public.admin_memberships
   WHERE user_id<>current_setting('cfp.test.editor_id')::uuid;
  PERFORM pg_temp.cfp_assert('editor: cannot read other memberships',n=0);
  UPDATE public.admin_memberships SET active=active
   WHERE user_id=current_setting('cfp.test.editor_id')::uuid;
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM pg_temp.cfp_assert('editor: cannot manage memberships',affected=0);
END
$editor_permissions$;

-- Admin: normal catalogue publication permitted, but membership escalation denied.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('cfp.test.admin_id'),true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub',current_setting('cfp.test.admin_id'),'role','authenticated')::text,true);
DO $admin_permissions$
DECLARE n integer; affected integer; run_id text := current_setting('cfp.test.run_id');
BEGIN
  SELECT count(*) INTO n FROM public.admin_memberships;
  PERFORM pg_temp.cfp_assert('admin: can read staff memberships',n>0);
  SELECT count(*) INTO n FROM public.admin_audit_logs;
  SELECT count(*) INTO n FROM public.admin_audit_logs a
   JOIN public.products p ON p.id=a.entity_id
   WHERE a.entity_type='products' AND p.legacy_code LIKE run_id||'-%';
  PERFORM pg_temp.cfp_assert('admin: can read fixture audit history',n>0);
  BEGIN
    INSERT INTO public.products(legacy_code,slug,title,record_type,status)
    VALUES (run_id||'-admin-draft',run_id||'-admin-draft','admin draft','design_reference','draft');
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM pg_temp.cfp_assert('admin: can create catalogue records',affected=1);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.cfp_assert('admin: can create catalogue records',false,SQLSTATE);
  END;
  UPDATE public.products SET title='admin edited draft'
   WHERE legacy_code=run_id||'-draft';
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM pg_temp.cfp_assert('admin: can edit catalogue records',affected=1);
  UPDATE public.products SET status='published'
   WHERE legacy_code=run_id||'-draft';
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM pg_temp.cfp_assert('admin: can publish eligible product',affected=1);
  UPDATE public.products SET status='draft'
   WHERE legacy_code=run_id||'-draft';
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM pg_temp.cfp_assert('admin: can unpublish product',affected=1);
  UPDATE public.product_images
   SET bucket_id='catalogue-public',approved_at=now(),
       approved_by=current_setting('cfp.test.admin_id')::uuid
   WHERE storage_path=run_id||'/staging.webp';
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM pg_temp.cfp_assert('admin: can approve staging image metadata',affected=1);
  BEGIN
    BEGIN
      UPDATE public.admin_memberships SET role='owner'
       WHERE user_id=current_setting('cfp.test.admin_id')::uuid;
      GET DIAGNOSTICS affected=ROW_COUNT;
      IF affected>0 THEN RAISE EXCEPTION 'cfp_test_rollback_self_promotion'; END IF;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM<>'cfp_test_rollback_self_promotion' THEN RAISE; END IF;
    END;
    PERFORM pg_temp.cfp_assert('admin: cannot promote self to Owner',affected=0);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.cfp_assert('admin: cannot promote self to Owner',true);
  END;
  BEGIN
    UPDATE public.admin_memberships SET active=active
     WHERE user_id=current_setting('cfp.test.owner_id')::uuid;
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM pg_temp.cfp_assert('admin: cannot manage Owner membership privileges',affected=0);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.cfp_assert('admin: cannot manage Owner membership privileges',true);
  END;
END
$admin_permissions$;

-- Owner: membership write, publishing, staff read, and audit read.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('cfp.test.owner_id'),true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub',current_setting('cfp.test.owner_id'),'role','authenticated')::text,true);
DO $owner_permissions$
DECLARE n integer; affected integer; run_id text := current_setting('cfp.test.run_id');
BEGIN
  SELECT count(*) INTO n FROM public.admin_memberships;
  PERFORM pg_temp.cfp_assert('owner: can read staff memberships',n>0);
  PERFORM pg_temp.cfp_assert('owner: can read staff catalogue data',
    (SELECT count(*)>0 FROM public.products));
  SELECT count(*) INTO n FROM public.admin_audit_logs;
  SELECT count(*) INTO n FROM public.admin_audit_logs a
   JOIN public.products p ON p.id=a.entity_id
   WHERE a.entity_type='products' AND p.legacy_code LIKE run_id||'-%';
  PERFORM pg_temp.cfp_assert('owner: can read fixture audit history',n>0);
  BEGIN
    INSERT INTO public.admin_memberships(user_id,role,active,invited_by)
    VALUES (current_setting('cfp.test.ordinary_id')::uuid,'editor',true,
            current_setting('cfp.test.owner_id')::uuid);
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM pg_temp.cfp_assert('owner: can add test membership',affected=1);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.cfp_assert('owner: can add test membership',false,SQLSTATE);
  END;
  BEGIN
    UPDATE public.admin_memberships SET active=false
     WHERE user_id=current_setting('cfp.test.ordinary_id')::uuid AND role='editor';
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM pg_temp.cfp_assert('owner: can update test membership',affected=1);
    UPDATE public.admin_memberships SET role='admin',active=true
     WHERE user_id=current_setting('cfp.test.ordinary_id')::uuid;
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM pg_temp.cfp_assert('owner: can promote test membership',affected=1);
    UPDATE public.admin_memberships SET active=false
     WHERE user_id=current_setting('cfp.test.ordinary_id')::uuid;
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM pg_temp.cfp_assert('owner: can remove test membership by deactivation',affected=1);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.cfp_assert('owner: membership lifecycle operations',false,SQLSTATE);
  END;
  BEGIN
    INSERT INTO public.products(legacy_code,slug,title,record_type,status)
    VALUES (run_id||'-owner-draft',run_id||'-owner-draft','owner draft','design_reference','draft');
    GET DIAGNOSTICS affected=ROW_COUNT;
    PERFORM pg_temp.cfp_assert('owner: can create catalogue records',affected=1);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.cfp_assert('owner: can create catalogue records',false,SQLSTATE);
  END;
  UPDATE public.products SET title='owner edited draft'
   WHERE legacy_code=run_id||'-draft';
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM pg_temp.cfp_assert('owner: can edit catalogue records',affected=1);
  UPDATE public.products SET status='published'
   WHERE legacy_code=run_id||'-draft';
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM pg_temp.cfp_assert('owner: can publish product',affected=1);
  UPDATE public.products SET status='draft'
   WHERE legacy_code=run_id||'-home';
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM pg_temp.cfp_assert('owner: can unpublish product',affected=1);
  BEGIN
    INSERT INTO public.product_pricing(product_id,price_type,amount_minor,currency_code)
    VALUES ((SELECT id FROM public.products WHERE legacy_code=run_id||'-reference'),
      'fixed',5000,'INR');
    PERFORM pg_temp.cfp_assert('design references: cannot be assigned pricing',false);
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.cfp_assert('design references: cannot be assigned pricing',true);
  END;
  BEGIN
    INSERT INTO public.product_availability(product_id,availability_status)
    VALUES ((SELECT id FROM public.products WHERE legacy_code=run_id||'-reference'),'available');
    PERFORM pg_temp.cfp_assert('design references: cannot be assigned availability',false);
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.cfp_assert('design references: cannot be assigned availability',true);
  END;
END
$owner_permissions$;

-- Public storage URL access is independent of product_images RLS for a public bucket.
-- Full upload/read/delete tests use actual Auth sessions in storage-permission.test.mjs.
RESET ROLE;
DO $storage_and_catalog_assertions$
DECLARE n integer;
BEGIN
  PERFORM pg_temp.cfp_assert('grants: authenticated has product select',
    has_table_privilege('authenticated','public.products','SELECT'));
  PERFORM pg_temp.cfp_assert('grants: authenticated has product insert',
    has_table_privilege('authenticated','public.products','INSERT'));
  PERFORM pg_temp.cfp_assert('grants: authenticated has no product delete',
    NOT has_table_privilege('authenticated','public.products','DELETE'));
  PERFORM pg_temp.cfp_assert('grants: owner membership management has insert grant',
    has_table_privilege('authenticated','public.admin_memberships','INSERT'));
  PERFORM pg_temp.cfp_assert('grants: owner membership management has update grant',
    has_table_privilege('authenticated','public.admin_memberships','UPDATE'));
  PERFORM pg_temp.cfp_assert('RLS: sensitive catalogue and staff tables enabled',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
      WHERE ns.nspname='public' AND c.relname IN
       ('products','product_images','product_pricing','product_availability','admin_memberships','admin_audit_logs')
       AND NOT c.relrowsecurity));
  PERFORM pg_temp.cfp_assert('function: authenticated can execute role resolver',
    has_function_privilege('authenticated','private.current_admin_role()','EXECUTE'));
  PERFORM pg_temp.cfp_assert('function: anon cannot execute role resolver',
    NOT has_function_privilege('anon','private.current_admin_role()','EXECUTE'));
  PERFORM pg_temp.cfp_assert('schema: authenticated can use private schema',
    has_schema_privilege('authenticated','private','USAGE'));
  PERFORM pg_temp.cfp_assert('schema: anon cannot use private schema',
    NOT has_schema_privilege('anon','private','USAGE'));
  PERFORM pg_temp.cfp_assert('audit: expected tables have audit triggers',
    NOT EXISTS (SELECT 1 FROM (VALUES
       ('admin_memberships'),('products'),('categories'),('product_images'),
       ('product_pricing'),('product_availability'),('site_content'),
       ('lookbook_chapters'),('product_attribute_values'))
      AS expected(table_name)
      WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
        WHERE ns.nspname='public' AND c.relname=expected.table_name
          AND NOT t.tgisinternal AND t.tgname LIKE 'audit_%')));
  PERFORM pg_temp.cfp_assert('storage: required named buckets exist',
    (SELECT count(*)=2 FROM storage.buckets
      WHERE id IN ('catalogue-staging','catalogue-public')));
  PERFORM pg_temp.cfp_assert('storage: staging bucket is private',
    (SELECT NOT b."public" FROM storage.buckets b WHERE id='catalogue-staging'));
  PERFORM pg_temp.cfp_assert('storage: published bucket is public',
    (SELECT b."public" FROM storage.buckets b WHERE id='catalogue-public'));
END
$storage_and_catalog_assertions$;

TABLE pg_temp.cfp_permission_results;
SELECT count(*) FILTER (WHERE passed) AS passed,
       count(*) FILTER (WHERE NOT passed) AS failed,
       count(*) AS total
FROM pg_temp.cfp_permission_results;
DO $fail_on_test_failures$
DECLARE failures integer;
BEGIN
  SELECT count(*) INTO failures FROM pg_temp.cfp_permission_results WHERE NOT passed;
  IF failures>0 THEN
    RAISE EXCEPTION 'Permission audit failed: % test(s) failed; see result table above', failures;
  END IF;
END
$fail_on_test_failures$;
ROLLBACK;
