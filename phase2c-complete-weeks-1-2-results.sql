-- Draft a Dynasty • Phase Two C
-- Completes the full 2026 CFF Week One and Week Two results ledger.
-- Preserved results remain marked PRESERVED. Newly created results are marked SIMULATED.
-- Safe to run more than once.

begin;

alter table public.cff_games
  add column if not exists provenance text not null default 'PRESERVED';

comment on column public.cff_games.provenance is
  'PRESERVED for recovered or previously established results; SIMULATED for newly created canon results; USER_SUPPLIED or CORRECTION may be used later.';

-- Keep the previously established results explicitly marked as preserved.
update public.cff_games
set provenance = 'PRESERVED'
where game_id in (
  '2026-w01-kc-stl',
  '2026-w01-chi-cle',
  '2026-w01-okc-den',
  '2026-w02-stl-chi',
  '2026-w02-den-kc',
  '2026-w02-okc-sa',
  '2026-w02-pit-bal',
  '2026-w02-cin-cle',
  '2026-w02-was-dal',
  '2026-w02-jax-ten',
  '2026-w02-mia-nyg',
  '2026-w02-por-ari',
  '2026-w02-tb-car'
);

-- Missing Week One results, newly simulated and established as canon by Kevin's approval.
insert into public.cff_games
  (game_id, season, week, game_date, kickoff_label, away_team_id, home_team_id,
   away_score, home_score, status, overtime, neutral_site, note,
   source_checkpoint_id, provenance)
values
  ('2026-w01-bal-mia', 2026, 1, '2026-09-13', 'Week 1', 'bal', 'mia', 24, 17, 'FINAL', false, false,
   'Baltimore opened the season with a controlled road win.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w01-pit-cin', 2026, 1, '2026-09-13', 'Week 1', 'pit', 'cin', 20, 27, 'FINAL', false, false,
   'Cincinnati won the Northern Division opener at home.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w01-was-car', 2026, 1, '2026-09-13', 'Week 1', 'was', 'car', 16, 23, 'FINAL', false, false,
   'Carolina protected home field with a one-score victory.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w01-ten-atl', 2026, 1, '2026-09-13', 'Week 1', 'ten', 'atl', 17, 20, 'FINAL', false, false,
   'Atlanta won its inaugural opener by a field goal.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w01-tb-jax', 2026, 1, '2026-09-13', 'Week 1', 'tb', 'jax', 14, 21, 'FINAL', false, false,
   'Jacksonville took the first Florida matchup of the season.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w01-sea-por', 2026, 1, '2026-09-13', 'Week 1', 'sea', 'por', 24, 20, 'FINAL', false, false,
   'Seattle won the first Pacific Northwest rivalry game.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w01-la-sd', 2026, 1, '2026-09-13', 'Week 1', 'la', 'sd', 23, 27, 'FINAL', false, false,
   'San Diego closed out a four-point Southern California win.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w01-bos-phi', 2026, 1, '2026-09-13', 'Week 1', 'bos', 'phi', 24, 30, 'FINAL', false, false,
   'Philadelphia won a high-scoring Northeast opener.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w01-mtl-nyg', 2026, 1, '2026-09-13', 'Week 1', 'mtl', 'nyg', 21, 17, 'FINAL', false, false,
   'Montréal earned a road victory in New York.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w01-no-dal', 2026, 1, '2026-09-13', 'Week 1', 'no', 'dal', 24, 28, 'FINAL', false, false,
   'Dallas held off New Orleans in the Gulf opener.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w01-birm-sa', 2026, 1, '2026-09-13', 'Week 1', 'birm', 'sa', 13, 26, 'FINAL', false, false,
   'San Antonio controlled the second half for a home win.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w01-lv-ari', 2026, 1, '2026-09-13', 'Week 1', 'lv', 'ari', 27, 31, 'FINAL', false, false,
   'Arizona survived a late Las Vegas rally.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w01-phx-min', 2026, 1, '2026-09-13', 'Week 1', 'phx', 'min', 16, 20, 'FINAL', false, false,
   'Minnesota won its inaugural opener with a defensive finish.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED')
