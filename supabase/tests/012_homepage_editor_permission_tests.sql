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

-- Role simulation with SET ROLE and request.jwt.claim.* is not an Auth-issued JWT,
-- PostgREST session, or browser/API integration test.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE cfp_homepage_results (
  test_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL DEFAULT ''
);
CREATE FUNCTION pg_temp.cfp_homepage_assert(
  test_name text, passed boolean, detail text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  INSERT INTO pg_temp.cfp_homepage_results(test_name, passed, detail)
  VALUES (test_name, coalesce(passed, false), coalesce(detail, ''));
END
$fn$;
GRANT EXECUTE ON FUNCTION pg_temp.cfp_homepage_assert(text, boolean, text) TO public;

SELECT set_config('cfp.homepage.owner_id',
  (SELECT user_id::text FROM public.admin_memberships WHERE active AND role = 'owner' LIMIT 1), true) AS ignored \gset
SELECT set_config('cfp.homepage.admin_id',
  (SELECT user_id::text FROM public.admin_memberships WHERE active AND role = 'admin' LIMIT 1), true) AS ignored \gset
SELECT set_config('cfp.homepage.editor_id',
  (SELECT user_id::text FROM public.admin_memberships WHERE active AND role = 'editor' LIMIT 1), true) AS ignored \gset
SELECT set_config('cfp.homepage.ordinary_id',
  (SELECT u.id::text FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.admin_memberships m WHERE m.user_id = u.id)
   LIMIT 1), true) AS ignored \gset
SELECT set_config('cfp.homepage.run_id', 'cfp-homepage-test-' || gen_random_uuid()::text, true) AS ignored \gset
SELECT set_config('cfp.homepage.initial_published_id',
  coalesce((SELECT id::text FROM public.homepage_releases WHERE status = 'published' LIMIT 1), 'none'),
  true) AS ignored \gset
SELECT set_config('cfp.homepage.initial_published_count',
  (SELECT count(*)::text FROM public.homepage_releases WHERE status = 'published'),
  true) AS ignored \gset
SELECT set_config('cfp.homepage.initial_draft_count',
  (SELECT count(*)::text FROM public.homepage_releases WHERE status = 'draft'),
  true) AS ignored \gset

