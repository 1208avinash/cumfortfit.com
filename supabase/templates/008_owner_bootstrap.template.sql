-- MANUAL TEMPLATE ONLY. Never run automatically.
-- Run once in the Supabase SQL Editor after migrations 001-007 have been reviewed,
-- installed, and tested. The target Auth user must already exist and have confirmed
-- the invitation sent to this exact email address.
-- This template intentionally refuses to run if any Owner membership already exists.
begin;

do $$
declare
  v_email text := 'REPLACE_WITH_CONFIRMED_OWNER_EMAIL';
  v_user_id uuid;
  v_confirmed_at timestamptz;
begin
  select id, email_confirmed_at
    into v_user_id, v_confirmed_at
  from auth.users
  where lower(email) = lower(v_email);

  if v_user_id is null then
    raise exception 'No Supabase Auth user found for %. Create/invite the user first.', v_email;
  end if;

  if v_confirmed_at is null then
    raise exception 'The Auth user % has not confirmed the invitation/email yet.', v_email;
  end if;

  if exists (select 1 from public.admin_memberships where role = 'owner') then
    raise exception 'An Owner membership already exists. Use the approved Owner recovery process instead.';
  end if;

  if exists (select 1 from public.admin_memberships where user_id = v_user_id) then
    raise exception 'This Auth user already has an admin membership. Review it manually; bootstrap stopped.';
  end if;

  insert into public.admin_memberships(user_id, role, active)
  values (v_user_id, 'owner', true);
end
$$;

commit;
