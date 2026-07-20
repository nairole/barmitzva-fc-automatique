create extension if not exists pgcrypto;

create table if not exists public.vods (
  id uuid primary key default gen_random_uuid(),
  twitch_video_id text unique not null,
  title text not null,
  url text not null,
  published_at timestamptz not null,
  duration text,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'ignored')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  vod_id uuid references public.vods(id) on delete set null,
  opponent text not null,
  goals_for integer not null check (goals_for >= 0),
  goals_against integer not null check (goals_against >= 0),
  result text not null check (result in ('V', 'N', 'D')),
  played_at timestamptz not null,
  approved boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.vods enable row level security;
alter table public.matches enable row level security;

create table if not exists public.contest_entries (
  id uuid primary key default gen_random_uuid(),
  twitch_username text not null,
  discord_username text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists contest_entries_twitch_unique on public.contest_entries (lower(twitch_username));
create unique index if not exists contest_entries_discord_unique on public.contest_entries (lower(discord_username));

alter table public.contest_entries enable row level security;
