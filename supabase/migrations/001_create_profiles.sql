create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  email text not null unique,
  role text not null check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

-- A partial unique index enforces the single-admin rule inside the database.
create unique index if not exists profiles_single_admin
  on public.profiles (role)
  where role = 'admin';

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon;
revoke insert, update, delete on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
  on public.profiles for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
