# Homepage editor migration and test specification

## Status and boundaries

This is a review artifact for migration `008_homepage_releases.sql` and the
transactional role-simulation test `012_homepage_editor_permission_tests.sql`.
Neither SQL file has been executed. No database or Supabase project was
contacted. The local migration-source test checks lexical delimiters and
repository contracts only; it is not PostgreSQL syntax validation.

## Migration dependencies

Migration 008 is additive and is numbered after the checked-in migrations
001–007. It depends on:

- Migration 001: the `private` schema and Supabase `anon`/`authenticated`
  database roles.
- Migration 002: `public.products`, its stable `legacy_code`, `status`,
  `homepage_visible`, and `product_id` references.
- Migration 004: `auth.users` and `public.admin_audit_logs`.
- Migration 006: public-schema access and the baseline grants/RLS environment.
- Supabase Auth's `auth.uid()` implementation and the `auth` schema.

Migration 008 does **not** call `private.current_admin_role()`,
`private.set_updated_at()`, or `private.audit_row_change()` from migration 005.
It defines isolated role, timestamp, content-validation, and audit functions.
The product card-summary guard checks active membership directly.

### Migration 005 issue

The checked-in `005_integrity_and_timestamp_triggers.sql` has malformed
dollar-quote endings in several function bodies: `audit_row_change` ends with
`end $;` at line 103, and later functions such as `guard_editor_product_insert`,
`guard_editor_content_insert`, `guard_editor_image_write`, and
`prevent_product_type_downgrade` also use `AS $` / `END $;`. The local
delimiter test reports the unmatched delimiter at source offset 10251 (line
188), after losing synchronization on the earlier malformed function body. Do
not repair, execute, or infer the deployed state from the checked-in file.

Migration 008 avoids depending on migration 005's functions. If the deployed
database has the existing `audit_products` trigger, homepage-card-summary
updates use its general product audit coverage. If that trigger is absent, 008
adds a narrow audit fallback for updates to `homepage_card_summary`. The
existing audit-read policy in migration 006 does call
`private.current_admin_role()`, so displaying the audit screen still depends
on that function being present and correctly installed in the target database.
Actual deployed migration history and function definitions need a separately
approved, read-only staging inspection before migration execution.

## Database and permission design

- `homepage_releases` stores draft, published, and archived versions. Partial
  unique indexes enforce at most one active draft and one published release.
  `create_homepage_draft()` takes a transaction-scoped advisory lock, returns
  an existing draft unchanged, or inserts one. The unique index plus
  `ON CONFLICT ... DO NOTHING` is the final guard if another writer does not
  use the RPC lock; the function returns the winner's ID when visible and
  raises a retryable serialization error if the transaction snapshot cannot
  see it. No existing draft is reset. `lock_version` provides compare-and-swap
  semantics for saves and publishing.
- `published_by` uses a restrictive Auth-user foreign key so deleting an
  account cannot invalidate the release's required publisher attribution;
  account deletion therefore needs an explicit retention/transfer process.
- `homepage_section_revisions` stores a release's typed sections, structured
  JSON content, visibility, and unique display order. Publication requires all
  eight stable keys: `hero`, `introduction`, `craft-film`, `collection`,
  `process`, `atelier`, `cta`, and `faq`.
- `homepage_release_products` references existing catalogue products rather
  than copying product data. Publication requires exactly eight distinct,
  published, homepage-visible products with unique order.
- `products.homepage_card_summary` stores the card subtitle distinct from the
  product description and image caption. The new guard prevents Editors from
  setting or changing this newly added field under the existing broad product
  insert/update grants. No other Editor permission is changed.
- Anonymous and authenticated reads can see only the current published
  release, visible sections, and eligible selected products. Archived and
  draft data is restricted to authenticated Owner/Admin sessions.
- Release metadata grants are column-scoped; publisher/editor user IDs are not
  exposed by direct public or authenticated release-table reads.
- Authenticated table-level insert/update/delete grants are revoked on the
  homepage tables. Owner/Admin operations go through `create_homepage_draft`,
  `save_homepage_draft`, and `publish_homepage_release`; each checks
  `auth.uid()` and active Owner/Admin membership. Editor and ordinary-user
  sessions have no mutation path.
- Publishing validates the entire release before archiving the previous
  publication. Both status changes and their audit-trigger writes occur in
  the same database transaction. Any raised error rolls the call back.
