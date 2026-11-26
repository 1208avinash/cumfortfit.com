# CUSTOM FIT PRIME staging permission tests

## Phase B.3 scope

The immediate test objective is to verify that an active Admin can manage website content through authorized database operations, while unauthenticated and ordinary users cannot access protected Admin data or write catalogue records. Membership invitation, promotion, deactivation, deletion, and other staff-management workflows are deferred. Authentication and active-membership checks remain in scope because they protect Admin access.

This is a test-scope revision only. It does not change application functionality, database policies, grants, triggers, or schema.

## Suite and execution boundaries

- `011_rls_permission_tests.sql` creates uniquely named fixtures in a single transaction and ends in `ROLLBACK`. Fixture creation and catalog inspection use the connection role for setup/metadata; those are not role-permission results. Role-specific assertions use `SET LOCAL ROLE` with JWT-claim settings.
- SQL role simulation is **not** an Auth-issued JWT or PostgREST session. It does not verify login, the Admin browser shell, or actual API gateway behavior. The Storage tests use real Supabase Auth password sessions when run with test-account credentials.
- SQL assertions currently cover Admin product create/edit/publish/unpublish, image metadata approval/promotion, and audit reads, along with public/ordinary-user access controls. They do not prove an Admin can edit the site through the UI.
- `storage-permission.test.mjs` exercises Storage HTTP operations with actual Auth-issued sessions when configured. It does not test Admin UI integration or product-linked public visibility.
- `migration-source.test.mjs` checks dollar-quote termination after skipping SQL comments and quoted values. It is not a full PostgreSQL parser or syntax validator.
- No staging or production connection is authorized by this scope revision.

## Prerequisites and safeguards for a separately approved staging run

- PostgreSQL `psql`; Node.js 18 or newer.
- Dedicated staging accounts only. Never use production accounts or credentials.
- The SQL runner requires `PGHOST=db.dkcjzisqufqgjtrgstch.supabase.co`, `PGDATABASE=postgres`, `PGUSER`, `PGPASSWORD`, and `PGSSLROOTCERT` for the trusted server CA. It rejects non-empty `PGHOSTADDR`/`PGSERVICE`, forces `sslmode=verify-full`, pins host/database/port, and checks server connection information before executing the test.
- SQL test identities require active Owner, Admin, and Editor memberships plus an ordinary Auth user without a membership. The Owner/Editor identity coverage is retained as general role-baseline/security coverage; membership lifecycle operations are not tested.
- Storage tests require the exact staging HTTPS URL, a publishable key, and dedicated Owner/Admin/Editor/ordinary-user accounts. Credentials and token bodies are not printed.

## Commands

These commands are documentation for a future, explicitly approved staging run; they were not run as part of Phase B.3.

```powershell
# Configure these securely; do not put passwords in command history.
$env:PGHOST = "db.dkcjzisqufqgjtrgstch.supabase.co"
$env:PGDATABASE = "postgres"
# Set PGPORT, PGUSER, PGPASSWORD, PGSSLROOTCERT.
.\supabase\tests\run-staging-rls-tests.ps1
```

Local-only migration source check:

```powershell
node --test supabase/tests/migration-source.test.mjs
```

Storage suite with staging-only test credentials:

```powershell
$env:CFP_STAGING_URL = "https://dkcjzisqufqgjtrgstch.supabase.co"
# Set CFP_STAGING_PUBLISHABLE_KEY and CFP_{OWNER,ADMIN,EDITOR,ORDINARY}_{EMAIL,PASSWORD} securely.
node --test supabase/tests/storage-permission.test.mjs
```

Without all required Storage variables, Node reports the suite as **skipped**. A skipped suite is not a pass and makes no network requests.

## Membership-specific SQL tests deferred

The following assertions were removed from the immediate SQL execution path and are deferred, not approved for implementation:

- Owner membership insert, update, role promotion, and deactivation lifecycle.
- Admin self-promotion-to-Owner and Owner-membership modification denial.
- Editor membership-update denial and table-level membership write-grant assertions.

Useful security coverage is retained: role identities are loaded from active memberships; Admin and Owner self-membership rows are checked for the expected active role; anonymous and ordinary-user visibility restrictions remain; RLS enablement and the private role-resolver grants remain checked. No membership tables, authentication behavior, or policies were changed.

## Admin website-management test coverage

| Capability | SQL/test code present | Actual Admin UI | Execution status |
|---|---|---|---|
| Authenticate an Admin and resolve an active Admin membership | Active Admin row check in SQL; Storage suite signs in with an Admin test account | Auth shell and active-role check implemented | SQL not run; Storage discovery was skipped without credentials; browser flow not tested |
| Deny unauthenticated/ordinary access to protected data | Anonymous and ordinary-user SQL assertions; ordinary Storage denials | Login/active-membership gate implemented | SQL not run; Storage test not run against staging |
| Create/edit/publish/unpublish products | Admin SQL role-simulation probes | Catalogue navigation is a placeholder | Implemented as test assertions; not executed |
| Manage design references and prevent pricing/availability on references | Integrity probes in SQL | No product editor | Implemented as test assertions; not executed |
| Approve/promote product-image metadata | Admin SQL metadata update | Image approvals navigation is a placeholder | Implemented as test assertion; not executed |
| Upload/read/update/delete Storage objects | Admin and role-specific tests in Storage suite | No upload UI | Test code exists; staging suite skipped |
| Read audit history | Admin SQL fixture audit read | Audit-history navigation is a placeholder | Implemented as test assertion; not executed |
| Homepage copy/headings/banners/sections, visibility/order | No complete Admin tests | Site content navigation is a placeholder; schema has `site_content` | Not tested / no management UI |
| Category and structured attribute CRUD | No Admin SQL probes | Categories navigation is a placeholder | Not tested / no management UI |
| Pricing and availability changes by Admin | No Admin role-specific change probes | No product editor | Not tested in Admin scope |
| Lookbook descriptions, chapters, images, visibility/order | No Admin SQL probes | Lookbook navigation is a placeholder | Not tested / no management UI |
| Admin browser authorization and real Auth-issued database-role matrix | No browser/PostgREST tests | Shell authentication exists; management actions do not | Not tested |

## Test status vocabulary and current evidence

- **Implemented:** test code exists.
- **Executed:** the test runner actually ran it.
- **Passed / Failed:** result from an executed test only.
- **Skipped:** discovered but intentionally not run; never count as passed.
- **Not tested:** no execution evidence exists.

| Area | Implemented | Executed | Result |
|---|---:|---:|---|
| SQL role/grant/RLS checks | Yes | No in Phase B.3 | Not tested against staging |
| Migration delimiter check | Yes | Previously, local only | Migrations 001–004 and 006–007 passed; migration 005 failed. This is not PostgreSQL syntax validation. |
| Auth-session Storage checks | Yes | Previously discovered without credentials | Skipped; no staging operations tested |
| Admin browser CRUD/access tests | No | No | Not tested |
| Production configuration/data | No | No | Not tested and out of scope |

Do not treat any database or Supabase behavior as verified until the relevant test has actually run against the approved staging environment.
