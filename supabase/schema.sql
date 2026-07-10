create extension if not exists pgcrypto;

create type public.team_role as enum ('owner', 'member');
create type public.availability_status as enum ('available', 'busy');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.team_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table public.availability (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  status public.availability_status not null,
  reason text not null default '' check (char_length(reason) <= 240),
  updated_at timestamptz not null default now(),
  unique (team_id, user_id, date),
  foreign key (team_id, user_id) references public.team_members(team_id, user_id) on delete cascade
);

create index availability_team_date_idx on public.availability(team_id, date);
create index team_members_user_idx on public.team_members(user_id);

create or replace function public.is_team_member(target_team_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members
    where team_id = target_team_id and user_id = auth.uid()
  );
$$;

create or replace function public.enforce_team_member_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.team_members where team_id = new.team_id) >= 20 then
    raise exception 'A team can have at most 20 members';
  end if;
  return new;
end;
$$;

create trigger enforce_team_member_limit_before_insert
before insert on public.team_members
for each row execute function public.enforce_team_member_limit();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.availability enable row level security;

create policy "Profiles visible to shared team members" on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from public.team_members mine
    join public.team_members theirs on theirs.team_id = mine.team_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
create policy "Users update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "Members view teams" on public.teams for select using (public.is_team_member(id));
create policy "Users create teams" on public.teams for insert with check (created_by = auth.uid());
create policy "Owners update teams" on public.teams for update using (
  exists (select 1 from public.team_members where team_id = id and user_id = auth.uid() and role = 'owner')
);

create policy "Members view memberships" on public.team_members for select using (public.is_team_member(team_id));
create policy "Owners manage memberships" on public.team_members for all using (
  exists (select 1 from public.team_members owner where owner.team_id = team_members.team_id and owner.user_id = auth.uid() and owner.role = 'owner')
);

create policy "Members view availability" on public.availability for select using (public.is_team_member(team_id));
create policy "Users insert own availability" on public.availability for insert with check (user_id = auth.uid() and public.is_team_member(team_id));
create policy "Users update own availability" on public.availability for update using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_team_member(team_id));
create policy "Users delete own availability" on public.availability for delete using (user_id = auth.uid());

alter publication supabase_realtime add table public.availability;
