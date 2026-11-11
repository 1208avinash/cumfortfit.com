# Phase B.3 — Admin website-management test scope

This document records repository evidence and test scope, not results from staging. No database or Supabase tests were run for this revision.

## Current implementation evidence

| Area | Verified repository evidence | Current test status |
|---|---|---|
| Admin authentication and role gate | `admin/admin.js` signs in with password, resolves `admin_memberships`, rejects missing/inactive/unknown roles, and renders dashboard only after resolution. `admin/index.html` contains login, setup, and dashboard screens. | Storage suite signs in with role accounts; SQL simulates roles. Admin browser login/denial has no automated test. |
| Admin navigation and website management | Nav has Catalogue, Lookbook, Categories, Image approvals, Site content, and Audit history controls. Clicks only update the title and show “This section will be enabled in the next implementation increment.” | No management UI operations exist to test end-to-end. |
| Product create/edit/publish | SQL simulates Admin insert, edit, publish, and unpublish on transaction fixtures (`011_rls_permission_tests.sql`, Admin block). Migration 006 grants authenticated writes and staff-role RLS; migration 005 guards selected Editor fields. | Assertions implemented, not executed against staging; not an Admin UI test. |
| Design-reference restrictions | SQL includes integrity probes preventing pricing and availability for design references in the Owner block. | Implemented as role-simulated integrity assertions; not executed. Admin-specific coverage is not explicit. |
| Image metadata approval | SQL simulates Admin changing a fixture image from staging metadata to approved/public metadata. | Assertion implemented, not executed. This does not move or promote the underlying Storage object. |
| Storage role operations | `storage-permission.test.mjs` signs in through Auth and exercises role-specific Storage reads, uploads, updates, and deletes. | Test code exists; staging run was previously skipped without credentials. |
| Audit history | SQL checks that an Admin can read fixture audit entries. Migration 005 defines audit triggers for products, categories, images, pricing, and site content. | Read assertion implemented, not executed; it does not prove that each Admin mutation emits the expected actor/action/old/new values. |
| Homepage and site content | `site_content` exists; SQL fixtures include published and draft content. There is no Admin-specific insert/edit/publish/order test. | Not tested as Admin; UI is a placeholder. |
| Categories, attributes, pricing, availability | Tables and staff policies exist in the migrations. SQL currently probes Editor restrictions and design-reference integrity, not the Admin CRUD/update workflows. | Not tested as Admin; UI is a placeholder. |
| Lookbook entries and chapters | Tables, product/chapter mappings, and public visibility policies exist. No Admin-specific Lookbook CRUD, chapter, ordering, or publication test exists. | Not tested as Admin; UI is a placeholder. |
| Image publishing visibility | SQL checks row-level image metadata visibility. A public Storage bucket is public-read independently of product RLS (migration 007). | Product-linked unpublish/object access behavior is not tested. |
| Editor published-content behavior | Migration 005’s Editor trigger prevents changes to site-content status/order, but does not prevent body changes. Existing SQL probes that body edit as allowed. | Separate existing behavior; unchanged by this scope revision. Owner should confirm whether it is intended. |

## Membership-specific SQL tests deferred

The immediate test run no longer includes:

- Owner membership insert, update, promotion, and deactivation lifecycle assertions.
- Admin self-promotion-to-Owner and Owner-membership modification denial assertions.
- Editor membership-update denial assertion.
- Membership write-grant assertions and membership audit-trigger coverage.

These were removed from the current `011_rls_permission_tests.sql` execution path because staff-management is not the immediate product objective. They are deferred—not a finding that those permissions are safe or correct—and should be restored in a separate membership-management phase if that feature is approved.

Authentication-related checks remain: role identities are loaded from active memberships; SQL checks Admin/Owner active self-role rows; anonymous and ordinary users remain restricted from protected membership data; private role-resolver grants and membership-table RLS enablement remain covered. This preserves the role checks needed to protect the Admin panel without testing membership-management workflows.

## Immediate Admin test coverage and gaps

### Assertions currently in test code (not staging-verified)

- Admin role-simulated product create/edit/publish/unpublish.
- Admin role-simulated image metadata approval/promotion.
- Admin read of fixture audit history.
- Active Admin membership visibility.
- Anonymous and ordinary-user restrictions on catalogue writes, drafts, private staff/audit content, and protected membership data.
- Auth-session Storage tests for Owner/Admin/Editor/ordinary users and anonymous access, when explicitly run with staging test accounts.

### Add to a future Admin website-management test increment

1. Auth-issued Admin session can create/edit/publish/unpublish/archive a product and a design reference; confirm reference pricing/availability are rejected.
2. Admin can edit categories, attribute definitions/options/values, prices, and availability; ordinary and anonymous sessions cannot write.
3. Admin can edit Lookbook entry metadata, images, chapters, display order, and visibility/publication state.
4. Admin can edit homepage/site content headings, copy, banners/images, section order, and visibility.
5. Storage tests verify Admin staging upload, approval/promotion of the corresponding existing object, correct public read behavior, and inaccessible staging objects; verify unpublishing behavior and the public-bucket limitation.
6. For every mutation where a trigger exists, assert the corresponding audit row actor, action, entity, and changed values. Explicitly record tables without audit triggers rather than assuming coverage.
7. Browser tests verify signed-out and ordinary users cannot enter the Admin dashboard or perform actions; verify server/database RLS independently.

## Known source-level security/data-integrity gaps (not live findings)

- Generic staff write policies in migration 006 include Admin and Editor for catalogue tables. Migration 005 limits selected Editor operations via triggers; the current tests do not establish all Admin/Editor mutation boundaries.
- Migration 005 has a malformed dollar-quote ending in checked-in source; the local delimiter sanity test has failed on it. No migration was changed or applied in this phase.
- Migration 007 configures `catalogue-public` as public-read, so object access does not follow product visibility. `product_images` RLS cannot revoke access to an already public object URL.
- Existing audit triggers cover only the listed tables in migration 005. Availability, Lookbook chapters, and attribute tables are not among those trigger definitions. Trigger-presence checks do not prove emitted audit payload correctness.
- Admin UI role checks are not a substitute for database RLS; both layers require independent tests.

All status terms are evidence-based: **implemented** means test code exists; **executed** means the test ran; **passed/failed** apply only to an executed test; **skipped** is not passed; **not tested** means there is no execution evidence. SQL role simulation is not an Auth-issued JWT/PostgREST session. No staging result is claimed.
