create extension if not exists pgcrypto;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  journalist text not null,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  home_team_id uuid not null references public.teams(id) on delete cascade,
  away_team_id uuid not null references public.teams(id) on delete cascade,
  home_score int not null default 0,
  away_score int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.adjustments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  delta int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.teams enable row level security;
alter table public.news enable row level security;
alter table public.matches enable row level security;
alter table public.adjustments enable row level security;

drop policy if exists "Public read teams" on public.teams;
drop policy if exists "Public write teams" on public.teams;
drop policy if exists "Public read news" on public.news;
drop policy if exists "Public write news" on public.news;
drop policy if exists "Public read matches" on public.matches;
drop policy if exists "Public write matches" on public.matches;
drop policy if exists "Public read adjustments" on public.adjustments;
drop policy if exists "Public write adjustments" on public.adjustments;

create policy "Public read teams"
  on public.teams
  for select
  to anon
  using (true);

create policy "Public write teams"
  on public.teams
  for all
  to anon
  using (true)
  with check (true);

create policy "Public read news"
  on public.news
  for select
  to anon
  using (true);

create policy "Public write news"
  on public.news
  for all
  to anon
  using (true)
  with check (true);

create policy "Public read matches"
  on public.matches
  for select
  to anon
  using (true);

create policy "Public write matches"
  on public.matches
  for all
  to anon
  using (true)
  with check (true);

create policy "Public read adjustments"
  on public.adjustments
  for select
  to anon
  using (true);

create policy "Public write adjustments"
  on public.adjustments
  for all
  to anon
  using (true)
  with check (true);