on conflict (game_id) do update set
  season = excluded.season,
  week = excluded.week,
  game_date = excluded.game_date,
  kickoff_label = excluded.kickoff_label,
  away_team_id = excluded.away_team_id,
  home_team_id = excluded.home_team_id,
  away_score = excluded.away_score,
  home_score = excluded.home_score,
  status = excluded.status,
  overtime = excluded.overtime,
  neutral_site = excluded.neutral_site,
  note = excluded.note,
  source_checkpoint_id = excluded.source_checkpoint_id,
  provenance = excluded.provenance;

-- Missing Week Two results, newly simulated and established as canon by Kevin's approval.
insert into public.cff_games
  (game_id, season, week, game_date, kickoff_label, away_team_id, home_team_id,
   away_score, home_score, status, overtime, neutral_site, note,
   source_checkpoint_id, provenance)
values
  ('2026-w02-mtl-bos', 2026, 2, '2026-09-20', 'Week 2', 'mtl', 'bos', 20, 27, 'FINAL', false, false,
   'Boston answered its opening loss with a home win over Montréal.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w02-phi-min', 2026, 2, '2026-09-20', 'Week 2', 'phi', 'min', 21, 23, 'FINAL', false, false,
   'Minnesota reached 2-0 on a late field goal.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w02-birm-no', 2026, 2, '2026-09-20', 'Week 2', 'birm', 'no', 17, 24, 'FINAL', false, false,
   'New Orleans earned its first victory at home.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w02-phx-lv', 2026, 2, '2026-09-20', 'Week 2', 'phx', 'lv', 27, 30, 'FINAL', true, false,
   'Las Vegas won in overtime after Phoenix forced the extra period.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w02-atl-la', 2026, 2, '2026-09-20', 'Week 2', 'atl', 'la', 20, 24, 'FINAL', false, false,
   'Los Angeles secured its first win with a fourth-quarter stop.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED'),
  ('2026-w02-sd-sea', 2026, 2, '2026-09-20', 'Week 2', 'sd', 'sea', 21, 27, 'FINAL', false, false,
   'Seattle moved to 2-0 by defending home field.', 'USER-APPROVED-LEAGUE-BACKFILL-2026-07-28', 'SIMULATED')
on conflict (game_id) do update set
  season = excluded.season,
  week = excluded.week,
  game_date = excluded.game_date,
  kickoff_label = excluded.kickoff_label,
  away_team_id = excluded.away_team_id,
  home_team_id = excluded.home_team_id,
  away_score = excluded.away_score,
  home_score = excluded.home_score,
  status = excluded.status,
  overtime = excluded.overtime,
  neutral_site = excluded.neutral_site,
  note = excluded.note,
  source_checkpoint_id = excluded.source_checkpoint_id,
  provenance = excluded.provenance;

-- The results ledger is now complete through Week Two for all 32 clubs.
update public.cff_league_metadata
set
  results_coverage = 'COMPLETE',
  results_through_week = 2,
  coverage_note = 'All 32 franchises now have complete Week One and Week Two results. Previously established scores remain preserved; missing games were newly simulated and recorded as canon under Kevin-approved league completion.',
  updated_at = now()
where season = 2026;

-- Record one transparent canon event, but do not duplicate it on repeat runs.
do $$
declare
  current_state jsonb;
begin
  select state into current_state
  from public.archers_franchise_state
  where id = 'stl-2026';

  if current_state #>> '{canon,league_results,status}' is distinct from 'COMPLETE'
     or current_state #>> '{canon,league_results,through_week}' is distinct from '2'
  then
    perform *
    from public.apply_archers_state_update(
      jsonb_build_object(
        'canon', jsonb_build_object(
          'league_results', jsonb_build_object(
            'status', 'COMPLETE',
            'through_week', 2,
            'preserved_results_retained', true,
            'missing_results_method', 'SIMULATED_WITH_USER_APPROVAL'
          )
        )
      ),
      'league',
      'Completed the full 2026 CFF Week One and Week Two results slate; preserved scores were retained and previously missing games were simulated and recorded.',
      null,
      'LIVE_SESSION_LOG'
    );
  end if;
end
$$;

commit;