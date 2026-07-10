-- Run this after schema.sql to convert Calendar Maew to one shared team.
-- Supabase Auth still requires an identifier internally; the app maps usernames
-- to private synthetic emails so users never need to provide or verify email.

alter table public.teams alter column created_by drop not null;

insert into public.teams (id, name, created_by)
values ('00000000-0000-4000-8000-000000000001', 'Calendar Maew', null)
on conflict (id) do update set name = excluded.name;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  shared_team_id constant uuid := '00000000-0000-4000-8000-000000000001';
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'username', ''),
      'สมาชิก'
    )
  );

  insert into public.team_members (team_id, user_id, role)
  values (shared_team_id, new.id, 'member');

  return new;
end;
$$;

-- Join accounts created before this migration to the shared team.
insert into public.team_members (team_id, user_id, role)
select '00000000-0000-4000-8000-000000000001', id, 'member'
from public.profiles
on conflict (team_id, user_id) do nothing;

-- Team creation and membership administration are no longer exposed to clients.
drop policy if exists "Users create teams" on public.teams;
drop policy if exists "Owners update teams" on public.teams;
drop policy if exists "Owners manage memberships" on public.team_members;

-- If email confirmation is enabled in Supabase Auth settings, disable it:
-- Authentication > Providers > Email > Confirm email = OFF
