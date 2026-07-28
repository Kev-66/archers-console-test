-- Draft a Dynasty • Phase Three
-- Unified Franchise, League, Resource, and Live Game Operations
--
-- This is the one-time backend installation that removes the need for routine SQL.
-- After deployment, the protected Edge Function can perform validated operational
-- writes through one command endpoint. It never exposes arbitrary SQL or hard deletes.
--
-- Prerequisites:
--   1. phase1-setup.sql and phase1-fix-sync-status.sql
--   2. phase2-league-setup.sql
--   3. phase2b-full-league-alignment.sql
-- Safe to run more than once.

begin;

-- -----------------------------------------------------------------------------
-- Existing operational tables gain optimistic-concurrency and provenance fields.
-- -----------------------------------------------------------------------------

alter table public.cff_teams
  add column if not exists version integer not null default 1 check (version > 0);

alter table public.cff_games
  add column if not exists version integer not null default 1 check (version > 0),
  add column if not exists provenance text not null default 'PRESERVED',
  add column if not exists finalized_at timestamptz;

alter table public.archers_schedule
  add column if not exists version integer not null default 1 check (version > 0);

-- -----------------------------------------------------------------------------
-- Extensible resource store.
-- New operational concepts can be added as validated resources without a migration.
-- Major relational systems may still receive dedicated tables later.
-- -----------------------------------------------------------------------------

