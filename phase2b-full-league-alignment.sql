-- Draft a Dynasty • Phase Two B
-- Final 32-team CFF alignment, enhanced standings, league metadata, and console support.
-- Safe to run more than once. Existing game results and Archers state are preserved.

begin;

-- Rename Cleveland's franchise before inserting or updating other clubs.
update public.cff_teams
set
  team_name = 'Cleveland Lakehawks',
  city = 'Cleveland',
  nickname = 'Lakehawks',
  updated_at = now()
where team_id = 'cle';

-- Add the five approved franchises and keep all canonical names synchronized.
insert into public.cff_teams
  (team_id, team_name, city, nickname, conference, division, alignment_status, is_archers, active)
values
  ('bos', 'Boston Rebellion', 'Boston', 'Rebellion', 'Federal', 'Northeast', 'CONFIRMED', false, true),
  ('phi', 'Philadelphia Liberty', 'Philadelphia', 'Liberty', 'Federal', 'Northeast', 'CONFIRMED', false, true),
  ('atl', 'Atlanta Flight', 'Atlanta', 'Flight', 'Continental', 'Southeast', 'CONFIRMED', false, true),
  ('min', 'Minnesota Stags', 'Minnesota', 'Stags', 'Continental', 'Northern', 'CONFIRMED', false, true),
  ('la', 'Los Angeles Armada', 'Los Angeles', 'Armada', 'Continental', 'Pacific', 'CONFIRMED', false, true)
on conflict (team_id) do update set
  team_name = excluded.team_name,
  city = excluded.city,
  nickname = excluded.nickname,
  conference = excluded.conference,
  division = excluded.division,
  alignment_status = 'CONFIRMED',
  is_archers = excluded.is_archers,
  active = true,
  updated_at = now();

-- Final approved 2026 alignment: two conferences, four divisions each, four teams per division.
with alignment(team_id, conference, division) as (
  values
    ('bos', 'Federal', 'Northeast'),
    ('mtl', 'Federal', 'Northeast'),
    ('nyg', 'Federal', 'Northeast'),
    ('phi', 'Federal', 'Northeast'),

    ('stl', 'Federal', 'Central'),
    ('chi', 'Federal', 'Central'),
    ('okc', 'Federal', 'Central'),
    ('kc', 'Federal', 'Central'),

    ('dal', 'Federal', 'Gulf'),
    ('sa', 'Federal', 'Gulf'),
    ('no', 'Federal', 'Gulf'),
    ('birm', 'Federal', 'Gulf'),

    ('den', 'Federal', 'Western'),
    ('lv', 'Federal', 'Western'),
    ('ari', 'Federal', 'Western'),
    ('phx', 'Federal', 'Western'),

    ('pit', 'Continental', 'Northern'),
    ('cle', 'Continental', 'Northern'),
    ('cin', 'Continental', 'Northern'),
    ('min', 'Continental', 'Northern'),

    ('bal', 'Continental', 'Atlantic'),
    ('was', 'Continental', 'Atlantic'),
    ('car', 'Continental', 'Atlantic'),
    ('mia', 'Continental', 'Atlantic'),

    ('atl', 'Continental', 'Southeast'),
    ('ten', 'Continental', 'Southeast'),
    ('jax', 'Continental', 'Southeast'),
    ('tb', 'Continental', 'Southeast'),

    ('sea', 'Continental', 'Pacific'),
    ('por', 'Continental', 'Pacific'),
    ('la', 'Continental', 'Pacific'),
    ('sd', 'Continental', 'Pacific')
)
update public.cff_teams t
set
  conference = a.conference,
  division = a.division,
  alignment_status = 'CONFIRMED',
  updated_at = now()
from alignment a
where t.team_id = a.team_id;

-- Season-level league metadata keeps the console honest about what is complete.
create table if not exists public.cff_league_metadata (
  season integer primary key,
  league_name text not null,
  expected_team_count integer not null,
  alignment_status text not null,
  results_coverage text not null,
  results_through_week integer,
  coverage_note text,
  updated_at timestamptz not null default now()
);

insert into public.cff_league_metadata
  (season, league_name, expected_team_count, alignment_status, results_coverage,
   results_through_week, coverage_note, updated_at)
values
  (2026, 'Collegiate Football Federation', 32, 'CONFIRMED', 'PARTIAL', 2,
   'All 32 franchises and all eight divisions are confirmed. The preserved league-results ledger is incomplete for Weeks One and Two, so zero-game records are displayed as unreported rather than winless.',
   now())
on conflict (season) do update set
  league_name = excluded.league_name,
  expected_team_count = excluded.expected_team_count,
  alignment_status = excluded.alignment_status,
  results_coverage = excluded.results_coverage,
  results_through_week = excluded.results_through_week,
  coverage_note = excluded.coverage_note,
  updated_at = now();