DO $check_test_identities$
BEGIN
  IF nullif(current_setting('cfp.homepage.owner_id', true), '') IS NULL
    OR nullif(current_setting('cfp.homepage.admin_id', true), '') IS NULL
    OR nullif(current_setting('cfp.homepage.editor_id', true), '') IS NULL
    OR nullif(current_setting('cfp.homepage.ordinary_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'Homepage tests require active Owner, Admin, Editor, and ordinary-user fixtures';
  END IF;
  IF current_setting('cfp.homepage.initial_draft_count')::integer <> 0 THEN
    RAISE EXCEPTION 'Homepage tests require no pre-existing active draft; refusing to alter existing draft data';
  END IF;
END
$check_test_identities$;

CREATE TEMP TABLE cfp_homepage_catalogue_snapshot AS
SELECT legacy_code, id, homepage_card_summary
FROM public.products
WHERE legacy_code IN ('CF-01', 'CF-02', 'CF-03', 'CF-04',
                      'CF-05', 'CF-06', 'CF-07', 'CF-08');

INSERT INTO public.products (
  legacy_code, slug, title, description, record_type, status, homepage_visible
)
SELECT
  current_setting('cfp.homepage.run_id') || '-' || lpad(n::text, 2, '0'),
  current_setting('cfp.homepage.run_id') || '-' || lpad(n::text, 2, '0'),
  'Homepage test product ' || n,
  'Isolated homepage editor permission-test fixture',
  'orderable_product',
  'published',
  true
FROM generate_series(1, 8) AS series(n);

INSERT INTO public.products (
  legacy_code, slug, title, record_type, status, homepage_visible
)
VALUES (
  current_setting('cfp.homepage.run_id') || '-ineligible',
  current_setting('cfp.homepage.run_id') || '-ineligible',
  'Homepage test ineligible product',
  'orderable_product',
  'draft',
  false
);

SELECT set_config('cfp.homepage.product_ids',
  (SELECT array_agg(id ORDER BY legacy_code)::text
   FROM public.products
   WHERE legacy_code LIKE current_setting('cfp.homepage.run_id') || '-%'
     AND legacy_code <> current_setting('cfp.homepage.run_id') || '-ineligible'), true) AS ignored \gset
SELECT set_config('cfp.homepage.ineligible_id',
  (SELECT id::text FROM public.products
   WHERE legacy_code = current_setting('cfp.homepage.run_id') || '-ineligible'), true) AS ignored \gset
SELECT set_config('cfp.homepage.hero_image_path',
  current_setting('cfp.homepage.run_id') || '/approved-hero.webp', true) AS ignored \gset
SELECT set_config('cfp.homepage.poster_image_path',
  current_setting('cfp.homepage.run_id') || '/approved-poster.webp', true) AS ignored \gset
SELECT set_config('cfp.homepage.atelier_image_path',
  current_setting('cfp.homepage.run_id') || '/approved-atelier.webp', true) AS ignored \gset

INSERT INTO public.product_images (
  product_id, bucket_id, storage_path, sort_order, approved_at, approved_by
)
SELECT (current_setting('cfp.homepage.product_ids')::uuid[])[1],
       'catalogue-public',
       current_setting('cfp.homepage.hero_image_path'),
       0, clock_timestamp(), current_setting('cfp.homepage.owner_id')::uuid
UNION ALL
SELECT (current_setting('cfp.homepage.product_ids')::uuid[])[1],
       'catalogue-public',
       current_setting('cfp.homepage.poster_image_path'),
       1, clock_timestamp(), current_setting('cfp.homepage.owner_id')::uuid
UNION ALL
SELECT (current_setting('cfp.homepage.product_ids')::uuid[])[1],
       'catalogue-public',
       current_setting('cfp.homepage.atelier_image_path'),
       2, clock_timestamp(), current_setting('cfp.homepage.owner_id')::uuid;

SELECT set_config('cfp.homepage.sections', (
  SELECT jsonb_agg(
    jsonb_build_object(
      'section_key', section_key,
      'section_type', section_key,
      'content', content,
      'is_visible', true,
      'sort_order', sort_order
    ) ORDER BY sort_order
  )::text
  FROM (VALUES
    ('hero', 0, jsonb_build_object(
      'eyebrow', 'A modern Indian couture atelier',
      'heading', 'The art of a perfect fit.',
      'body', 'A considered homepage test description.',
      'image_path', current_setting('cfp.homepage.hero_image_path'),
      'image_alt', 'Homepage test hero image',
      'primary_cta_label', 'Explore the collection',
      'primary_cta_href', '#collections'
    )),
    ('introduction', 1, jsonb_build_object(
      'eyebrow', 'Beyond the ordinary',
      'heading', 'Made to mean something.',
      'body', 'A homepage introduction test.',
      'supporting_body', 'Supporting introduction test copy.'
    )),
    ('craft-film', 2, jsonb_build_object(
      'eyebrow', 'The craft, in motion',
      'heading', 'Every stitch has a purpose.',
      'body', 'A homepage film test description.',
      'video_path', 'https://videos.pexels.com/video-files/34272583/14520671_3840_2160_30fps.mp4',
      'poster_path', current_setting('cfp.homepage.poster_image_path'),
      'scenes', jsonb_build_array(
        jsonb_build_object(
          'src', 'https://videos.pexels.com/video-files/37523886/15898195_3840_2160_30fps.mp4',
          'caption', 'Hand embroidery · fine threadwork',
          'label', 'Hand embroidery',
          'title', 'The beauty of handwork.',
          'sourcePage', 'https://www.pexels.com/video/intricate-hand-embroidery-crafting-process-37523886/',
          'seconds', 2.0
        ),
        jsonb_build_object(
          'src', 'https://videos.pexels.com/video-files/34272583/14520671_3840_2160_30fps.mp4',
          'caption', 'Dark couture · rich fabric detail',
          'label', 'Dark couture detail',
          'title', 'Depth in every detail.',
          'sourcePage', 'https://www.pexels.com/video/intricate-embroidery-process-on-black-fabric-34272583/',
          'seconds', 2.0
        ),
        jsonb_build_object(
          'src', 'https://videos.pexels.com/video-files/7043509/7043509-uhd_3840_2160_24fps.mp4',
          'caption', 'Precision machine embroidery · pattern in motion',
          'label', 'Precision by design',
          'title', 'Precision by design.',
          'sourcePage', 'https://www.pexels.com/video/a-close-up-footage-of-embroidery-7043509/',
          'seconds', 2.0
        ),
        jsonb_build_object(
          'src', 'https://videos.pexels.com/video-files/11955972/11955972-hd_1920_1080_25fps.mp4',
          'caption', 'Ivory floral stitching · the final detail',
          'label', 'Ivory floral finish',
          'title', 'Made by the details.',
          'sourcePage', 'https://www.pexels.com/video/close-up-view-of-working-sewing-machine-11955972/',
          'seconds', 2.0
        )
      )
    )),
    ('collection', 3, jsonb_build_object(
      'eyebrow', 'An Indian design library',
      'heading', 'Find the detail that feels like you.',
      'body', 'A homepage collection test description.'
    )),
    ('process', 4, jsonb_build_object(
      'eyebrow', 'The bespoke journey',
      'heading', 'From first thought to final fitting.',
      'body', 'A homepage process test description.',
      'steps', jsonb_build_array('Discover', 'Define', 'Shape', 'Refine')
    )),
    ('atelier', 5, jsonb_build_object(
      'eyebrow', 'An individual point of view',
      'heading', 'Rooted in craft. Made personal.',
      'body', 'A homepage atelier test description.',
      'image_path', current_setting('cfp.homepage.atelier_image_path'),
      'image_alt', 'Homepage test atelier image',
      'tags', jsonb_build_array('Chikankari', 'Zardozi')
    )),
    ('cta', 6, jsonb_build_object(
      'eyebrow', 'Your idea, your fit',
      'heading', 'Let us create something uniquely yours.',
      'body', 'A homepage call-to-action test.',
      'button_label', 'Begin your enquiry'
    )),
    ('faq', 7, jsonb_build_object(
      'eyebrow', 'Before your fitting',
      'heading', 'Good questions. Clear answers.',
      'body', 'A homepage FAQ test introduction.',
      'items', jsonb_build_array(
        jsonb_build_object('question', 'Question one?', 'answer', 'Answer one.'),
        jsonb_build_object('question', 'Question two?', 'answer', 'Answer two.'),
        jsonb_build_object('question', 'Question three?', 'answer', 'Answer three.'),
        jsonb_build_object('question', 'Question four?', 'answer', 'Answer four.')
      )
    ))
  ) AS sections(section_key, sort_order, content)
), true) AS ignored \gset

-- This privileged setup creates only run-scoped products. All rows and audit
-- trigger effects are inside the transaction and are removed by the final ROLLBACK.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('cfp.homepage.editor_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub', current_setting('cfp.homepage.editor_id'),
                     'role', 'authenticated')::text, true);
DO $editor_denials$
BEGIN
  BEGIN
    PERFORM public.create_homepage_draft();
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot create homepage draft', false);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot create homepage draft', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot create homepage draft', false, SQLSTATE);
  END;
  PERFORM pg_temp.cfp_homepage_assert('editor: no direct release write grant',
    NOT has_table_privilege('authenticated', 'public.homepage_releases', 'INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('authenticated', 'public.homepage_section_revisions', 'INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('authenticated', 'public.homepage_release_products', 'INSERT,UPDATE,DELETE'));
  BEGIN
    INSERT INTO public.products (
      legacy_code, slug, title, record_type, status, homepage_card_summary
    ) VALUES (
      current_setting('cfp.homepage.run_id') || '-editor-summary',
      current_setting('cfp.homepage.run_id') || '-editor-summary',
      'Editor homepage summary restriction fixture',
      'design_reference', 'draft', 'Editor cannot set this field'
    );
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot set card summary on draft insert', false);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot set card summary on draft insert', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot set card summary on draft insert', false, SQLSTATE);
  END;
END
$editor_denials$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('cfp.homepage.ordinary_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub', current_setting('cfp.homepage.ordinary_id'),
                     'role', 'authenticated')::text, true);
DO $ordinary_denials$
BEGIN
  BEGIN
    PERFORM public.create_homepage_draft();
    PERFORM pg_temp.cfp_homepage_assert('ordinary user: cannot create homepage draft', false);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.cfp_homepage_assert('ordinary user: cannot create homepage draft', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('ordinary user: cannot create homepage draft', false, SQLSTATE);
  END;
  PERFORM pg_temp.cfp_homepage_assert('ordinary user: no direct release write grant',
    NOT has_table_privilege('authenticated', 'public.homepage_releases', 'INSERT,UPDATE,DELETE'));
END
$ordinary_denials$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $anonymous_baseline$
BEGIN
  PERFORM pg_temp.cfp_homepage_assert('anon: cannot execute draft creation',
    NOT has_function_privilege('anon', 'public.create_homepage_draft()','EXECUTE'));
  PERFORM pg_temp.cfp_homepage_assert('anon: cannot execute draft save',
    NOT has_function_privilege('anon', 'public.save_homepage_draft(uuid,integer,jsonb,uuid[])','EXECUTE'));
  PERFORM pg_temp.cfp_homepage_assert('anon: cannot execute publishing',
    NOT has_function_privilege('anon', 'public.publish_homepage_release(uuid,integer)','EXECUTE'));
  PERFORM pg_temp.cfp_homepage_assert('anon: cannot read release actor identifiers',
    NOT has_column_privilege('anon', 'public.homepage_releases', 'published_by', 'SELECT')
    AND NOT has_column_privilege('authenticated', 'public.homepage_releases', 'published_by', 'SELECT'));
END
$anonymous_baseline$;
RESET ROLE;

-- Owner/Admin RPC calls below are role simulations, not Auth-issued sessions.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('cfp.homepage.admin_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub', current_setting('cfp.homepage.admin_id'),
                     'role', 'authenticated')::text, true);
SELECT public.create_homepage_draft() AS cfp_admin_draft_id \gset
SELECT set_config('cfp.homepage.admin_draft_id', :'cfp_admin_draft_id', true) AS ignored \gset
SELECT public.create_homepage_draft() AS cfp_admin_second_draft_id \gset
SELECT set_config('cfp.homepage.admin_second_draft_id',
  :'cfp_admin_second_draft_id', true) AS ignored \gset
DO $single_draft_reuse$
BEGIN
  PERFORM pg_temp.cfp_homepage_assert('admin: repeated draft creation returns the existing draft unchanged',
    current_setting('cfp.homepage.admin_draft_id') =
      current_setting('cfp.homepage.admin_second_draft_id')
    AND (SELECT lock_version = 1 FROM public.homepage_releases
         WHERE id = current_setting('cfp.homepage.admin_draft_id')::uuid)
    AND (SELECT count(id) = 1 FROM public.homepage_releases WHERE status = 'draft'));
END
$single_draft_reuse$;

-- This privileged invariant probe checks the partial unique index directly;
-- it is not an Owner/Admin role-permission assertion.
RESET ROLE;
DO $single_draft_index$
BEGIN
  BEGIN
    INSERT INTO public.homepage_releases (status, created_by, updated_by)
    VALUES ('draft', current_setting('cfp.homepage.owner_id')::uuid,
            current_setting('cfp.homepage.owner_id')::uuid);
    PERFORM pg_temp.cfp_homepage_assert('database invariant: second draft row rejected', false);
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.cfp_homepage_assert('database invariant: second draft row rejected', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('database invariant: second draft row rejected', false, SQLSTATE);
  END;

END
$single_draft_index$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('cfp.homepage.editor_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub', current_setting('cfp.homepage.editor_id'),
                     'role', 'authenticated')::text, true);
DO $editor_draft_denials$
DECLARE
  v_rows integer;
BEGIN
  PERFORM pg_temp.cfp_homepage_assert('editor: cannot read Admin draft',
    NOT EXISTS (
      SELECT 1 FROM public.homepage_releases
      WHERE id = current_setting('cfp.homepage.admin_draft_id')::uuid
    ));
  BEGIN
    PERFORM public.save_homepage_draft(
      current_setting('cfp.homepage.admin_draft_id')::uuid, 1,
      current_setting('cfp.homepage.sections')::jsonb,
      current_setting('cfp.homepage.product_ids')::uuid[]
    );
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot update homepage draft', false);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot update homepage draft', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot update homepage draft', false, SQLSTATE);
  END;
  BEGIN
    UPDATE public.products
    SET homepage_card_summary = 'Editor must not write homepage summary'
    WHERE id = (current_setting('cfp.homepage.product_ids')::uuid[])[1];
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot update homepage card summary', false,
      'rows updated: ' || v_rows);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot update homepage card summary', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot update homepage card summary', false, SQLSTATE);
  END;
  BEGIN
    PERFORM public.publish_homepage_release(
      current_setting('cfp.homepage.admin_draft_id')::uuid, 1
    );
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot publish homepage draft', false);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot publish homepage draft', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('editor: cannot publish homepage draft', false, SQLSTATE);
  END;
