-- ChessIQ schema for Supabase (Postgres). Run in the Supabase SQL editor, or: psql "$DATABASE_URL" -f sql/schema.sql
-- Every user-owned row carries user_id = auth.users.id and is protected by row-level security.

-- ───────── Profiles ─────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  preferred_difficulty text not null default 'intermediate' check (preferred_difficulty in ('beginner','easy','intermediate','advanced','expert','max')),
  puzzle_rating integer not null default 1200,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create a profile automatically when someone signs up (Supabase standard pattern)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
          new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ───────── Games ─────────
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  played_at timestamptz not null default now(),
  mode text not null check (mode in ('coach','stockfish','local')),
  opponent text not null,
  difficulty text,
  player_color text not null check (player_color in ('w','b')),
  result text not null check (result in ('1-0','0-1','1/2-1/2','*')),
  outcome text not null check (outcome in ('win','loss','draw','unfinished')),
  termination text,
  moves_count integer not null,
  pgn text not null,
  analysis jsonb                       -- filled in by the backend after the game (Stockfish review)
);
create index if not exists games_user_played_idx on public.games (user_id, played_at desc);

-- ───────── Puzzles (Lichess puzzle database, CC0) ─────────
create table if not exists public.puzzles (
  id text primary key,                 -- Lichess PuzzleId
  fen text not null,                   -- position BEFORE the opponent's first move
  moves text[] not null,               -- UCI; moves[1] is the opponent's move, the rest is the solution
  rating integer not null,
  rating_deviation integer,
  popularity integer,
  nb_plays integer,
  themes text[] not null default '{}',
  game_url text,
  opening_tags text[] not null default '{}',
  rand double precision not null default random()
);
create index if not exists puzzles_rand_idx on public.puzzles (rand);
create index if not exists puzzles_rating_idx on public.puzzles (rating);
create index if not exists puzzles_themes_idx on public.puzzles using gin (themes);

create table if not exists public.puzzle_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  puzzle_id text not null references public.puzzles(id) on delete cascade,
  solved boolean not null,
  hints_used integer not null default 0 check (hints_used >= 0),
  mistakes integer not null default 0 check (mistakes >= 0),
  time_ms integer check (time_ms is null or time_ms >= 0),
  created_at timestamptz not null default now()
);
create index if not exists attempts_user_idx on public.puzzle_attempts (user_id, created_at desc);
create index if not exists attempts_user_puzzle_idx on public.puzzle_attempts (user_id, puzzle_id);

-- ───────── AI Coach conversations ─────────
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_user_idx on public.conversations (user_id, updated_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  facts jsonb,
  provider text,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at);

-- ───────── Row-level security ─────────
alter table public.profiles        enable row level security;
alter table public.games           enable row level security;
alter table public.puzzles         enable row level security;
alter table public.puzzle_attempts enable row level security;
alter table public.conversations   enable row level security;
alter table public.messages        enable row level security;

drop policy if exists profiles_select on public.profiles;  create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists profiles_insert on public.profiles;  create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;  create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists games_all on public.games;           create policy games_all on public.games for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists attempts_all on public.puzzle_attempts; create policy attempts_all on public.puzzle_attempts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists convs_all on public.conversations;   create policy convs_all on public.conversations for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists msgs_all on public.messages;         create policy msgs_all on public.messages for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));

-- Puzzles are public, read-only reference data. No insert/update/delete policies exist, so only the service/owner role can import.
drop policy if exists puzzles_read on public.puzzles;      create policy puzzles_read on public.puzzles for select to anon, authenticated using (true);

-- The anonymous role must never touch user data
revoke all on public.profiles, public.games, public.puzzle_attempts, public.conversations, public.messages from anon;
revoke insert, update, delete on public.puzzles from anon, authenticated;