- Homepage release, section, and selection mutations are recorded in
  `admin_audit_logs` with actor, operation, row snapshots, and release entity
  linkage.

JSON content is constrained to section-specific required text and field types,
valid section ordering, and expected process/FAQ/scene collection lengths. The
hero must remain visible; other required sections can be hidden. Image paths
must be relative, traversal-free image paths. Publishing additionally requires
hero, atelier, and film-poster paths to match approved `catalogue-public` rows
in `product_images` whose products are published. Product and image rows are
share-locked during publication so their eligibility/approval cannot be
withdrawn between validation and commit. Film scene entries retain the current
homepage shape (`src`, `caption`, `label`, `title`, `sourcePage`, and positive
`seconds`) and validate each media and source URL.

CTA hrefs are limited to same-site root-relative paths and simple fragments;
external CTA links and arbitrary schemes are not currently supported. Film
URLs are restricted to HTTPS `videos.pexels.com/video-files/...mp4`
references and attribution links to `www.pexels.com/video/.../`, matching the
current homepage's source host. This validates scheme/host/path shape, not
remote availability, licensing, or continued existence.

Current Storage configuration only allows image MIME types. The SQL checks
verify the approved public-image metadata mapping, not that an object is
retrievable from Storage. The Admin UI must select media through approved
product-image records, preview it, and perform an authenticated Storage/API
availability check before publication. Video upload/approval needs separate
Storage and database design if arbitrary video assets are required.

Browser rendering must use text-safe DOM APIs; the schema does not authorize
rendering stored strings as HTML. Client-side checks remain useful for
feedback but do not replace the database publication checks.

Security-definer functions pin `search_path` to `pg_catalog` and qualify
application/Auth objects. Their owner is the role that creates them (or the
pre-existing owner for `CREATE OR REPLACE`); this migration does not change
ownership. Before staging execution, inspect `pg_proc.proowner` and confirm
each definer is a trusted, controlled role with only the required object
access. Ownership cannot be verified from checked-in SQL alone.

## SQL permission test coverage

`012_homepage_editor_permission_tests.sql` is designed to:

- Create uniquely identified product fixtures inside one transaction.
- Create isolated `product_images` approval-metadata fixtures for media
  validation; these are not real Storage objects and do not verify object
  availability.
- Snapshot any existing `CF-01` through `CF-08` IDs and card summaries and
  verify the test did not alter them.
- Use `SET LOCAL ROLE` plus JWT claim settings to simulate Owner, Admin,
  Editor, ordinary authenticated, and anonymous database roles.
- Require zero pre-existing active drafts before creating fixtures. The test
  verifies first-draft creation, repeated creation returning the same
  unchanged release, the one-draft unique index, Owner/Admin publishing, and
  rollback of all test changes.
- Verify Owner/Admin draft creation and publishing; Editor and ordinary-user
  denials; anonymous/current-public-only visibility; and no direct table write
  grants.
- Verify invalid product references, ineligible product publication, missing
  sections, duplicate section/product ordering or selection, unsafe image
  paths, unsafe CTA/video URLs and scene references, hidden-hero publication,
  unapproved image metadata, and stale lock versions are rejected.
- Verify failed saves do not advance the version and failed publishing leaves
  the existing published release current.
- Verify publication archives the previous release, preserves audit events,
  and records the correct publishing actor without exposing actor IDs through
  the release table's public columns.
- Finish with `ROLLBACK`, removing fixtures, release rows, and trigger-created
  audit rows.

  The SQL test calls draft creation twice sequentially and checks the partial
  unique index; its local migration contract test checks the advisory-lock and
  conflict-handling clauses. Neither test runs two overlapping database
  sessions, so concurrent RPC behavior still needs a separately approved
  two-session staging/API test. The SQL test's privileged unique-index probe is
  explicitly a database-invariant test, not an Owner/Admin permission result.

  **Role simulation is not an Auth-issued JWT or PostgREST session.** It does not
test the Supabase API gateway, browser authentication, or the Admin UI. Also,
the fixture setup requires a sufficiently privileged PostgreSQL connection
that can insert test products and inspect `auth.users`; its setup work is not
an Owner/Admin permission result.

The Owner/Admin/Editor/ordinary-user identities are selected from existing
active memberships/users. If any role fixture is unavailable, the test stops
rather than reporting partial coverage as a pass. Existing `CF-01`–`CF-08`
records are snapshotted if present; the test does not require that the staging
catalogue already contains them.

