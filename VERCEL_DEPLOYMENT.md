# CUSTOM FIT PRIME — Vercel deployment

This project is a static HTML/CSS/JavaScript site. Vercel is configured with the
Other framework preset. Its build script creates an explicit `dist/` package
containing only runtime pages, modules, styles, assets, and the generated
`admin/config.js`.

## Project settings

In the Vercel project dashboard, configure:

- **Framework Preset:** Other
- **Root Directory:** `.` (the project root)
- **Build Command:** `node scripts/build-vercel-package.mjs`
- **Output Directory:** `dist`
- **Install Command:** leave unset; this project has no package manifest or
  dependency install step

The matching build and output settings are also in `vercel.json`. Do not add a
framework or a build dependency. The build copies only the known runtime files
and `assets/`; it does not copy Supabase migrations, scripts, tests,
documentation, local config, Git metadata, or environment files.

## Environment variables

Add these variable names in **Project Settings → Environment Variables**. Use
different values for the Preview and Production scopes:

| Environment | Variable | Value to enter |
|---|---|---|
| Preview | `CFP_SUPABASE_URL` | `https://dkcjzisqufqgjtrgstch.supabase.co` |
| Preview | `CFP_SUPABASE_PUBLISHABLE_KEY` | Publishable key for the approved staging Supabase project |
| Production | `CFP_SUPABASE_URL` | HTTPS URL of the separate production Supabase project |
| Production | `CFP_SUPABASE_PUBLISHABLE_KEY` | Publishable key belonging to that production project |

These are browser-side public settings. Never enter a Supabase service-role key,
database password, or other privileged secret. Protect data with the existing
database RLS and Storage policies. Assign the production key from the production
project; do not copy the staging key into the Production scope.

The generator checks required values, requires a valid HTTPS project origin,
rejects the approved staging URL in Production, and requires that URL in
Preview. It rejects recognized service-role keys. It serializes values using
`JSON.stringify`, writes the expected `window.CFP_SUPABASE_CONFIG` object to
`admin/config.js`, and logs no configuration values. The generated file is
git-ignored and must not be committed.

## Preview verification

1. Add the Preview variables above in Vercel. Confirm that the Preview key is
   the staging project's publishable key.
2. Push the approved feature branch only after the repository changes have been
   reviewed. This document does not authorize or perform a push.
3. Open the resulting Vercel Preview deployment and confirm the build succeeded.
   The build must fail if Preview points to another Supabase project.
4. Verify `/index.html`, `/lookbook.html`, `/public-catalogue.mjs`,
   `/admin/`, `/admin/config.js`, the required admin modules/styles, and
   referenced images load.
   Confirm `/admin/config.js` returns the generated configuration, without
   copying its response into logs, tickets, or source control.
5. Confirm Supabase migration, test, script, and local documentation files are
   absent from the deployment output.
6. Smoke-test public reads and the admin role flows against staging test
   accounts only. Confirm an API failure retains static page content and a
   successful empty response does not retain stale catalogue cards.

## Production release after approval

Production configuration remains a dashboard action and must use the separate
production Supabase URL and its own publishable key.

1. Confirm required database migrations, RLS policies, and Storage buckets have
   been reviewed and applied to the intended production project under separate
   approval. Do not apply migrations from this deployment guide.
2. Set the Production environment variables in the Vercel dashboard. Do not
   reuse the Preview values. The build rejects the known staging URL but cannot
   independently prove that a publishable key belongs to a given URL; verify
   that pairing in the dashboard.
3. Review the exact release diff and Vercel build settings, then obtain release
   approval.
4. Promote the approved build to Production using the Vercel dashboard. Do not
   use Preview credentials for the Production deployment.
5. Run the post-deployment checks above against the public domain and verify
   admin access with approved production test accounts.

No Vercel project has been linked or changed, and this repository has not been
deployed by these instructions.

## Rollback

Use the Vercel dashboard to instantly restore the previous known-good
Production deployment. Confirm the public homepage, Lookbook, admin sign-in,
and static fallback behavior. Do not roll back database objects as part of a
static deployment rollback; database recovery requires its own reviewed plan.