create table if not exists public.archers_resources (
  franchise_id text not null default 'stl-2026'
    references public.archers_franchise_state(id) on delete restrict,
  resource_type text not null,
  resource_id text not null,
  season integer,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'ARCHIVED')),
  visibility text not null default 'PRIVATE'
    check (visibility in ('PRIVATE', 'CONSOLE')),
  provenance text not null default 'LIVE_SESSION_LOG',
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  primary key (franchise_id, resource_type, resource_id),
  check (resource_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  check (resource_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
);

-- -----------------------------------------------------------------------------
-- Live game ledger.
-- -----------------------------------------------------------------------------

create table if not exists public.cff_live_games (
  game_id text primary key references public.cff_games(game_id) on delete restrict,
  season integer not null,
  week integer,
  away_team_id text not null references public.cff_teams(team_id),
  home_team_id text not null references public.cff_teams(team_id),
  away_score integer not null default 0 check (away_score >= 0),
  home_score integer not null default 0 check (home_score >= 0),
  quarter integer not null default 0 check (quarter between 0 and 8),
  clock_remaining text,
  possession_team_id text references public.cff_teams(team_id),
  field_position_label text,
  down integer check (down is null or down between 1 and 4),
  distance integer check (distance is null or distance >= 0),
  away_timeouts integer not null default 3 check (away_timeouts between 0 and 3),
  home_timeouts integer not null default 3 check (home_timeouts between 0 and 3),
  status text not null default 'PRE_GAME'
    check (status in ('PRE_GAME', 'LIVE', 'HALFTIME', 'FINAL_PENDING', 'FINAL', 'SUSPENDED')),
  metadata jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  started_at timestamptz,
  finalized_at timestamptz,
  updated_at timestamptz not null default now(),
  check (away_team_id <> home_team_id)
);

create table if not exists public.cff_game_drives (
  game_id text not null references public.cff_live_games(game_id) on delete restrict,
  drive_number integer not null check (drive_number > 0),
  offense_team_id text not null references public.cff_teams(team_id),
  defense_team_id text not null references public.cff_teams(team_id),
  start_quarter integer,
  start_clock text,
  start_field_position text,
  end_quarter integer,
  end_clock text,
  end_field_position text,
  plays integer check (plays is null or plays >= 0),
  yards integer,
  result text not null,
  points integer not null default 0 check (points >= 0),
  time_of_possession text,
  summary text not null,
  stats_delta jsonb not null default '{}'::jsonb,
  provenance text not null default 'LIVE_SESSION_LOG',
  version integer not null default 1 check (version > 0),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (game_id, drive_number),
  check (offense_team_id <> defense_team_id)
);

create table if not exists public.cff_game_events (
  event_id bigint generated by default as identity primary key,
  game_id text not null references public.cff_live_games(game_id) on delete restrict,
  drive_number integer,
  sequence_number integer,
  event_type text not null,
  team_id text references public.cff_teams(team_id),
  player_id text,
  quarter integer,
  clock_remaining text,
  summary text not null,
  data jsonb not null default '{}'::jsonb,
  provenance text not null default 'LIVE_SESSION_LOG',
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.cff_game_team_stats (
  game_id text not null references public.cff_live_games(game_id) on delete restrict,
  team_id text not null references public.cff_teams(team_id),
  stats jsonb not null default '{}'::jsonb,
  reconciliation_status text not null default 'IN_PROGRESS'
    check (reconciliation_status in ('IN_PROGRESS', 'RECONCILED', 'NOT_TRACKED')),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (game_id, team_id)
);

create table if not exists public.cff_game_player_stats (
  game_id text not null references public.cff_live_games(game_id) on delete restrict,
  team_id text not null references public.cff_teams(team_id),
  player_id text not null,
  player_name text not null,
  position text,
  stats jsonb not null default '{}'::jsonb,
  reconciliation_status text not null default 'IN_PROGRESS'
    check (reconciliation_status in ('IN_PROGRESS', 'RECONCILED', 'NOT_TRACKED')),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (game_id, team_id, player_id)
);

-- -----------------------------------------------------------------------------
-- Private audit and recovery tables.
-- -----------------------------------------------------------------------------

create table if not exists public.archers_operation_log (
  operation_id bigint generated by default as identity primary key,
  idempotency_key text not null unique,
  operation text not null,
  resource_type text,
  resource_id text,
  expected_version integer,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  summary text not null,
  source_label text not null,
  exact_kevin_text text,
  state_version integer,
  status text not null default 'SUCCESS'
    check (status in ('SUCCESS', 'REJECTED')),
  created_at timestamptz not null default now()
);

create table if not exists public.archers_state_snapshots (
  snapshot_id bigint generated by default as identity primary key,
  franchise_id text not null references public.archers_franchise_state(id) on delete restrict,
  state_version integer not null,
  state jsonb not null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- Standard updated_at triggers.
drop trigger if exists archers_resources_updated_at on public.archers_resources;
create trigger archers_resources_updated_at
before update on public.archers_resources
for each row execute function public.set_cff_updated_at();

drop trigger if exists cff_live_games_updated_at on public.cff_live_games;
create trigger cff_live_games_updated_at
before update on public.cff_live_games
for each row execute function public.set_cff_updated_at();

drop trigger if exists cff_game_drives_updated_at on public.cff_game_drives;
create trigger cff_game_drives_updated_at
before update on public.cff_game_drives
for each row execute function public.set_cff_updated_at();

drop trigger if exists cff_game_team_stats_updated_at on public.cff_game_team_stats;
create trigger cff_game_team_stats_updated_at
before update on public.cff_game_team_stats
for each row execute function public.set_cff_updated_at();

drop trigger if exists cff_game_player_stats_updated_at on public.cff_game_player_stats;
create trigger cff_game_player_stats_updated_at
before update on public.cff_game_player_stats
for each row execute function public.set_cff_updated_at();

-- -----------------------------------------------------------------------------
-- Unified validated command function.
-- One protected RPC handles routine writes. No arbitrary table name or SQL is accepted.
-- -----------------------------------------------------------------------------

create or replace function public.archers_execute_operation(
  p_operation text,
  p_resource_type text default null,
  p_resource_id text default null,
  p_payload jsonb default '{}'::jsonb,
  p_expected_version integer default null,
  p_idempotency_key text default null,
  p_summary text default null,
  p_source_label text default 'LIVE_SESSION_LOG',
  p_exact_kevin_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation text := lower(trim(coalesce(p_operation, '')));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_existing_result jsonb;
  v_result jsonb := '{}'::jsonb;
  v_state_patch jsonb := '{}'::jsonb;
  v_state_row public.archers_franchise_state%rowtype;
  v_merged_state jsonb;
  v_new_state_version integer;
  v_event_id bigint;
  v_expected_state_version integer;
  v_event_type text;
  v_now timestamptz := now();
  v_item jsonb;
  v_count integer := 0;
  v_id text;
  v_type text;
  v_current_version integer;
  v_live public.cff_live_games%rowtype;
  v_standing record;
  v_archers_score integer;
  v_opponent_score integer;
  v_opponent_id text;
  v_site text;
begin
  if v_operation = '' then
    raise exception 'operation is required';
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'payload must be one JSON object';
  end if;

  if coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'idempotency_key is required for every write';
  end if;

  if length(p_idempotency_key) > 180 then
    raise exception 'idempotency_key is too long';
  end if;

  if coalesce(trim(p_summary), '') = '' then
    raise exception 'summary is required';
  end if;

  if p_source_label not in ('USER_EXPLICIT', 'LIVE_SESSION_LOG', 'CHECKPOINT', 'CORRECTION', 'SYSTEM') then
    raise exception 'unsupported source_label: %', p_source_label;
  end if;

  select result_payload
  into v_existing_result
  from public.archers_operation_log
  where idempotency_key = p_idempotency_key
    and status = 'SUCCESS';

  if found then
    return v_existing_result || jsonb_build_object('idempotent_replay', true);
  end if;

  v_expected_state_version := nullif(v_payload #>> '{expected_state_version}', '')::integer;
  v_event_type := coalesce(nullif(v_payload #>> '{event_type}', ''),
    case
      when v_operation in ('start_game', 'update_live_game', 'record_drive', 'record_game_event', 'upsert_team_stats', 'upsert_player_stats', 'finalize_game') then 'game'
      when v_operation in ('upsert_team', 'upsert_game', 'bulk_upsert_games', 'upsert_schedule') then 'league'
      when v_operation in ('upsert_resource', 'bulk_upsert_resources', 'archive_resource') then coalesce(p_resource_type, 'resource')
      when v_operation = 'create_snapshot' then 'system'
      else 'decision'
    end
  );

  -- ---------------------------------------------------------------------------
  -- Franchise state patch.
  -- ---------------------------------------------------------------------------
  if v_operation = 'patch_franchise_state' then
    v_state_patch := coalesce(v_payload -> 'patch', v_payload - 'expected_state_version' - 'event_type');
    if jsonb_typeof(v_state_patch) <> 'object' then
      raise exception 'patch must be a JSON object';
    end if;
    if v_expected_state_version is null then
      v_expected_state_version := p_expected_version;
    end if;
    v_result := jsonb_build_object('operation', v_operation, 'patched', true);

  -- ---------------------------------------------------------------------------
  -- Generic extensible resources.
  -- ---------------------------------------------------------------------------
  elsif v_operation in ('upsert_resource', 'archive_resource') then
    v_type := lower(coalesce(nullif(trim(p_resource_type), ''), nullif(v_payload ->> 'resource_type', '')));
    v_id := coalesce(nullif(trim(p_resource_id), ''), nullif(v_payload ->> 'resource_id', ''));

    if v_type is null or v_type !~ '^[a-z][a-z0-9_]{1,63}$' then
      raise exception 'resource_type must match ^[a-z][a-z0-9_]{1,63}$';
    end if;
    if v_id is null or v_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
      raise exception 'resource_id has an unsupported format';
    end if;

    select version into v_current_version
    from public.archers_resources
    where franchise_id = 'stl-2026' and resource_type = v_type and resource_id = v_id
    for update;

    if found and p_expected_version is null then
      raise exception 'expected_version is required when updating an existing resource';
    end if;
    if found and v_current_version <> p_expected_version then
      raise exception 'stale resource version: expected %, current %', p_expected_version, v_current_version;
    end if;

    if v_operation = 'archive_resource' then
      if not found then raise exception 'resource does not exist'; end if;
      update public.archers_resources
      set status = 'ARCHIVED', archived_at = v_now, version = version + 1,
          provenance = p_source_label
      where franchise_id = 'stl-2026' and resource_type = v_type and resource_id = v_id
      returning to_jsonb(public.archers_resources.*) into v_result;
    else
      insert into public.archers_resources (
        franchise_id, resource_type, resource_id, season, data, status,
        visibility, provenance, version, archived_at
      ) values (
        'stl-2026', v_type, v_id,
        nullif(v_payload ->> 'season', '')::integer,
        coalesce(v_payload -> 'data', '{}'::jsonb),
        coalesce(nullif(v_payload ->> 'status', ''), 'ACTIVE'),
        coalesce(nullif(v_payload ->> 'visibility', ''), 'PRIVATE'),
        coalesce(nullif(v_payload ->> 'provenance', ''), p_source_label),
        1,
        null
      )
      on conflict (franchise_id, resource_type, resource_id) do update set
        season = coalesce(excluded.season, public.archers_resources.season),
        data = excluded.data,
        status = excluded.status,
        visibility = excluded.visibility,
        provenance = excluded.provenance,
        archived_at = case when excluded.status = 'ARCHIVED' then v_now else null end,
        version = public.archers_resources.version + 1
      returning to_jsonb(public.archers_resources.*) into v_result;
    end if;
    v_state_patch := coalesce(v_payload -> 'state_patch', '{}'::jsonb);

  elsif v_operation = 'bulk_upsert_resources' then
    if jsonb_typeof(v_payload -> 'resources') <> 'array' then
      raise exception 'payload.resources must be an array';
    end if;
    for v_item in select value from jsonb_array_elements(v_payload -> 'resources') loop
      v_type := lower(v_item ->> 'resource_type');
      v_id := v_item ->> 'resource_id';
      if v_type is null or v_type !~ '^[a-z][a-z0-9_]{1,63}$' then
        raise exception 'invalid resource_type in batch';
      end if;
      if v_id is null or v_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
        raise exception 'invalid resource_id in batch';
      end if;
      insert into public.archers_resources (
        franchise_id, resource_type, resource_id, season, data, status,
        visibility, provenance, version
      ) values (
        'stl-2026', v_type, v_id,
        nullif(v_item ->> 'season', '')::integer,
        coalesce(v_item -> 'data', '{}'::jsonb),
        coalesce(nullif(v_item ->> 'status', ''), 'ACTIVE'),
        coalesce(nullif(v_item ->> 'visibility', ''), 'PRIVATE'),
        coalesce(nullif(v_item ->> 'provenance', ''), p_source_label),
        1
      )
      on conflict (franchise_id, resource_type, resource_id) do update set
        season = coalesce(excluded.season, public.archers_resources.season),
        data = excluded.data,
        status = excluded.status,
        visibility = excluded.visibility,
        provenance = excluded.provenance,
        archived_at = case when excluded.status = 'ARCHIVED' then v_now else null end,
        version = public.archers_resources.version + 1;
      v_count := v_count + 1;
    end loop;
    v_result := jsonb_build_object('operation', v_operation, 'resources_written', v_count);
    v_state_patch := coalesce(v_payload -> 'state_patch', '{}'::jsonb);

  -- ---------------------------------------------------------------------------
  -- League teams.
  -- ---------------------------------------------------------------------------
  elsif v_operation = 'upsert_team' then
    v_id := coalesce(nullif(trim(p_resource_id), ''), nullif(v_payload ->> 'team_id', ''));
    if v_id is null then raise exception 'team_id is required'; end if;

    select version into v_current_version from public.cff_teams where team_id = v_id for update;
    if found and p_expected_version is null then
      raise exception 'expected_version is required when updating an existing team';
    end if;
    if found and v_current_version <> p_expected_version then
      raise exception 'stale team version: expected %, current %', p_expected_version, v_current_version;
    end if;

    insert into public.cff_teams (
      team_id, team_name, city, nickname, conference, division,
      alignment_status, is_archers, active, version
    ) values (
      v_id,
      case when v_id = 'stl' then 'St. Louis Archers' else v_payload ->> 'team_name' end,
      case when v_id = 'stl' then 'St. Louis' else v_payload ->> 'city' end,
      case when v_id = 'stl' then 'Archers' else v_payload ->> 'nickname' end,
      v_payload ->> 'conference',
      v_payload ->> 'division',
      coalesce(nullif(v_payload ->> 'alignment_status', ''), 'UNASSIGNED'),
      (v_id = 'stl'),
      coalesce((v_payload ->> 'active')::boolean, true),
      1
    )
    on conflict (team_id) do update set
      team_name = case when excluded.team_id = 'stl' then 'St. Louis Archers' else excluded.team_name end,
      city = case when excluded.team_id = 'stl' then 'St. Louis' else excluded.city end,
      nickname = case when excluded.team_id = 'stl' then 'Archers' else excluded.nickname end,
      conference = excluded.conference,
      division = excluded.division,
      alignment_status = excluded.alignment_status,
      is_archers = (excluded.team_id = 'stl'),
      active = excluded.active,
      version = public.cff_teams.version + 1
    returning to_jsonb(public.cff_teams.*) into v_result;
    v_state_patch := coalesce(v_payload -> 'state_patch', '{}'::jsonb);

  -- ---------------------------------------------------------------------------
  -- Official league game records, including bulk slates.
  -- ---------------------------------------------------------------------------
  elsif v_operation in ('upsert_game', 'bulk_upsert_games') then
    if v_operation = 'upsert_game' then
      v_payload := jsonb_build_object('games', jsonb_build_array(v_payload));
    elsif jsonb_typeof(v_payload -> 'games') <> 'array' then
      raise exception 'payload.games must be an array';
    end if;

    for v_item in select value from jsonb_array_elements(v_payload -> 'games') loop
      v_id := coalesce(nullif(v_item ->> 'game_id', ''), p_resource_id);
      if v_id is null then raise exception 'every game requires game_id'; end if;

      select version into v_current_version from public.cff_games where game_id = v_id for update;
      if found and (select status from public.cff_games where game_id = v_id) = 'FINAL'
         and p_source_label <> 'CORRECTION'
         and (
           (v_item ? 'away_score' and (select away_score from public.cff_games where game_id = v_id) is distinct from nullif(v_item ->> 'away_score', '')::integer)
           or (v_item ? 'home_score' and (select home_score from public.cff_games where game_id = v_id) is distinct from nullif(v_item ->> 'home_score', '')::integer)
         )
      then
        raise exception 'changing an established final score requires source_label CORRECTION';
      end if;

      if found and nullif(v_item ->> 'expected_version', '') is not null
         and v_current_version <> (v_item ->> 'expected_version')::integer then
        raise exception 'stale game version for %', v_id;
      end if;

      insert into public.cff_games (
        game_id, season, week, game_date, kickoff_label, away_team_id, home_team_id,
        away_score, home_score, status, overtime, neutral_site, note,
        source_checkpoint_id, provenance, finalized_at, version
      ) values (
        v_id,
        (v_item ->> 'season')::integer,
        nullif(v_item ->> 'week', '')::integer,
        nullif(v_item ->> 'game_date', '')::date,
        v_item ->> 'kickoff_label',
        v_item ->> 'away_team_id',
        v_item ->> 'home_team_id',
        nullif(v_item ->> 'away_score', '')::integer,
        nullif(v_item ->> 'home_score', '')::integer,
        coalesce(nullif(v_item ->> 'status', ''), 'SCHEDULED'),
        coalesce((v_item ->> 'overtime')::boolean, false),
        coalesce((v_item ->> 'neutral_site')::boolean, false),
        v_item ->> 'note',
        v_item ->> 'source_checkpoint_id',
        coalesce(nullif(v_item ->> 'provenance', ''), p_source_label),
        case when coalesce(v_item ->> 'status', 'SCHEDULED') = 'FINAL' then v_now else null end,
        1
      )
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
        provenance = excluded.provenance,
        finalized_at = case when excluded.status = 'FINAL' then coalesce(public.cff_games.finalized_at, v_now) else null end,
        version = public.cff_games.version + 1;
      v_count := v_count + 1;
    end loop;
    v_result := jsonb_build_object('operation', v_operation, 'games_written', v_count);
    v_state_patch := coalesce(v_payload -> 'state_patch', '{}'::jsonb);

  elsif v_operation = 'upsert_schedule' then
    insert into public.archers_schedule (
      season, week, game_date, opponent_team_id, site, kickoff_time_ct, status,
      archers_score, opponent_score, note, source_checkpoint_id, version
    ) values (
      (v_payload ->> 'season')::integer,
      (v_payload ->> 'week')::integer,
      nullif(v_payload ->> 'game_date', '')::date,
      nullif(v_payload ->> 'opponent_team_id', ''),
      nullif(v_payload ->> 'site', ''),
      v_payload ->> 'kickoff_time_ct',
      coalesce(nullif(v_payload ->> 'status', ''), 'UPCOMING'),
      nullif(v_payload ->> 'archers_score', '')::integer,
      nullif(v_payload ->> 'opponent_score', '')::integer,
      v_payload ->> 'note',
      v_payload ->> 'source_checkpoint_id',
      1
    )
    on conflict (season, week) do update set
      game_date = excluded.game_date,
      opponent_team_id = excluded.opponent_team_id,
      site = excluded.site,
      kickoff_time_ct = excluded.kickoff_time_ct,
      status = excluded.status,
      archers_score = excluded.archers_score,
      opponent_score = excluded.opponent_score,
      note = excluded.note,
      source_checkpoint_id = excluded.source_checkpoint_id,
      version = public.archers_schedule.version + 1
    returning to_jsonb(public.archers_schedule.*) into v_result;
    v_state_patch := coalesce(v_payload -> 'state_patch', '{}'::jsonb);

  -- ---------------------------------------------------------------------------
  -- Live Game Day operations.
  -- ---------------------------------------------------------------------------
  elsif v_operation = 'start_game' then
    v_id := coalesce(nullif(p_resource_id, ''), nullif(v_payload ->> 'game_id', ''));
    if v_id is null then raise exception 'game_id is required'; end if;

    insert into public.cff_games (
      game_id, season, week, game_date, kickoff_label, away_team_id, home_team_id,
      status, overtime, neutral_site, note, provenance, version
    ) values (
      v_id, (v_payload ->> 'season')::integer,
      nullif(v_payload ->> 'week', '')::integer,
      nullif(v_payload ->> 'game_date', '')::date,
      v_payload ->> 'kickoff_label',
      v_payload ->> 'away_team_id', v_payload ->> 'home_team_id',
      'SCHEDULED', false, coalesce((v_payload ->> 'neutral_site')::boolean, false),
      v_payload ->> 'note', coalesce(v_payload ->> 'provenance', p_source_label), 1
    )
    on conflict (game_id) do nothing;

    select version into v_current_version from public.cff_live_games where game_id = v_id for update;
    if found and p_expected_version is null then
      raise exception 'expected_version is required when restarting or updating an existing live game';
    end if;
    if found and v_current_version <> p_expected_version then
      raise exception 'stale live game version';
    end if;

    insert into public.cff_live_games (
      game_id, season, week, away_team_id, home_team_id, away_score, home_score,
      quarter, clock_remaining, possession_team_id, field_position_label,
      down, distance, away_timeouts, home_timeouts, status, metadata,
      version, started_at
    ) values (
      v_id, (v_payload ->> 'season')::integer,
      nullif(v_payload ->> 'week', '')::integer,
      v_payload ->> 'away_team_id', v_payload ->> 'home_team_id',
      coalesce(nullif(v_payload ->> 'away_score', '')::integer, 0),
      coalesce(nullif(v_payload ->> 'home_score', '')::integer, 0),
      coalesce(nullif(v_payload ->> 'quarter', '')::integer, 0),
      v_payload ->> 'clock_remaining', nullif(v_payload ->> 'possession_team_id', ''),
      v_payload ->> 'field_position_label',
      nullif(v_payload ->> 'down', '')::integer,
      nullif(v_payload ->> 'distance', '')::integer,
      coalesce(nullif(v_payload ->> 'away_timeouts', '')::integer, 3),
      coalesce(nullif(v_payload ->> 'home_timeouts', '')::integer, 3),
      coalesce(nullif(v_payload ->> 'status', ''), 'PRE_GAME'),
      coalesce(v_payload -> 'metadata', '{}'::jsonb),
      1, v_now
    )
    on conflict (game_id) do update set
      away_score = excluded.away_score,
      home_score = excluded.home_score,
      quarter = excluded.quarter,
      clock_remaining = excluded.clock_remaining,
      possession_team_id = excluded.possession_team_id,
      field_position_label = excluded.field_position_label,
      down = excluded.down,
      distance = excluded.distance,
      away_timeouts = excluded.away_timeouts,
      home_timeouts = excluded.home_timeouts,
      status = excluded.status,
      metadata = excluded.metadata,
      version = public.cff_live_games.version + 1
    returning to_jsonb(public.cff_live_games.*) into v_result;
    v_state_patch := coalesce(v_payload -> 'state_patch', '{}'::jsonb);

  elsif v_operation = 'update_live_game' then
    v_id := coalesce(nullif(p_resource_id, ''), nullif(v_payload ->> 'game_id', ''));
    select * into v_live from public.cff_live_games where game_id = v_id for update;
    if not found then raise exception 'live game does not exist'; end if;
    if p_expected_version is null or v_live.version <> p_expected_version then
      raise exception 'stale or missing expected live game version; current %', v_live.version;
    end if;
    if v_live.status = 'FINAL' then raise exception 'finalized live game is locked'; end if;

    update public.cff_live_games
    set
      away_score = coalesce(nullif(v_payload ->> 'away_score', '')::integer, away_score),
      home_score = coalesce(nullif(v_payload ->> 'home_score', '')::integer, home_score),
      quarter = coalesce(nullif(v_payload ->> 'quarter', '')::integer, quarter),
      clock_remaining = coalesce(v_payload ->> 'clock_remaining', clock_remaining),
      possession_team_id = coalesce(nullif(v_payload ->> 'possession_team_id', ''), possession_team_id),
      field_position_label = coalesce(v_payload ->> 'field_position_label', field_position_label),
      down = coalesce(nullif(v_payload ->> 'down', '')::integer, down),
      distance = coalesce(nullif(v_payload ->> 'distance', '')::integer, distance),
      away_timeouts = coalesce(nullif(v_payload ->> 'away_timeouts', '')::integer, away_timeouts),
      home_timeouts = coalesce(nullif(v_payload ->> 'home_timeouts', '')::integer, home_timeouts),
      status = coalesce(nullif(v_payload ->> 'status', ''), status),
      metadata = public.archers_jsonb_deep_merge(metadata, coalesce(v_payload -> 'metadata_patch', '{}'::jsonb)),
      version = version + 1
    where game_id = v_id
    returning to_jsonb(public.cff_live_games.*) into v_result;
    v_state_patch := coalesce(v_payload -> 'state_patch', '{}'::jsonb);

  elsif v_operation = 'record_drive' then
    v_id := coalesce(nullif(p_resource_id, ''), nullif(v_payload ->> 'game_id', ''));
    select * into v_live from public.cff_live_games where game_id = v_id for update;
    if not found then raise exception 'live game does not exist'; end if;
    if p_expected_version is null or v_live.version <> p_expected_version then
      raise exception 'stale or missing expected live game version; current %', v_live.version;
    end if;
    if v_live.status = 'FINAL' then raise exception 'finalized live game is locked'; end if;

    if exists (
      select 1 from public.cff_game_drives
      where game_id = v_id and drive_number = (v_payload ->> 'drive_number')::integer
    ) and p_source_label <> 'CORRECTION' then
      raise exception 'drive number already exists; correction source required';
    end if;

    insert into public.cff_game_drives (
      game_id, drive_number, offense_team_id, defense_team_id,
      start_quarter, start_clock, start_field_position,
      end_quarter, end_clock, end_field_position,
      plays, yards, result, points, time_of_possession, summary,
      stats_delta, provenance, version, idempotency_key
    ) values (
      v_id, (v_payload ->> 'drive_number')::integer,
      v_payload ->> 'offense_team_id', v_payload ->> 'defense_team_id',
      nullif(v_payload ->> 'start_quarter', '')::integer,
      v_payload ->> 'start_clock', v_payload ->> 'start_field_position',
      nullif(v_payload ->> 'end_quarter', '')::integer,
      v_payload ->> 'end_clock', v_payload ->> 'end_field_position',
      nullif(v_payload ->> 'plays', '')::integer,
      nullif(v_payload ->> 'yards', '')::integer,
      v_payload ->> 'result',
      coalesce(nullif(v_payload ->> 'points', '')::integer, 0),
      v_payload ->> 'time_of_possession',
      coalesce(nullif(v_payload ->> 'summary', ''), p_summary),
      coalesce(v_payload -> 'stats_delta', '{}'::jsonb),
      coalesce(nullif(v_payload ->> 'provenance', ''), p_source_label),
      1, p_idempotency_key
    )
    on conflict (game_id, drive_number) do update set
      offense_team_id = excluded.offense_team_id,
      defense_team_id = excluded.defense_team_id,
      start_quarter = excluded.start_quarter,
      start_clock = excluded.start_clock,
      start_field_position = excluded.start_field_position,
      end_quarter = excluded.end_quarter,
      end_clock = excluded.end_clock,
      end_field_position = excluded.end_field_position,
      plays = excluded.plays,
      yards = excluded.yards,
      result = excluded.result,
      points = excluded.points,
      time_of_possession = excluded.time_of_possession,
      summary = excluded.summary,
      stats_delta = excluded.stats_delta,
      provenance = excluded.provenance,
      version = public.cff_game_drives.version + 1;

    update public.cff_live_games
    set
      away_score = coalesce(nullif(v_payload #>> '{live,away_score}', '')::integer, away_score),
      home_score = coalesce(nullif(v_payload #>> '{live,home_score}', '')::integer, home_score),
      quarter = coalesce(nullif(v_payload #>> '{live,quarter}', '')::integer, quarter),
      clock_remaining = coalesce(v_payload #>> '{live,clock_remaining}', clock_remaining),
      possession_team_id = coalesce(nullif(v_payload #>> '{live,possession_team_id}', ''), possession_team_id),
      field_position_label = coalesce(v_payload #>> '{live,field_position_label}', field_position_label),
      down = coalesce(nullif(v_payload #>> '{live,down}', '')::integer, down),
      distance = coalesce(nullif(v_payload #>> '{live,distance}', '')::integer, distance),
      away_timeouts = coalesce(nullif(v_payload #>> '{live,away_timeouts}', '')::integer, away_timeouts),
      home_timeouts = coalesce(nullif(v_payload #>> '{live,home_timeouts}', '')::integer, home_timeouts),
      status = coalesce(nullif(v_payload #>> '{live,status}', ''), status),
      version = version + 1
    where game_id = v_id
    returning jsonb_build_object(
      'drive', (select to_jsonb(d.*) from public.cff_game_drives d where d.game_id = v_id and d.drive_number = (v_payload ->> 'drive_number')::integer),
      'live_game', to_jsonb(public.cff_live_games.*)
    ) into v_result;
    v_state_patch := coalesce(v_payload -> 'state_patch', '{}'::jsonb);

  elsif v_operation = 'record_game_event' then
    v_id := coalesce(nullif(p_resource_id, ''), nullif(v_payload ->> 'game_id', ''));
    select * into v_live from public.cff_live_games where game_id = v_id for update;
    if not found then raise exception 'live game does not exist'; end if;
    if p_expected_version is null or v_live.version <> p_expected_version then
      raise exception 'stale or missing expected live game version; current %', v_live.version;
    end if;
    if v_live.status = 'FINAL' then raise exception 'finalized live game is locked'; end if;

    insert into public.cff_game_events (
      game_id, drive_number, sequence_number, event_type, team_id, player_id,
      quarter, clock_remaining, summary, data, provenance, idempotency_key
    ) values (
      v_id,
      nullif(v_payload ->> 'drive_number', '')::integer,
      nullif(v_payload ->> 'sequence_number', '')::integer,
      v_payload ->> 'event_type',
      nullif(v_payload ->> 'team_id', ''),
      nullif(v_payload ->> 'player_id', ''),
      nullif(v_payload ->> 'quarter', '')::integer,
      v_payload ->> 'clock_remaining',
      coalesce(nullif(v_payload ->> 'summary', ''), p_summary),
      coalesce(v_payload -> 'data', '{}'::jsonb),
      coalesce(nullif(v_payload ->> 'provenance', ''), p_source_label),
      p_idempotency_key
    ) returning to_jsonb(public.cff_game_events.*) into v_result;

    update public.cff_live_games
    set
      away_score = coalesce(nullif(v_payload #>> '{live,away_score}', '')::integer, away_score),
      home_score = coalesce(nullif(v_payload #>> '{live,home_score}', '')::integer, home_score),
      quarter = coalesce(nullif(v_payload #>> '{live,quarter}', '')::integer, quarter),
      clock_remaining = coalesce(v_payload #>> '{live,clock_remaining}', clock_remaining),
      possession_team_id = coalesce(nullif(v_payload #>> '{live,possession_team_id}', ''), possession_team_id),
      status = coalesce(nullif(v_payload #>> '{live,status}', ''), status),
      version = version + 1
    where game_id = v_id;
    v_result := jsonb_build_object(
      'event', v_result,
      'live_game', (select to_jsonb(l.*) from public.cff_live_games l where l.game_id = v_id)
    );
    v_state_patch := coalesce(v_payload -> 'state_patch', '{}'::jsonb);

  elsif v_operation = 'upsert_team_stats' then
    v_id := coalesce(nullif(p_resource_id, ''), nullif(v_payload ->> 'game_id', ''));
    insert into public.cff_game_team_stats (
      game_id, team_id, stats, reconciliation_status, version
    ) values (
      v_id, v_payload ->> 'team_id',
      coalesce(v_payload -> 'stats', '{}'::jsonb),
      coalesce(nullif(v_payload ->> 'reconciliation_status', ''), 'IN_PROGRESS'), 1
    )
    on conflict (game_id, team_id) do update set
      stats = excluded.stats,
      reconciliation_status = excluded.reconciliation_status,
      version = public.cff_game_team_stats.version + 1
    returning to_jsonb(public.cff_game_team_stats.*) into v_result;
    v_state_patch := coalesce(v_payload -> 'state_patch', '{}'::jsonb);

  elsif v_operation = 'upsert_player_stats' then
    v_id := coalesce(nullif(p_resource_id, ''), nullif(v_payload ->> 'game_id', ''));
    insert into public.cff_game_player_stats (
      game_id, team_id, player_id, player_name, position,
      stats, reconciliation_status, version
    ) values (
      v_id, v_payload ->> 'team_id', v_payload ->> 'player_id',
      v_payload ->> 'player_name', v_payload ->> 'position',
      coalesce(v_payload -> 'stats', '{}'::jsonb),
      coalesce(nullif(v_payload ->> 'reconciliation_status', ''), 'IN_PROGRESS'), 1
    )
    on conflict (game_id, team_id, player_id) do update set
      player_name = excluded.player_name,
      position = excluded.position,
      stats = excluded.stats,
      reconciliation_status = excluded.reconciliation_status,
      version = public.cff_game_player_stats.version + 1
    returning to_jsonb(public.cff_game_player_stats.*) into v_result;
    v_state_patch := coalesce(v_payload -> 'state_patch', '{}'::jsonb);

  elsif v_operation = 'finalize_game' then
    v_id := coalesce(nullif(p_resource_id, ''), nullif(v_payload ->> 'game_id', ''));
    select * into v_live from public.cff_live_games where game_id = v_id for update;
    if not found then raise exception 'live game does not exist'; end if;
    if p_expected_version is null or v_live.version <> p_expected_version then
      raise exception 'stale or missing expected live game version; current %', v_live.version;
    end if;
    if v_live.status = 'FINAL' then raise exception 'game is already finalized'; end if;

    update public.cff_games
    set away_score = v_live.away_score,
        home_score = v_live.home_score,
        status = 'FINAL',
        overtime = coalesce((v_payload ->> 'overtime')::boolean, overtime),
        note = coalesce(v_payload ->> 'note', note),
        provenance = coalesce(nullif(v_payload ->> 'provenance', ''), provenance),
        finalized_at = v_now,
        version = version + 1
    where game_id = v_id;

    if v_live.away_team_id = 'stl' or v_live.home_team_id = 'stl' then
      if v_live.away_team_id = 'stl' then
        v_archers_score := v_live.away_score;
        v_opponent_score := v_live.home_score;
        v_opponent_id := v_live.home_team_id;
        v_site := case when coalesce((select neutral_site from public.cff_games where game_id = v_id), false) then 'Neutral' else 'Away' end;
      else
        v_archers_score := v_live.home_score;
        v_opponent_score := v_live.away_score;
        v_opponent_id := v_live.away_team_id;
        v_site := case when coalesce((select neutral_site from public.cff_games where game_id = v_id), false) then 'Neutral' else 'Home' end;
      end if;

      insert into public.archers_schedule (
        season, week, game_date, opponent_team_id, site, kickoff_time_ct,
        status, archers_score, opponent_score, note, source_checkpoint_id, version
      )
      select
        g.season, g.week, g.game_date, v_opponent_id, v_site, null,
        'FINAL', v_archers_score, v_opponent_score,
        coalesce(v_payload ->> 'schedule_note', g.note), g.source_checkpoint_id, 1
      from public.cff_games g where g.game_id = v_id
      on conflict (season, week) do update set
        opponent_team_id = excluded.opponent_team_id,
        site = excluded.site,
        status = 'FINAL',
        archers_score = excluded.archers_score,
        opponent_score = excluded.opponent_score,
        note = excluded.note,
        version = public.archers_schedule.version + 1;
    end if;

    update public.cff_live_games
    set status = 'FINAL', finalized_at = v_now, version = version + 1
    where game_id = v_id
    returning to_jsonb(public.cff_live_games.*) into v_result;

    v_state_patch := coalesce(v_payload -> 'state_patch', '{}'::jsonb);

    if v_live.away_team_id = 'stl' or v_live.home_team_id = 'stl' then
      select * into v_standing
      from public.cff_standings
      where season = v_live.season and team_id = 'stl';

      if found then
        v_state_patch := public.archers_jsonb_deep_merge(
          v_state_patch,
          jsonb_build_object(
            'franchise', jsonb_build_object(
              'record', jsonb_build_object(
                'wins', v_standing.wins,
                'losses', v_standing.losses,
                'ties', v_standing.ties,
                'division_wins', v_standing.division_wins,
                'division_losses', v_standing.division_losses,
                'division_ties', v_standing.division_ties,
                'conference_wins', v_standing.conference_wins,
                'conference_losses', v_standing.conference_losses,
                'conference_ties', v_standing.conference_ties,
                'points_for', v_standing.points_for,
                'points_against', v_standing.points_against,
                'point_differential', v_standing.point_differential,
                'division_rank', v_standing.division_rank,
                'conference_rank', v_standing.conference_rank,
                'central_position', 'Central Division rank ' || v_standing.division_rank::text
              )
            ),
            'game_day', jsonb_build_object(
              'last_finalized_game_id', v_id,
              'status', 'FINAL',
              'final_score', jsonb_build_object(
                'archers', v_archers_score,
                'opponent', v_opponent_score,
                'opponent_team_id', v_opponent_id
              )
            )
          )
        );
      end if;
    end if;

  elsif v_operation = 'create_snapshot' then
    select * into v_state_row from public.archers_franchise_state where id = 'stl-2026' for update;
    insert into public.archers_state_snapshots (franchise_id, state_version, state, reason)
    values ('stl-2026', v_state_row.version, v_state_row.state, p_summary)
    returning to_jsonb(public.archers_state_snapshots.*) into v_result;
    v_state_patch := '{}'::jsonb;

  else
    raise exception 'unsupported operation: %', v_operation;
  end if;

  -- ---------------------------------------------------------------------------
  -- Every successful operational write advances the global canon version and
  -- records one transparent event. This keeps structured tables and canon aligned.
  -- ---------------------------------------------------------------------------

  select * into v_state_row
  from public.archers_franchise_state
  where id = 'stl-2026'
  for update;

  if not found then raise exception 'Archers franchise state has not been initialized'; end if;

  if v_expected_state_version is not null and v_state_row.version <> v_expected_state_version then
    raise exception 'stale franchise state: expected %, current %', v_expected_state_version, v_state_row.version;
  end if;

  v_state_patch := public.archers_jsonb_deep_merge(
    coalesce(v_state_patch, '{}'::jsonb),
    jsonb_build_object(
      'canon', jsonb_build_object(
        'last_operation', jsonb_build_object(
          'operation', v_operation,
          'resource_type', p_resource_type,
          'resource_id', p_resource_id,
          'idempotency_key', p_idempotency_key,
          'source_label', p_source_label,
          'completed_at', v_now
        )
      )
    )
  );

  v_merged_state := public.archers_jsonb_deep_merge(v_state_row.state, v_state_patch);
  v_merged_state := jsonb_set(v_merged_state, '{franchise,team}', to_jsonb('St. Louis Archers'::text), true);
  v_merged_state := jsonb_set(v_merged_state, '{franchise,owner_and_general_manager}', to_jsonb('Kevin Dorey'::text), true);
  v_merged_state := jsonb_set(v_merged_state, '{canon,kevin_lock,enabled}', 'true'::jsonb, true);

  update public.archers_franchise_state
  set version = version + 1, state = v_merged_state
  where id = 'stl-2026'
  returning version into v_new_state_version;

  insert into public.archers_canon_events (
    franchise_id, state_version, event_type, summary,
    exact_kevin_text, source_label, payload
  ) values (
    'stl-2026', v_new_state_version, v_event_type, trim(p_summary),
    nullif(p_exact_kevin_text, ''), p_source_label,
    jsonb_build_object(
      'operation', v_operation,
      'resource_type', p_resource_type,
      'resource_id', p_resource_id,
      'payload', v_payload,
      'result', v_result
    )
  ) returning event_id into v_event_id;

  v_result := jsonb_build_object(
    'operation', v_operation,
    'resource_type', p_resource_type,
    'resource_id', p_resource_id,
    'state_version', v_new_state_version,
    'event_id', v_event_id,
    'result', v_result,
    'idempotent_replay', false
  );

  insert into public.archers_operation_log (
    idempotency_key, operation, resource_type, resource_id,
    expected_version, request_payload, result_payload, summary,
    source_label, exact_kevin_text, state_version, status
  ) values (
    p_idempotency_key, v_operation, p_resource_type, p_resource_id,
    p_expected_version, v_payload, v_result, trim(p_summary),
    p_source_label, nullif(p_exact_kevin_text, ''), v_new_state_version, 'SUCCESS'
  );

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Security: browser reads only operational display data. All writes remain service-role only.
-- -----------------------------------------------------------------------------

alter table public.archers_resources enable row level security;
alter table public.cff_live_games enable row level security;
alter table public.cff_game_drives enable row level security;
alter table public.cff_game_events enable row level security;
alter table public.cff_game_team_stats enable row level security;
alter table public.cff_game_player_stats enable row level security;
alter table public.archers_operation_log enable row level security;
alter table public.archers_state_snapshots enable row level security;

revoke all on table public.archers_resources from anon, authenticated;
revoke all on table public.cff_live_games from anon, authenticated;
revoke all on table public.cff_game_drives from anon, authenticated;
revoke all on table public.cff_game_events from anon, authenticated;
revoke all on table public.cff_game_team_stats from anon, authenticated;
revoke all on table public.cff_game_player_stats from anon, authenticated;
revoke all on table public.archers_operation_log from anon, authenticated;
revoke all on table public.archers_state_snapshots from anon, authenticated;
revoke all on function public.archers_execute_operation(text, text, text, jsonb, integer, text, text, text, text)
  from public, anon, authenticated;

grant select, insert, update on table public.archers_resources to service_role;
grant select, insert, update on table public.cff_live_games to service_role;
grant select, insert, update on table public.cff_game_drives to service_role;
grant select, insert on table public.cff_game_events to service_role;
grant select, insert, update on table public.cff_game_team_stats to service_role;
grant select, insert, update on table public.cff_game_player_stats to service_role;
grant select, insert on table public.archers_operation_log to service_role;
grant select, insert on table public.archers_state_snapshots to service_role;
grant usage, select on sequence public.cff_game_events_event_id_seq to service_role;
grant usage, select on sequence public.archers_operation_log_operation_id_seq to service_role;
grant usage, select on sequence public.archers_state_snapshots_snapshot_id_seq to service_role;
grant execute on function public.archers_execute_operation(text, text, text, jsonb, integer, text, text, text, text)
  to service_role;

grant select on table public.archers_resources to anon;
grant select on table public.cff_live_games to anon;
grant select on table public.cff_game_drives to anon;
grant select on table public.cff_game_events to anon;
grant select on table public.cff_game_team_stats to anon;
grant select on table public.cff_game_player_stats to anon;

drop policy if exists "Console reads visible Archers resources" on public.archers_resources;
create policy "Console reads visible Archers resources"
on public.archers_resources for select to anon
using (franchise_id = 'stl-2026' and visibility = 'CONSOLE' and status = 'ACTIVE');

drop policy if exists "Console reads live games" on public.cff_live_games;
create policy "Console reads live games"
on public.cff_live_games for select to anon using (true);

drop policy if exists "Console reads game drives" on public.cff_game_drives;
create policy "Console reads game drives"
on public.cff_game_drives for select to anon using (true);

drop policy if exists "Console reads game events" on public.cff_game_events;
create policy "Console reads game events"
on public.cff_game_events for select to anon using (true);

drop policy if exists "Console reads team game stats" on public.cff_game_team_stats;
create policy "Console reads team game stats"
on public.cff_game_team_stats for select to anon using (true);

drop policy if exists "Console reads player game stats" on public.cff_game_player_stats;
create policy "Console reads player game stats"
on public.cff_game_player_stats for select to anon using (true);

-- Realtime publication for display-facing tables.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'archers_resources',
    'cff_live_games',
    'cff_game_drives',
    'cff_game_events',
    'cff_game_team_stats',
    'cff_game_player_stats'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end
$$;

-- Mark the backend phase in operational state without pretending deployment succeeded
-- until this transaction reaches its end.
select *
from public.apply_archers_state_update(
  jsonb_build_object(
    'canon', jsonb_build_object(
      'operations_backend', jsonb_build_object(
        'version', '3.0',
        'status', 'INSTALLED',
        'capabilities', jsonb_build_array(
          'FRANCHISE_STATE', 'TEAMS', 'LEAGUE_GAMES', 'SCHEDULE',
          'GENERIC_RESOURCES', 'LIVE_GAME', 'DRIVES', 'GAME_EVENTS',
          'TEAM_STATS', 'PLAYER_STATS', 'FINALIZATION', 'SNAPSHOTS',
          'VERSION_CHECKS', 'IDEMPOTENCY', 'AUDIT_LOG'
        )
      )
    )
  ),
  'system',
  'Installed the unified Phase Three franchise, league, resource, and live game operations backend.',
  null,
  'SYSTEM'
);

commit;