## Browser/API test specifications for a later implementation

These are specifications only; no browser or API automation has been
implemented in this phase.

1. **Authentication and role boundary**
   - Unauthenticated visitor is redirected to login and cannot load a draft.
   - Ordinary authenticated user cannot access draft APIs or invoke any
     homepage mutation RPC.
   - Owner/Admin Auth-issued sessions can load and save a draft.
   - Editor Auth-issued session cannot create, update, preview, or publish a
     draft and cannot change `homepage_card_summary`.
   - Verify these outcomes through the Supabase API, not only hidden controls.
2. **Draft lifecycle**
   - With no active draft, concurrently call `create_homepage_draft()` from
     two independent authenticated Owner/Admin sessions; verify both receive
     the same ID and exactly one draft exists.
   - Create a draft from the current published snapshot; repeat creation and
     verify the existing draft content/version is unchanged.
   - Save edits and reload them; verify lock version increments.
   - Open two editors against the same version; after one saves, the stale
     client's save/publish must receive a conflict and preserve the winner's
     content.
   - Preview is authenticated and renders draft fields with the public page's
     CSS/structure; drafts remain unavailable through anonymous requests.
3. **Validation**
   - Reject missing or malformed required sections, invalid field values,
     duplicate section order, duplicate product selection, nonexistent
     product references, and products not published/homepage-visible.
   - Verify invalid publish attempts leave the prior publication and audit
     state intact.
   - Verify only approved public image records attached to published products
     can be published, and confirm the referenced Storage object is readable.
   - Verify CTA handling remains same-origin and the selected Pexels video URL
     is reachable; test video licensing/availability separately.
4. **Publishing**
   - Publish from Owner and Admin Auth sessions.
   - Concurrent publish calls serialize; exactly one release is current.
   - Verify the old release becomes archived and the new release records
     publisher and timestamp.
   - Verify audit entries contain the real Auth user ID, changed entity,
     operation, and old/new values.
5. **Public rendering and compatibility**
   - Anonymous API can query only the current release, visible sections, and
     selected eligible products.
   - Confirm all existing `CF-01`–`CF-08` IDs, card summaries, titles, and
     images still map as intended.
   - Preserve `customFitPrime.savedDesigns.v1` and its saved-item shape.
   - With Supabase unavailable or content fetch failing, the static HTML
     fallback retains existing design and interactions.
6. **Images**
   - Upload draft images only to private staging, preview them in an
     authenticated session, and require explicit approval before promotion.
   - Verify public storage behavior separately: an object promoted to the
     public bucket can remain accessible by URL after a section is unpublished.

## Rollback strategy

No rollback has been executed. Migration 008 uses a transaction, so a failed
migration application should roll back as a unit.

Before any content is entered, a separately reviewed rollback migration could
remove 008's policies, triggers, functions, tables, and the added product
column in dependency order. Do not use `DROP ... CASCADE`. Once releases or
audit entries contain real content, do not drop those records as a routine
rollback: export and retain the content/audit history, republish an approved
prior release if possible, and prepare a data-preserving rollback plan.
Publicly promoted storage objects are outside this database rollback and are
not made private by reversing release status.

## Local checks and separately approved staging command

Local-only contract and delimiter checks:

```powershell
node --test supabase\tests\homepage-editor-migration.test.mjs
node --test supabase\tests\migration-source.test.mjs
```

The second command is expected to report the known migration 005 delimiter
failure until that source/deployed-state discrepancy is separately resolved.
Neither command connects to Supabase.

After explicit approval only, configure the pinned staging connection
environment (`PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGPORT`, and
`PGSSLROOTCERT`) and run:

```powershell
.\supabase\tests\run-homepage-editor-tests.ps1
```

The runner requires the exact staging database host, database `postgres`, user
`postgres`, and a trusted TLS root certificate with `verify-full`. It verifies
the connected database/user before running only the transactional homepage
SQL suite, and never prints the password.

## Execution gate

Do not run either SQL file against staging or production until the owner
explicitly approves execution. Before that approval, reconcile checked-in
migration 005 with a separately authorized read-only inspection of staging;
confirm the deployed baseline, migration history, expected Owner/Admin test
fixtures, and the current `CF-01`–`CF-08` mapping. No staging result is claimed
by this document.
