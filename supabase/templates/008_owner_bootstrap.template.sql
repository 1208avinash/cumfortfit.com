-- MANUAL TEMPLATE ONLY. Never run automatically.
-- Verify the Supabase Auth user UUID in the dashboard first.
-- Replace the placeholder and run once from the trusted SQL editor as project owner.
insert into public.admin_memberships(user_id,role,active)
values ('00000000-0000-0000-0000-000000000000'::uuid,'owner',true);