END
$editor_draft_denials$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('cfp.homepage.ordinary_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub', current_setting('cfp.homepage.ordinary_id'),
                     'role', 'authenticated')::text, true);
DO $ordinary_draft_visibility$
BEGIN
  PERFORM pg_temp.cfp_homepage_assert('ordinary user: cannot read Admin draft',
    NOT EXISTS (
      SELECT 1 FROM public.homepage_releases
      WHERE id = current_setting('cfp.homepage.admin_draft_id')::uuid
    ));
  BEGIN
    PERFORM public.save_homepage_draft(
      current_setting('cfp.homepage.admin_draft_id')::uuid, 1,
      current_setting('cfp.homepage.sections')::jsonb,
      current_setting('cfp.homepage.product_ids')::uuid[]
    );
    PERFORM pg_temp.cfp_homepage_assert('ordinary user: cannot update homepage draft', false);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.cfp_homepage_assert('ordinary user: cannot update homepage draft', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('ordinary user: cannot update homepage draft', false, SQLSTATE);
  END;
  BEGIN
    PERFORM public.publish_homepage_release(
      current_setting('cfp.homepage.admin_draft_id')::uuid, 1
    );
    PERFORM pg_temp.cfp_homepage_assert('ordinary user: cannot publish homepage draft', false);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.cfp_homepage_assert('ordinary user: cannot publish homepage draft', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('ordinary user: cannot publish homepage draft', false, SQLSTATE);
  END;
END
$ordinary_draft_visibility$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $anonymous_draft_visibility$
BEGIN
  PERFORM pg_temp.cfp_homepage_assert('anon: cannot read Admin draft',
    NOT EXISTS (
      SELECT 1 FROM public.homepage_releases
      WHERE id = current_setting('cfp.homepage.admin_draft_id')::uuid
    ));
END
$anonymous_draft_visibility$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('cfp.homepage.admin_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub', current_setting('cfp.homepage.admin_id'),
                     'role', 'authenticated')::text, true);
UPDATE public.products
SET homepage_card_summary = 'Admin-managed test card summary'
WHERE id = (current_setting('cfp.homepage.product_ids')::uuid[])[1];
SELECT set_config('cfp.homepage.summary_product_id',
  (current_setting('cfp.homepage.product_ids')::uuid[])[1]::text, true) AS ignored \gset
SELECT public.save_homepage_draft(
  :'cfp_admin_draft_id',
  1,
  current_setting('cfp.homepage.sections')::jsonb,
  current_setting('cfp.homepage.product_ids')::uuid[]
) AS cfp_admin_saved_version \gset
SELECT set_config('cfp.homepage.admin_saved_version', :'cfp_admin_saved_version', true) AS ignored \gset
DO $admin_save_assertion$
BEGIN
  PERFORM pg_temp.cfp_homepage_assert('admin: can create and save homepage draft',
    current_setting('cfp.homepage.admin_saved_version')::integer = 2);
END
$admin_save_assertion$;

DO $optimistic_lock_assertions$
BEGIN
  BEGIN
    PERFORM public.save_homepage_draft(
      current_setting('cfp.homepage.admin_draft_id')::uuid,
      NULL,
      current_setting('cfp.homepage.sections')::jsonb,
      current_setting('cfp.homepage.product_ids')::uuid[]
    );
    PERFORM pg_temp.cfp_homepage_assert('null version: save rejected', false);
  EXCEPTION WHEN serialization_failure THEN
    PERFORM pg_temp.cfp_homepage_assert('null version: save rejected', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('null version: save rejected', false, SQLSTATE);
  END;

  BEGIN
    PERFORM public.save_homepage_draft(
      current_setting('cfp.homepage.admin_draft_id')::uuid,
      1,
      current_setting('cfp.homepage.sections')::jsonb,
      current_setting('cfp.homepage.product_ids')::uuid[]
    );
    PERFORM pg_temp.cfp_homepage_assert('stale version: save rejected', false);
  EXCEPTION WHEN serialization_failure THEN
    PERFORM pg_temp.cfp_homepage_assert('stale version: save rejected', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('stale version: save rejected', false, SQLSTATE);
  END;

  BEGIN
    PERFORM public.publish_homepage_release(
      current_setting('cfp.homepage.admin_draft_id')::uuid,
      NULL
    );
    PERFORM pg_temp.cfp_homepage_assert('null version: publish rejected', false);
  EXCEPTION WHEN serialization_failure THEN
    PERFORM pg_temp.cfp_homepage_assert('null version: publish rejected', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('null version: publish rejected', false, SQLSTATE);
  END;

  BEGIN
    PERFORM public.save_homepage_draft(
      current_setting('cfp.homepage.admin_draft_id')::uuid,
      2,
      jsonb_set(current_setting('cfp.homepage.sections')::jsonb,
                '{1,sort_order}', '0'::jsonb),
      current_setting('cfp.homepage.product_ids')::uuid[]
    );
    PERFORM pg_temp.cfp_homepage_assert('duplicate section order: rejected', false);
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.cfp_homepage_assert('duplicate section order: rejected', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('duplicate section order: rejected', false, SQLSTATE);
  END;

  BEGIN
    PERFORM public.save_homepage_draft(
      current_setting('cfp.homepage.admin_draft_id')::uuid,
      2,
      current_setting('cfp.homepage.sections')::jsonb,
      ARRAY[
        '00000000-0000-0000-0000-000000000000'::uuid
      ] || (current_setting('cfp.homepage.product_ids')::uuid[])[2:8]
    );
    PERFORM pg_temp.cfp_homepage_assert('invalid product reference: rejected', false);
  EXCEPTION WHEN foreign_key_violation THEN
    PERFORM pg_temp.cfp_homepage_assert('invalid product reference: rejected', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('invalid product reference: rejected', false, SQLSTATE);
  END;

  BEGIN
    PERFORM public.save_homepage_draft(
      current_setting('cfp.homepage.admin_draft_id')::uuid,
      2,
      current_setting('cfp.homepage.sections')::jsonb,
      ARRAY[
        (current_setting('cfp.homepage.product_ids')::uuid[])[1]
      ] || (current_setting('cfp.homepage.product_ids')::uuid[])[1:7]
    );
    PERFORM pg_temp.cfp_homepage_assert('duplicate product selection: rejected', false);
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.cfp_homepage_assert('duplicate product selection: rejected', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('duplicate product selection: rejected', false, SQLSTATE);
  END;

  BEGIN
    PERFORM public.save_homepage_draft(
      current_setting('cfp.homepage.admin_draft_id')::uuid,
      2,
      jsonb_set(current_setting('cfp.homepage.sections')::jsonb,
                '{0,content,image_path}', to_jsonb('../unapproved.webp'::text)),
      current_setting('cfp.homepage.product_ids')::uuid[]
    );
    PERFORM pg_temp.cfp_homepage_assert('unsafe image path: rejected on save', false);
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.cfp_homepage_assert('unsafe image path: rejected on save', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('unsafe image path: rejected on save', false, SQLSTATE);
  END;

  BEGIN
    PERFORM public.save_homepage_draft(
      current_setting('cfp.homepage.admin_draft_id')::uuid,
      2,
      jsonb_set(current_setting('cfp.homepage.sections')::jsonb,
                '{0,content,primary_cta_href}', to_jsonb('javascript:alert(1)'::text)),
      current_setting('cfp.homepage.product_ids')::uuid[]
    );
    PERFORM pg_temp.cfp_homepage_assert('unsafe CTA scheme: rejected on save', false);
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.cfp_homepage_assert('unsafe CTA scheme: rejected on save', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('unsafe CTA scheme: rejected on save', false, SQLSTATE);
  END;

  BEGIN
    PERFORM public.save_homepage_draft(
      current_setting('cfp.homepage.admin_draft_id')::uuid,
      2,
      jsonb_set(current_setting('cfp.homepage.sections')::jsonb,
                '{2,content,video_path}',
                to_jsonb('http://attacker.example/video.mp4'::text)),
      current_setting('cfp.homepage.product_ids')::uuid[]
    );
    PERFORM pg_temp.cfp_homepage_assert('unsafe video URL: rejected on save', false);
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.cfp_homepage_assert('unsafe video URL: rejected on save', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('unsafe video URL: rejected on save', false, SQLSTATE);
  END;

  BEGIN
    PERFORM public.save_homepage_draft(
      current_setting('cfp.homepage.admin_draft_id')::uuid,
      2,
      jsonb_set(current_setting('cfp.homepage.sections')::jsonb,
                '{2,content,scenes,0,src}',
                to_jsonb('https://attacker.example/video.mp4'::text)),
      current_setting('cfp.homepage.product_ids')::uuid[]
    );
    PERFORM pg_temp.cfp_homepage_assert('unsafe video scene URL: rejected on save', false);
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.cfp_homepage_assert('unsafe video scene URL: rejected on save', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('unsafe video scene URL: rejected on save', false, SQLSTATE);
  END;

  PERFORM pg_temp.cfp_homepage_assert('failed saves: optimistic version unchanged',
    (SELECT lock_version = 2 FROM public.homepage_releases
     WHERE id = current_setting('cfp.homepage.admin_draft_id')::uuid));
END
$optimistic_lock_assertions$;

SELECT public.save_homepage_draft(
  :'cfp_admin_draft_id',
  2,
  jsonb_set(current_setting('cfp.homepage.sections')::jsonb,
            '{0,content,image_path}',
            to_jsonb((current_setting('cfp.homepage.run_id') || '/not-approved.webp')::text)),
  current_setting('cfp.homepage.product_ids')::uuid[]
) AS cfp_unapproved_media_version \gset
SELECT set_config('cfp.homepage.unapproved_media_version',
  :'cfp_unapproved_media_version', true) AS ignored \gset
DO $unapproved_media_publish$
BEGIN
  BEGIN
    PERFORM public.publish_homepage_release(
      current_setting('cfp.homepage.admin_draft_id')::uuid,
      current_setting('cfp.homepage.unapproved_media_version')::integer
    );
    PERFORM pg_temp.cfp_homepage_assert('unapproved public image: cannot publish', false);
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.cfp_homepage_assert('unapproved public image: cannot publish', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('unapproved public image: cannot publish', false, SQLSTATE);
  END;
  PERFORM pg_temp.cfp_homepage_assert('failed media publish: previous publication remains current',
    (SELECT status = 'draft' FROM public.homepage_releases
     WHERE id = current_setting('cfp.homepage.admin_draft_id')::uuid)
    AND (
      (current_setting('cfp.homepage.initial_published_id') = 'none'
       AND NOT EXISTS (SELECT 1 FROM public.homepage_releases WHERE status = 'published'))
      OR
      (current_setting('cfp.homepage.initial_published_id') <> 'none'
       AND EXISTS (
         SELECT 1 FROM public.homepage_releases
         WHERE id = current_setting('cfp.homepage.initial_published_id')::uuid
           AND status = 'published'
       ))
    ));
END
$unapproved_media_publish$;

SELECT public.save_homepage_draft(
  :'cfp_admin_draft_id',
  current_setting('cfp.homepage.unapproved_media_version')::integer,
  jsonb_set(current_setting('cfp.homepage.sections')::jsonb,
            '{0,is_visible}', 'false'::jsonb),
  current_setting('cfp.homepage.product_ids')::uuid[]
) AS cfp_hidden_hero_version \gset
SELECT set_config('cfp.homepage.hidden_hero_version',
  :'cfp_hidden_hero_version', true) AS ignored \gset
DO $hidden_hero_publish$
BEGIN
  BEGIN
    PERFORM public.publish_homepage_release(
      current_setting('cfp.homepage.admin_draft_id')::uuid,
      current_setting('cfp.homepage.hidden_hero_version')::integer
    );
    PERFORM pg_temp.cfp_homepage_assert('hidden hero: cannot publish', false);
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.cfp_homepage_assert('hidden hero: cannot publish', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('hidden hero: cannot publish', false, SQLSTATE);
  END;
  PERFORM pg_temp.cfp_homepage_assert('failed visibility publish: previous publication remains current',
    (SELECT status = 'draft' FROM public.homepage_releases
     WHERE id = current_setting('cfp.homepage.admin_draft_id')::uuid)
    AND (
      (current_setting('cfp.homepage.initial_published_id') = 'none'
       AND NOT EXISTS (SELECT 1 FROM public.homepage_releases WHERE status = 'published'))
      OR
      (current_setting('cfp.homepage.initial_published_id') <> 'none'
       AND EXISTS (
         SELECT 1 FROM public.homepage_releases
         WHERE id = current_setting('cfp.homepage.initial_published_id')::uuid
           AND status = 'published'
       ))
    ));
END
$hidden_hero_publish$;

SELECT public.save_homepage_draft(
  :'cfp_admin_draft_id',
  current_setting('cfp.homepage.hidden_hero_version')::integer,
  current_setting('cfp.homepage.sections')::jsonb,
  (current_setting('cfp.homepage.product_ids')::uuid[])[1:7]
    || current_setting('cfp.homepage.ineligible_id')::uuid
) AS cfp_invalid_selection_version \gset
SELECT set_config('cfp.homepage.invalid_selection_version',
  :'cfp_invalid_selection_version', true) AS ignored \gset
DO $invalid_product_publish$
BEGIN
  BEGIN
    PERFORM public.publish_homepage_release(
      current_setting('cfp.homepage.admin_draft_id')::uuid,
      current_setting('cfp.homepage.invalid_selection_version')::integer
    );
    PERFORM pg_temp.cfp_homepage_assert('ineligible product: cannot publish', false);
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.cfp_homepage_assert('ineligible product: cannot publish', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('ineligible product: cannot publish', false, SQLSTATE);
  END;
  PERFORM pg_temp.cfp_homepage_assert('failed publish: draft and current publication unchanged',
    (SELECT status = 'draft' FROM public.homepage_releases
      WHERE id = current_setting('cfp.homepage.admin_draft_id')::uuid)
    AND (SELECT count(id) = current_setting('cfp.homepage.initial_published_count')::integer
         FROM public.homepage_releases WHERE status = 'published')
    AND (
      (current_setting('cfp.homepage.initial_published_id') = 'none'
       AND NOT EXISTS (SELECT 1 FROM public.homepage_releases WHERE status = 'published'))
      OR
      (current_setting('cfp.homepage.initial_published_id') <> 'none'
       AND EXISTS (
         SELECT 1 FROM public.homepage_releases
         WHERE id = current_setting('cfp.homepage.initial_published_id')::uuid
           AND status = 'published'
       ))
    ));
END
$invalid_product_publish$;

SELECT public.save_homepage_draft(
  :'cfp_admin_draft_id',
  current_setting('cfp.homepage.invalid_selection_version')::integer,
  current_setting('cfp.homepage.sections')::jsonb,
  current_setting('cfp.homepage.product_ids')::uuid[]
) AS cfp_admin_final_version \gset
SELECT set_config('cfp.homepage.admin_final_version', :'cfp_admin_final_version', true) AS ignored \gset
SELECT public.publish_homepage_release(
  :'cfp_admin_draft_id',
  :'cfp_admin_final_version'
) AS cfp_admin_published_version \gset
SELECT set_config('cfp.homepage.admin_published_version', :'cfp_admin_published_version', true) AS ignored \gset
SELECT set_config('cfp.homepage.admin_published_id', :'cfp_admin_draft_id', true) AS ignored \gset

DO $admin_publish_assertions$
BEGIN
  PERFORM pg_temp.cfp_homepage_assert('admin: can update homepage card summary',
    (SELECT homepage_card_summary = 'Admin-managed test card summary'
     FROM public.products
     WHERE id = current_setting('cfp.homepage.summary_product_id')::uuid));
  PERFORM pg_temp.cfp_homepage_assert('admin: can publish a valid eight-section release',
    (SELECT status = 'published'
       AND published_at IS NOT NULL
     FROM public.homepage_releases
     WHERE id = current_setting('cfp.homepage.admin_published_id')::uuid));
  PERFORM pg_temp.cfp_homepage_assert('admin: publication audit identifies actor and release',
    EXISTS (
      SELECT 1 FROM public.admin_audit_logs
      WHERE actor_user_id = current_setting('cfp.homepage.admin_id')::uuid
        AND action = 'UPDATE'
        AND entity_type = 'homepage_releases'
        AND entity_id = current_setting('cfp.homepage.admin_published_id')::uuid
        AND new_values ->> 'status' = 'published'
    ));
  PERFORM pg_temp.cfp_homepage_assert('admin: card summary change is audited',
    EXISTS (
      SELECT 1 FROM public.admin_audit_logs
      WHERE actor_user_id = current_setting('cfp.homepage.admin_id')::uuid
        AND entity_type = 'products'
        AND entity_id = current_setting('cfp.homepage.summary_product_id')::uuid
    ));
END
$admin_publish_assertions$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $anonymous_visibility$
BEGIN
  PERFORM pg_temp.cfp_homepage_assert('anon: sees only the current published release',
    (SELECT count(id) = 1 FROM public.homepage_releases));
  PERFORM pg_temp.cfp_homepage_assert('anon: cannot read archived or draft releases',
    NOT EXISTS (SELECT 1 FROM public.homepage_releases WHERE status <> 'published'));
  PERFORM pg_temp.cfp_homepage_assert('anon: sees only visible published sections',
    NOT EXISTS (
      SELECT 1
      FROM public.homepage_section_revisions s
      JOIN public.homepage_releases r ON r.id = s.release_id
      WHERE r.status <> 'published' OR not s.is_visible
    ));
  PERFORM pg_temp.cfp_homepage_assert('anon: cannot read test draft',
    NOT EXISTS (
      SELECT 1 FROM public.homepage_releases
      WHERE id = current_setting('cfp.homepage.admin_published_id')::uuid
        AND status <> 'published'
    ));
END
$anonymous_visibility$;
RESET ROLE;

-- A deliberately incomplete draft tests validation and rollback without editing
-- a published release. The failed publish call is a subtransaction and is rolled back.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('cfp.homepage.admin_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub', current_setting('cfp.homepage.admin_id'),
                     'role', 'authenticated')::text, true);
SELECT public.create_homepage_draft() AS cfp_incomplete_draft_id \gset
SELECT set_config('cfp.homepage.incomplete_draft_id', :'cfp_incomplete_draft_id', true) AS ignored \gset
SELECT public.save_homepage_draft(
  :'cfp_incomplete_draft_id',
  1,
  jsonb_set(
    current_setting('cfp.homepage.sections')::jsonb,
    '{0,content,body}',
    '""'::jsonb
  ) #- '{0,content,image_path}',
  current_setting('cfp.homepage.product_ids')::uuid[]
) AS cfp_incomplete_saved_version \gset
SELECT set_config('cfp.homepage.incomplete_saved_version',
  :'cfp_incomplete_saved_version', true) AS ignored \gset
DO $incomplete_content_saved$
BEGIN
  PERFORM pg_temp.cfp_homepage_assert('incomplete required text: draft save succeeds',
    current_setting('cfp.homepage.incomplete_saved_version') = '2'
    AND EXISTS (
      SELECT 1
      FROM public.homepage_section_revisions
      WHERE release_id = current_setting('cfp.homepage.incomplete_draft_id')::uuid
        AND section_key = 'hero'
        AND content ->> 'body' = ''
        AND NOT (content ? 'image_path')
    ));
END
$incomplete_content_saved$;
DO $incomplete_content_atomicity$
DECLARE previous_id uuid := current_setting('cfp.homepage.admin_published_id')::uuid;
BEGIN
  BEGIN
    PERFORM public.publish_homepage_release(
      current_setting('cfp.homepage.incomplete_draft_id')::uuid,
      current_setting('cfp.homepage.incomplete_saved_version')::integer
    );
    PERFORM pg_temp.cfp_homepage_assert('incomplete required text: publish rejected', false);
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.cfp_homepage_assert('incomplete required text: publish rejected', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('incomplete required text: publish rejected', false, SQLSTATE);
  END;
  PERFORM pg_temp.cfp_homepage_assert('incomplete publish failure: prior published release remains current',
    (SELECT status = 'published' FROM public.homepage_releases WHERE id = previous_id));
END
$incomplete_content_atomicity$;

SELECT public.save_homepage_draft(
  :'cfp_incomplete_draft_id',
  :'cfp_incomplete_saved_version',
  (current_setting('cfp.homepage.sections')::jsonb - 7),
  current_setting('cfp.homepage.product_ids')::uuid[]
) AS cfp_missing_section_saved_version \gset
SELECT set_config('cfp.homepage.missing_section_saved_version',
  :'cfp_missing_section_saved_version', true) AS ignored \gset
DO $missing_section_atomicity$
DECLARE previous_id uuid := current_setting('cfp.homepage.admin_published_id')::uuid;
BEGIN
  BEGIN
    PERFORM public.publish_homepage_release(
      current_setting('cfp.homepage.incomplete_draft_id')::uuid,
      current_setting('cfp.homepage.missing_section_saved_version')::integer
    );
    PERFORM pg_temp.cfp_homepage_assert('missing section: publish rejected', false);
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.cfp_homepage_assert('missing section: publish rejected', true);
  WHEN OTHERS THEN
    PERFORM pg_temp.cfp_homepage_assert('missing section: publish rejected', false, SQLSTATE);
  END;
  PERFORM pg_temp.cfp_homepage_assert('missing-section publish failure: prior release remains current',
    (SELECT status = 'published' FROM public.homepage_releases WHERE id = previous_id));
END
$missing_section_atomicity$;

-- Owner exercises publication and audits the replaced release.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('cfp.homepage.owner_id'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub', current_setting('cfp.homepage.owner_id'),
                     'role', 'authenticated')::text, true);
SELECT public.create_homepage_draft() AS cfp_owner_draft_id \gset
SELECT set_config('cfp.homepage.owner_draft_id', :'cfp_owner_draft_id', true) AS ignored \gset
SELECT lock_version AS cfp_owner_initial_version
FROM public.homepage_releases
WHERE id = :'cfp_owner_draft_id' \gset
SELECT set_config('cfp.homepage.owner_initial_version',
  :'cfp_owner_initial_version', true) AS ignored \gset
DO $owner_draft_reuse$
BEGIN
  PERFORM pg_temp.cfp_homepage_assert('owner: reuses the active draft without resetting it',
    current_setting('cfp.homepage.owner_draft_id') =
      current_setting('cfp.homepage.incomplete_draft_id')
    AND current_setting('cfp.homepage.owner_initial_version') = '3');
END
$owner_draft_reuse$;
SELECT public.save_homepage_draft(
  :'cfp_owner_draft_id',
  :'cfp_owner_initial_version',
  current_setting('cfp.homepage.sections')::jsonb,
  current_setting('cfp.homepage.product_ids')::uuid[]
) AS cfp_owner_saved_version \gset
SELECT public.publish_homepage_release(
  :'cfp_owner_draft_id',
  :'cfp_owner_saved_version'
) AS cfp_owner_published_version \gset
SELECT set_config('cfp.homepage.owner_published_id', :'cfp_owner_draft_id', true) AS ignored \gset

DO $owner_publish_and_audit$
BEGIN
  PERFORM pg_temp.cfp_homepage_assert('owner: can create and publish a draft',
    (SELECT status = 'published'
       AND published_at IS NOT NULL
     FROM public.homepage_releases
     WHERE id = current_setting('cfp.homepage.owner_draft_id')::uuid));
  PERFORM pg_temp.cfp_homepage_assert('publish: previous release archived and audited',
    (SELECT status = 'archived' FROM public.homepage_releases
     WHERE id = current_setting('cfp.homepage.admin_published_id')::uuid)
    AND EXISTS (
      SELECT 1 FROM public.admin_audit_logs
      WHERE actor_user_id = current_setting('cfp.homepage.owner_id')::uuid
        AND action = 'UPDATE'
        AND entity_type = 'homepage_releases'
        AND entity_id = current_setting('cfp.homepage.admin_published_id')::uuid
        AND new_values ->> 'status' = 'archived'
    )
    AND EXISTS (
      SELECT 1 FROM public.admin_audit_logs
      WHERE actor_user_id = current_setting('cfp.homepage.owner_id')::uuid
        AND action = 'UPDATE'
        AND entity_type = 'homepage_releases'
        AND entity_id = current_setting('cfp.homepage.owner_draft_id')::uuid
        AND new_values ->> 'status' = 'published'
    ));
END
$owner_publish_and_audit$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $archived_public_visibility$
BEGIN
  PERFORM pg_temp.cfp_homepage_assert('anon: archived releases are not readable',
    NOT EXISTS (SELECT 1 FROM public.homepage_releases WHERE status = 'archived'));
  PERFORM pg_temp.cfp_homepage_assert('anon: reads the newly published current release',
    (SELECT count(id) = 1
       AND bool_and(id = current_setting('cfp.homepage.owner_published_id')::uuid)
     FROM public.homepage_releases));
END
$archived_public_visibility$;

RESET ROLE;
DO $catalogue_unchanged$
BEGIN
  PERFORM pg_temp.cfp_homepage_assert('catalogue: existing CF identifiers and summaries unchanged',
    NOT EXISTS (
      (SELECT legacy_code, id, homepage_card_summary
       FROM cfp_homepage_catalogue_snapshot
       EXCEPT
       SELECT p.legacy_code, p.id, p.homepage_card_summary
       FROM public.products p
       JOIN cfp_homepage_catalogue_snapshot s ON s.id = p.id)
      UNION ALL
      (SELECT p.legacy_code, p.id, p.homepage_card_summary
       FROM public.products p
       WHERE p.legacy_code IN ('CF-01', 'CF-02', 'CF-03', 'CF-04',
                               'CF-05', 'CF-06', 'CF-07', 'CF-08')
      EXCEPT
       SELECT legacy_code, id, homepage_card_summary
       FROM cfp_homepage_catalogue_snapshot)
    ));
  PERFORM pg_temp.cfp_homepage_assert('RLS: release, section, and selection tables enabled',
    (SELECT bool_and(relrowsecurity) FROM pg_class
     WHERE oid IN (
       'public.homepage_releases'::regclass,
       'public.homepage_section_revisions'::regclass,
       'public.homepage_release_products'::regclass
     )));
END
$catalogue_unchanged$;

TABLE pg_temp.cfp_homepage_results;
SELECT count(*) FILTER (WHERE passed) AS passed,
       count(*) FILTER (WHERE NOT passed) AS failed,
       count(*) AS total
FROM pg_temp.cfp_homepage_results;
DO $fail_on_test_failures$
DECLARE failures integer;
BEGIN
  SELECT count(*) INTO failures
  FROM pg_temp.cfp_homepage_results
  WHERE NOT passed;
  IF failures > 0 THEN
    RAISE EXCEPTION 'Homepage permission tests failed: % test(s) failed', failures;
  END IF;
END
$fail_on_test_failures$;
ROLLBACK;
