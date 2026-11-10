# CUSTOM FIT PRIME — Admin foundation

This is a standalone static admin application. It does not change the existing public pages.

## Local setup

1. In Supabase, use the project URL and **publishable** key from Project Settings → API Keys.
2. Copy `config.example.js` to `config.js`.
3. Put the project URL and publishable key in `config.js`.
4. Serve the repository root with a local static server and open `/admin/`. Do not open the file directly with `file://`.
5. Sign in with an invited Supabase Auth user who has an active row in `public.admin_memberships`.

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

The sign-in foundation and role-aware shell are implemented. Catalogue screens are intentionally placeholders until the hardened database migrations and their RLS tests are approved and installed. Do not treat placeholder counts as live data.
