# CUSTOM FIT PRIME — Admin foundation

This is a standalone static admin application. The existing public homepage and Lookbook load their catalogue content through `../public-catalogue.mjs`.

## Local setup

1. In Supabase, use the project URL and **publishable** key from Project Settings → API Keys.
2. Copy `config.example.js` to `config.js`.
3. Put the project URL and publishable key in `config.js`.
4. Serve the repository root with a local static server and open `/admin/`. Do not open the file directly with `file://`.
5. Sign in with an invited Supabase Auth user who has an active row in `public.admin_memberships`.

The public pages load the same `admin/config.js` file. Only a Supabase publishable key belongs there; never use a service-role key.

Example PowerShell from the repository root (Python installed):
```powershell
python -m http.server 8000
```
Then open `http://localhost:8000/admin/`.

## Security

- Browser code uses only the Supabase publishable key.
- Never put a service-role key, database password or other secret in `config.js`.
- Authenticated access is checked against `admin_memberships`; database RLS remains the actual security boundary.
- Public admin registration is not provided.
- No database migration, storage bucket, invitation, or owner bootstrap is performed by this application.

## Current scope

The sign-in foundation and role-aware shell are implemented. Catalogue management reads and updates the existing `products` and `categories` tables, with archive/restore represented by the existing product status. Categories can be created, reordered, renamed, deactivated and reactivated without deleting records. Product images are assigned through the existing required `product_images.product_id` relationship, so their public category comes from the associated product. Staff upload to `catalogue-staging`; Owner and Admin approve images into `catalogue-public` or hide them back into staging. Editor actions remain limited by the existing RLS policies and migration 005 guards. The Homepage Editor is available to active Owner and Admin roles and uses migration 008's release tables and RPCs.

The public homepage and Lookbook read published products, active categories and approved images using the existing Supabase publishable key and public RLS policies. If the read request fails, the current static page content remains as fallback. A successful response with no visible products shows an empty-state message instead of falling back to old static cards. Public product visibility still depends on the existing `homepage_visible` / `lookbook_visible` fields. No database migration is needed for this frontend if the existing catalogue schema and storage policies are already installed. Migration 007 is required separately if either storage bucket or its policies are missing; this frontend does not install or modify database objects.

Lookbook, Site content, Team & access, and Audit history remain placeholders. Do not treat overview placeholder counts as live data.

Run the contract and source tests from the repository root:

```powershell
node --test admin\*.test.mjs public-catalogue.test.mjs supabase\tests\*.test.mjs
```

The staging storage integration test is skipped unless its staging project URL, publishable key and role credentials are configured.
