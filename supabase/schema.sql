-- Beer Finder — account schema (profiles, beers_had, leaderboard RPCs)
--
-- Reconstructed from how public/auth.js reads and writes it (there was no
-- schema file checked in — the original project was set up by hand in the
-- Supabase dashboard). Run this once in the NEW project's SQL editor before
-- pointing auth.js at it. Sanity-check it against the old project's real
-- table/policy definitions if you can, in case something not exercised by
-- the app (an extra column, index, etc.) got missed here.

-- profiles: one row per signed-in user, holds their chosen public username.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Usernames + beer counts are shown publicly on the leaderboard, so profiles
-- are readable by anyone; only the owner can create/change their own row.
create policy "profiles are readable by everyone"
  on public.profiles for select
  using (true);

create policy "users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- beers_had: one row per (user, beer) tick — "I've had this beer".
create table public.beers_had (
  user_id uuid not null references auth.users(id) on delete cascade,
  beer_key text not null,
  beer_name text,
  created_at timestamptz not null default now(),
  primary key (user_id, beer_key)
);

alter table public.beers_had enable row level security;

create policy "users can read their own had-beers"
  on public.beers_had for select
  using (auth.uid() = user_id);

create policy "users can insert their own had-beers"
  on public.beers_had for insert
  with check (auth.uid() = user_id);

create policy "users can delete their own had-beers"
  on public.beers_had for delete
  using (auth.uid() = user_id);

-- Leaderboard RPCs: SECURITY DEFINER so they can aggregate across every
-- user's rows (RLS above would otherwise hide other people's beers_had rows),
-- but they only ever return a username + a count — never emails or anything
-- else private.

create or replace function public.leaderboard(lim int default 100)
returns table (username text, beer_count bigint)
language sql
security definer
set search_path = public
as $$
  select p.username, count(bh.beer_key) as beer_count
  from public.profiles p
  join public.beers_had bh on bh.user_id = p.id
  group by p.username
  order by beer_count desc
  limit lim;
$$;

create or replace function public.popular_beers(lim int default 40)
returns table (beer_key text, ticks bigint)
language sql
security definer
set search_path = public
as $$
  select beer_key, count(*) as ticks
  from public.beers_had
  group by beer_key
  order by ticks desc
  limit lim;
$$;

grant execute on function public.leaderboard(int) to anon, authenticated;
grant execute on function public.popular_beers(int) to anon, authenticated;
