-- Draft a Dynasty • Phase Two A
-- Tabs, Central Division standings, league scoreboard, and Archers schedule
-- Safe to run more than once.

create table if not exists public.cff_teams (
  team_id text primary key,
  team_name text not null unique,
  city text not null,
  nickname text not null,
  conference text,
  division text,
  alignment_status text not null default 'UNASSIGNED'
    check (alignment_status in ('CONFIRMED', 'UNASSIGNED')),
  is_archers boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cff_games (
  game_id text primary key,
  season integer not null,
  week integer,
  game_date date,
  kickoff_label text,
  away_team_id text not null references public.cff_teams(team_id),
  home_team_id text not null references public.cff_teams(team_id),
  away_score integer check (away_score is null or away_score >= 0),
  home_score integer check (home_score is null or home_score >= 0),
  status text not null default 'SCHEDULED'
    check (status in ('SCHEDULED', 'FINAL', 'CANCELLED')),
  overtime boolean not null default false,
  neutral_site boolean not null default false,
  note text,
  source_checkpoint_id text,
  updated_at timestamptz not null default now(),
  check (away_team_id <> home_team_id),
  check (
    (status = 'FINAL' and away_score is not null and home_score is not null)
    or
    (status <> 'FINAL')
  )
);

create table if not exists public.archers_schedule (
  season integer not null,
  week integer not null,
  game_date date,
  opponent_team_id text references public.cff_teams(team_id),
  site text check (site is null or site in ('Home', 'Away', 'Neutral')),
  kickoff_time_ct text,
  status text not null default 'UPCOMING'
    check (status in ('FINAL', 'NEXT', 'UPCOMING', 'BYE')),
  archers_score integer,
  opponent_score integer,
  note text,
  source_checkpoint_id text,
  updated_at timestamptz not null default now(),
  primary key (season, week)
);

create or replace function public.set_cff_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cff_teams_updated_at on public.cff_teams;
create trigger cff_teams_updated_at
before update on public.cff_teams
for each row execute function public.set_cff_updated_at();

drop trigger if exists cff_games_updated_at on public.cff_games;
create trigger cff_games_updated_at
before update on public.cff_games
for each row execute function public.set_cff_updated_at();

drop trigger if exists archers_schedule_updated_at on public.archers_schedule;
create trigger archers_schedule_updated_at
before update on public.archers_schedule
for each row execute function public.set_cff_updated_at();

insert into public.cff_teams
  (team_id, team_name, city, nickname, conference, division, alignment_status, is_archers)
values
  ('stl', 'St. Louis Archers', 'St. Louis', 'Archers', null, 'Central', 'CONFIRMED', true),
  ('chi', 'Chicago Foundry', 'Chicago', 'Foundry', null, 'Central', 'CONFIRMED', false),
  ('okc', 'Oklahoma City Outriders', 'Oklahoma City', 'Outriders', null, 'Central', 'CONFIRMED', false),
  ('kc', 'Kansas City Stampede', 'Kansas City', 'Stampede', null, 'Central', 'CONFIRMED', false),
  ('bal', 'Baltimore Admirals', 'Baltimore', 'Admirals', null, null, 'UNASSIGNED', false),
  ('pit', 'Pittsburgh Iron', 'Pittsburgh', 'Iron', null, null, 'UNASSIGNED', false),
  ('cle', 'Cleveland Guardians', 'Cleveland', 'Guardians', null, null, 'UNASSIGNED', false),
  ('cin', 'Cincinnati Monarchs', 'Cincinnati', 'Monarchs', null, null, 'UNASSIGNED', false),
  ('den', 'Denver Mountaineers', 'Denver', 'Mountaineers', null, null, 'UNASSIGNED', false),
  ('sa', 'San Antonio Marshals', 'San Antonio', 'Marshals', null, null, 'UNASSIGNED', false),
  ('dal', 'Dallas Wranglers', 'Dallas', 'Wranglers', null, null, 'UNASSIGNED', false),
  ('was', 'Washington Sentinels', 'Washington', 'Sentinels', null, null, 'UNASSIGNED', false),
  ('ten', 'Tennessee Copperheads', 'Tennessee', 'Copperheads', null, null, 'UNASSIGNED', false),
  ('jax', 'Jacksonville Cyclones', 'Jacksonville', 'Cyclones', null, null, 'UNASSIGNED', false),
  ('nyg', 'New York Guardians', 'New York', 'Guardians', null, null, 'UNASSIGNED', false),
  ('mia', 'Miami Tridents', 'Miami', 'Tridents', null, null, 'UNASSIGNED', false),
  ('ari', 'Arizona Scorpions', 'Arizona', 'Scorpions', null, null, 'UNASSIGNED', false),
  ('por', 'Portland Pioneers', 'Portland', 'Pioneers', null, null, 'UNASSIGNED', false),
  ('car', 'Carolina Reapers', 'Carolina', 'Reapers', null, null, 'UNASSIGNED', false),
  ('tb', 'Tampa Bay Tritons', 'Tampa Bay', 'Tritons', null, null, 'UNASSIGNED', false),
  ('sea', 'Seattle Cascades', 'Seattle', 'Cascades', null, null, 'UNASSIGNED', false),
  ('phx', 'Phoenix Firebirds', 'Phoenix', 'Firebirds', null, null, 'UNASSIGNED', false),
  ('no', 'New Orleans Krewe', 'New Orleans', 'Krewe', null, null, 'UNASSIGNED', false),
  ('lv', 'Las Vegas Vipers', 'Las Vegas', 'Vipers', null, null, 'UNASSIGNED', false),
  ('mtl', 'Montréal Voyageurs', 'Montréal', 'Voyageurs', null, null, 'UNASSIGNED', false),
  ('birm', 'Birmingham Vulcans', 'Birmingham', 'Vulcans', null, null, 'UNASSIGNED', false),
  ('sd', 'San Diego Breakers', 'San Diego', 'Breakers', null, null, 'UNASSIGNED', false)
on conflict (team_id) do update set
  team_name = excluded.team_name,
  city = excluded.city,
  nickname = excluded.nickname,
  conference = coalesce(excluded.conference, public.cff_teams.conference),
  division = coalesce(excluded.division, public.cff_teams.division),
  alignment_status = case
    when excluded.alignment_status = 'CONFIRMED' then 'CONFIRMED'
    else public.cff_teams.alignment_status
  end,
  is_archers = excluded.is_archers,
  active = true;

insert into public.cff_games
  (game_id, season, week, game_date, kickoff_label, away_team_id, home_team_id,
   away_score, home_score, status, overtime, note, source_checkpoint_id)
values
  ('2026-w01-kc-stl', 2026, 1, '2026-09-13', 'Week 1', 'kc', 'stl', 3, 34, 'FINAL', false,
   'First regular-season game and first victory in Archers history.', 'STL-2026-W01-CCP'),
  ('2026-w01-chi-cle', 2026, 1, '2026-09-13', 'Week 1', 'chi', 'cle', 24, 20, 'FINAL', false,
   null, 'STL-2026-W01-CCP'),
  ('2026-w01-okc-den', 2026, 1, '2026-09-13', 'Week 1', 'okc', 'den', 16, 27, 'FINAL', false,
   null, 'STL-2026-W01-CCP'),
  ('2026-w02-stl-chi', 2026, 2, '2026-09-20', 'Week 2', 'stl', 'chi', 31, 3, 'FINAL', false,
   'First road victory in Archers history.', 'STL-2026-W02-CCP'),
  ('2026-w02-den-kc', 2026, 2, '2026-09-20', 'Week 2', 'den', 'kc', 20, 27, 'FINAL', false,
   null, 'STL-2026-W02-CCP'),
  ('2026-w02-okc-sa', 2026, 2, '2026-09-20', 'Week 2', 'okc', 'sa', 23, 20, 'FINAL', false,
   null, 'STL-2026-W02-CCP'),
  ('2026-w02-pit-bal', 2026, 2, '2026-09-20', 'Week 2', 'pit', 'bal', 13, 16, 'FINAL', true,
   'Baltimore won through defense, field position, and a late takeaway.', 'STL-2026-W02-CCP'),
  ('2026-w02-cin-cle', 2026, 2, '2026-09-20', 'Week 2', 'cin', 'cle', 17, 30, 'FINAL', false,
   null, 'STL-2026-W02-CCP'),
  ('2026-w02-was-dal', 2026, 2, '2026-09-20', 'Week 2', 'was', 'dal', 20, 24, 'FINAL', false,
   null, 'STL-2026-W02-CCP'),
  ('2026-w02-jax-ten', 2026, 2, '2026-09-20', 'Week 2', 'jax', 'ten', 13, 27, 'FINAL', false,
   null, 'STL-2026-W02-CCP'),
  ('2026-w02-mia-nyg', 2026, 2, '2026-09-20', 'Week 2', 'mia', 'nyg', 13, 16, 'FINAL', false,
   null, 'STL-2026-W02-CCP'),
  ('2026-w02-por-ari', 2026, 2, '2026-09-20', 'Week 2', 'por', 'ari', 21, 26, 'FINAL', false,
   null, 'STL-2026-W02-CCP'),
  ('2026-w02-tb-car', 2026, 2, '2026-09-20', 'Week 2', 'tb', 'car', 17, 20, 'FINAL', false,
   null, 'STL-2026-W02-CCP')
on conflict (game_id) do update set
  away_score = excluded.away_score,
  home_score = excluded.home_score,
  status = excluded.status,
  overtime = excluded.overtime,
  note = excluded.note,
  source_checkpoint_id = excluded.source_checkpoint_id;

insert into public.archers_schedule
  (season, week, game_date, opponent_team_id, site, kickoff_time_ct, status,
   archers_score, opponent_score, note, source_checkpoint_id)
values
  (2026, 1, '2026-09-13', 'kc', 'Home', '12:00 PM', 'FINAL', 34, 3,
   'First regular-season game and first victory in franchise history.', 'STL-2026-W02-CCP'),
  (2026, 2, '2026-09-20', 'chi', 'Away', '1:00 PM', 'FINAL', 31, 3,
   'First road game and first road victory.', 'STL-2026-W02-CCP'),
  (2026, 3, '2026-09-27', 'bal', 'Home', '12:00 PM', 'NEXT', null, null,
   null, 'STL-2026-W02-CCP'),
  (2026, 4, '2026-10-04', 'sea', 'Away', '3:05 PM', 'UPCOMING', null, null,
   null, 'STL-2026-W02-CCP'),
  (2026, 5, '2026-10-11', 'cle', 'Away', '12:00 PM', 'UPCOMING', null, null,
   null, 'STL-2026-W02-CCP'),
  (2026, 6, '2026-10-18', 'den', 'Home', '3:25 PM', 'UPCOMING', null, null,
   null, 'STL-2026-W02-CCP'),
  (2026, 7, '2026-10-25', 'car', 'Home', '12:00 PM', 'UPCOMING', null, null,
   'Rashad Crowder reunion.', 'STL-2026-W02-CCP'),
  (2026, 8, '2026-11-01', 'okc', 'Away', '12:00 PM', 'UPCOMING', null, null,
   'Division game.', 'STL-2026-W02-CCP'),
  (2026, 9, '2026-11-08', 'chi', 'Home', '7:20 PM', 'UPCOMING', null, null,
   'Sunday Night Football.', 'STL-2026-W02-CCP'),
  (2026, 10, '2026-11-15', null, null, null, 'BYE', null, null,
   'Bye week.', 'STL-2026-W02-CCP'),
  (2026, 11, '2026-11-22', 'phx', 'Away', '3:05 PM', 'UPCOMING', null, null,
   'Elijah Ross reunion.', 'STL-2026-W02-CCP'),
  (2026, 12, '2026-11-29', 'no', 'Home', '12:00 PM', 'UPCOMING', null, null,
   'Tavon McCray reunion.', 'STL-2026-W02-CCP'),
  (2026, 13, '2026-12-07', 'kc', 'Away', '7:15 PM', 'UPCOMING', null, null,
   'Monday Night Football.', 'STL-2026-W02-CCP'),
  (2026, 14, '2026-12-13', 'lv', 'Home', '3:25 PM', 'UPCOMING', null, null,
   'Ace Holloway and draft-trade game.', 'STL-2026-W02-CCP'),
  (2026, 15, '2026-12-20', 'mtl', 'Away', '12:00 PM', 'UPCOMING', null, null,
   null, 'STL-2026-W02-CCP'),
  (2026, 16, '2026-12-27', 'okc', 'Home', '12:00 PM', 'UPCOMING', null, null,
   'Division game.', 'STL-2026-W02-CCP'),
  (2026, 17, '2027-01-03', 'sa', 'Away', '3:25 PM', 'UPCOMING', null, null,
   null, 'STL-2026-W02-CCP'),
  (2026, 18, '2027-01-10', 'dal', 'Home', 'TBD', 'UPCOMING', null, null,
   'Eligible for flex scheduling.', 'STL-2026-W02-CCP')
on conflict (season, week) do update set
  game_date = excluded.game_date,
  opponent_team_id = excluded.opponent_team_id,
  site = excluded.site,
  kickoff_time_ct = excluded.kickoff_time_ct,
  status = excluded.status,
  archers_score = excluded.archers_score,
  opponent_score = excluded.opponent_score,
  note = excluded.note,
  source_checkpoint_id = excluded.source_checkpoint_id;

create or replace view public.cff_standings as
with appearances as (
  select
    g.game_id,
    g.season,
    g.week,
    g.home_team_id as team_id,
    g.away_team_id as opponent_id,
    g.home_score as points_for,
    g.away_score as points_against
  from public.cff_games g
  where g.status = 'FINAL'

  union all

  select
    g.game_id,
    g.season,
    g.week,
    g.away_team_id as team_id,
    g.home_team_id as opponent_id,
    g.away_score as points_for,
    g.home_score as points_against
  from public.cff_games g
  where g.status = 'FINAL'
), aggregated as (
  select
    a.season,
    a.team_id,
    count(*)::integer as games_played,
    count(*) filter (where a.points_for > a.points_against)::integer as wins,
    count(*) filter (where a.points_for < a.points_against)::integer as losses,
    count(*) filter (where a.points_for = a.points_against)::integer as ties,
    sum(a.points_for)::integer as points_for,
    sum(a.points_against)::integer as points_against,
    count(*) filter (
      where team.division is not null
        and opponent.division = team.division
        and opponent.team_id <> team.team_id
        and a.points_for > a.points_against
    )::integer as division_wins,
    count(*) filter (
      where team.division is not null
        and opponent.division = team.division
        and opponent.team_id <> team.team_id
        and a.points_for < a.points_against
    )::integer as division_losses,
    count(*) filter (
      where team.division is not null
        and opponent.division = team.division
        and opponent.team_id <> team.team_id
        and a.points_for = a.points_against
    )::integer as division_ties
  from appearances a
  join public.cff_teams team on team.team_id = a.team_id
  join public.cff_teams opponent on opponent.team_id = a.opponent_id
  group by a.season, a.team_id
), base as (
  select
    t.team_id,
    t.team_name,
    t.city,
    t.nickname,
    t.conference,
    t.division,
    t.alignment_status,
    t.is_archers,
    coalesce(a.season, 2026) as season,
    coalesce(a.games_played, 0) as games_played,
    coalesce(a.wins, 0) as wins,
    coalesce(a.losses, 0) as losses,
    coalesce(a.ties, 0) as ties,
    coalesce(a.points_for, 0) as points_for,
    coalesce(a.points_against, 0) as points_against,
    coalesce(a.points_for, 0) - coalesce(a.points_against, 0) as point_differential,
    coalesce(a.division_wins, 0) as division_wins,
    coalesce(a.division_losses, 0) as division_losses,
    coalesce(a.division_ties, 0) as division_ties,
    case
      when coalesce(a.games_played, 0) = 0 then 0::numeric
      else (coalesce(a.wins, 0) + coalesce(a.ties, 0) * 0.5) / a.games_played::numeric
    end as win_pct
  from public.cff_teams t
  left join aggregated a on a.team_id = t.team_id
  where t.active
)
select
  base.*,
  case
    when division is null then null
    else rank() over (
      partition by division
      order by win_pct desc,
               division_wins desc,
               point_differential desc,
               team_name asc
    )::integer
  end as division_rank
from base;

alter table public.cff_teams enable row level security;
alter table public.cff_games enable row level security;
alter table public.archers_schedule enable row level security;

revoke all on table public.cff_teams from anon, authenticated;
revoke all on table public.cff_games from anon, authenticated;
revoke all on table public.archers_schedule from anon, authenticated;

grant usage on schema public to anon, service_role;
grant select on table public.cff_teams to anon, service_role;
grant select on table public.cff_games to anon, service_role;
grant select on table public.archers_schedule to anon, service_role;
grant select on public.cff_standings to anon, service_role;
grant insert, update, delete on table public.cff_teams to service_role;
grant insert, update, delete on table public.cff_games to service_role;
grant insert, update, delete on table public.archers_schedule to service_role;

drop policy if exists "Public console reads CFF teams" on public.cff_teams;
create policy "Public console reads CFF teams"
on public.cff_teams for select to anon using (active = true);

drop policy if exists "Public console reads CFF games" on public.cff_games;
create policy "Public console reads CFF games"
on public.cff_games for select to anon using (true);

drop policy if exists "Public console reads Archers schedule" on public.archers_schedule;
create policy "Public console reads Archers schedule"
on public.archers_schedule for select to anon using (season = 2026);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cff_teams'
  ) then
    alter publication supabase_realtime add table public.cff_teams;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cff_games'
  ) then
    alter publication supabase_realtime add table public.cff_games;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'archers_schedule'
  ) then
    alter publication supabase_realtime add table public.archers_schedule;
  end if;
end
$$;