-- Enhanced standings are derived entirely from recorded final games.
create or replace view public.cff_standings as
with appearances as (
  select
    g.game_id,
    g.season,
    g.week,
    g.game_date,
    g.home_team_id as team_id,
    g.away_team_id as opponent_id,
    true as is_home,
    g.home_score as points_for,
    g.away_score as points_against,
    case when g.home_score > g.away_score then 'W'
         when g.home_score < g.away_score then 'L'
         else 'T' end as result
  from public.cff_games g
  where g.status = 'FINAL'

  union all

  select
    g.game_id,
    g.season,
    g.week,
    g.game_date,
    g.away_team_id as team_id,
    g.home_team_id as opponent_id,
    false as is_home,
    g.away_score as points_for,
    g.home_score as points_against,
    case when g.away_score > g.home_score then 'W'
         when g.away_score < g.home_score then 'L'
         else 'T' end as result
  from public.cff_games g
  where g.status = 'FINAL'
), ordered_results as (
  select
    a.*,
    row_number() over (
      partition by a.season, a.team_id
      order by a.game_date desc nulls last, a.week desc nulls last, a.game_id desc
    ) as result_order,
    first_value(a.result) over (
      partition by a.season, a.team_id
      order by a.game_date desc nulls last, a.week desc nulls last, a.game_id desc
    ) as latest_result
  from appearances a
), result_summaries as (
  select
    season,
    team_id,
    string_agg(result, '' order by result_order) filter (where result_order <= 5) as last_five,
    latest_result,
    coalesce(
      min(result_order) filter (where result <> latest_result) - 1,
      count(*)
    )::integer as streak_length
  from ordered_results
  group by season, team_id, latest_result
), aggregated as (
  select
    a.season,
    a.team_id,
    count(*)::integer as games_played,
    count(*) filter (where a.result = 'W')::integer as wins,
    count(*) filter (where a.result = 'L')::integer as losses,
    count(*) filter (where a.result = 'T')::integer as ties,
    sum(a.points_for)::integer as points_for,
    sum(a.points_against)::integer as points_against,

    count(*) filter (where a.is_home and a.result = 'W')::integer as home_wins,
    count(*) filter (where a.is_home and a.result = 'L')::integer as home_losses,
    count(*) filter (where a.is_home and a.result = 'T')::integer as home_ties,
    count(*) filter (where not a.is_home and a.result = 'W')::integer as away_wins,
    count(*) filter (where not a.is_home and a.result = 'L')::integer as away_losses,
    count(*) filter (where not a.is_home and a.result = 'T')::integer as away_ties,

    count(*) filter (
      where team.conference is not null
        and opponent.conference = team.conference
        and a.result = 'W'
    )::integer as conference_wins,
    count(*) filter (
      where team.conference is not null
        and opponent.conference = team.conference
        and a.result = 'L'
    )::integer as conference_losses,
    count(*) filter (
      where team.conference is not null
        and opponent.conference = team.conference
        and a.result = 'T'
    )::integer as conference_ties,

    count(*) filter (
      where team.division is not null
        and opponent.conference = team.conference
        and opponent.division = team.division
        and opponent.team_id <> team.team_id
        and a.result = 'W'
    )::integer as division_wins,
    count(*) filter (
      where team.division is not null
        and opponent.conference = team.conference
        and opponent.division = team.division
        and opponent.team_id <> team.team_id
        and a.result = 'L'
    )::integer as division_losses,
    count(*) filter (
      where team.division is not null
        and opponent.conference = team.conference
        and opponent.division = team.division
        and opponent.team_id <> team.team_id
        and a.result = 'T'
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
    coalesce(a.home_wins, 0) as home_wins,
    coalesce(a.home_losses, 0) as home_losses,
    coalesce(a.home_ties, 0) as home_ties,
    coalesce(a.away_wins, 0) as away_wins,
    coalesce(a.away_losses, 0) as away_losses,
    coalesce(a.away_ties, 0) as away_ties,
    coalesce(a.conference_wins, 0) as conference_wins,
    coalesce(a.conference_losses, 0) as conference_losses,
    coalesce(a.conference_ties, 0) as conference_ties,
    coalesce(a.division_wins, 0) as division_wins,
    coalesce(a.division_losses, 0) as division_losses,
    coalesce(a.division_ties, 0) as division_ties,
    rs.last_five,
    case when rs.latest_result is null then null
         else rs.latest_result || rs.streak_length::text end as streak,
    case
      when coalesce(a.games_played, 0) = 0 then 0::numeric
      else (coalesce(a.wins, 0) + coalesce(a.ties, 0) * 0.5) / a.games_played::numeric
    end as win_pct
  from public.cff_teams t
  left join aggregated a on a.team_id = t.team_id
  left join result_summaries rs on rs.team_id = t.team_id and rs.season = coalesce(a.season, 2026)
  where t.active
)
select
  base.*,
  rank() over (
    partition by conference, division
    order by win_pct desc,
             division_wins desc,
             point_differential desc,
             points_for desc,
             team_name asc
  )::integer as division_rank,
  rank() over (
    partition by conference
    order by win_pct desc,
             conference_wins desc,
             point_differential desc,
             points_for desc,
             team_name asc
  )::integer as conference_rank
from base;

alter table public.cff_league_metadata enable row level security;
revoke all on table public.cff_league_metadata from anon, authenticated;
grant select on table public.cff_league_metadata to anon, service_role;
grant insert, update, delete on table public.cff_league_metadata to service_role;
grant select on public.cff_standings to anon, service_role;

drop policy if exists "Public console reads CFF league metadata" on public.cff_league_metadata;
create policy "Public console reads CFF league metadata"
on public.cff_league_metadata for select to anon using (season = 2026);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cff_league_metadata'
  ) then
    alter publication supabase_realtime add table public.cff_league_metadata;
  end if;
end
$$;

commit;