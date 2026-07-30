from pathlib import Path

# One-time branch hardening. The workflow removes this file after applying it.


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: {label}: expected exactly one match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


sql = Path("phase3-3-season-rollover-v1.sql")
replace_once(
    sql,
    """  v_expected_resources jsonb;
  v_expected_count integer := 0;
""",
    """  v_expected_resources jsonb;
  v_expected_resources_supplied boolean := false;
  v_expected_count integer := 0;
  v_expected_unique_count integer := 0;
""",
    "fingerprint declarations",
)
replace_once(
    sql,
    """  v_expected_resources := coalesce(v_payload -> 'expected_resources', '[]'::jsonb);
  if jsonb_typeof(v_expected_resources) is distinct from 'array' then
""",
    """  v_expected_resources_supplied := v_payload ? 'expected_resources';
  v_expected_resources := coalesce(v_payload -> 'expected_resources', '[]'::jsonb);
  if jsonb_typeof(v_expected_resources) is distinct from 'array' then
""",
    "fingerprint presence",
)
replace_once(
    sql,
    """  if not p_dry_run then
    if v_expected_count = 0 and v_processable_count > 0 then
      raise exception 'payload.expected_resources from a current dry run is required';
    end if;

    if v_expected_count <> v_processable_count then
      raise exception 'contract set changed since dry run: expected % resources, current %',
        v_expected_count, v_processable_count;
    end if;

    for v_expected_entry in select value from jsonb_array_elements(v_expected_resources)
    loop
      if jsonb_typeof(v_expected_entry) is distinct from 'object' then
        raise exception 'every expected_resources entry must be an object';
      end if;
      begin
        v_expected_version := (v_expected_entry ->> 'version')::integer;
      exception when others then
        raise exception 'expected_resources.version must be an integer';
      end;

      select count(*)
      into v_matching_expected
      from jsonb_array_elements(v_expected_actual) as actual(value)
      where value ->> 'resource_type' = v_expected_entry ->> 'resource_type'
        and value ->> 'resource_id' = v_expected_entry ->> 'resource_id'
        and (value ->> 'version')::integer = v_expected_version;

      if v_matching_expected <> 1 then
        raise exception 'stale or unknown contract resource in expected_resources: %/% version %',
          v_expected_entry ->> 'resource_type',
          v_expected_entry ->> 'resource_id',
          v_expected_version;
      end if;
    end loop;
  end if;
""",
    """  if not p_dry_run then
    if not v_expected_resources_supplied then
      raise exception 'payload.expected_resources from a current dry run is required';
    end if;

    if v_expected_count <> v_processable_count then
      raise exception 'contract set changed since dry run: expected % resources, current %',
        v_expected_count, v_processable_count;
    end if;

    for v_expected_entry in select value from jsonb_array_elements(v_expected_resources)
    loop
      if jsonb_typeof(v_expected_entry) is distinct from 'object' then
        raise exception 'every expected_resources entry must be an object';
      end if;

      if nullif(trim(v_expected_entry ->> 'resource_type'), '') is null
         or nullif(trim(v_expected_entry ->> 'resource_id'), '') is null then
        raise exception 'every expected_resources entry requires resource_type and resource_id';
      end if;

      begin
        v_expected_version := (v_expected_entry ->> 'version')::integer;
      exception when others then
        raise exception 'expected_resources.version must be an integer';
      end;

      if v_expected_version < 1 then
        raise exception 'expected_resources.version must be positive';
      end if;

      select count(*)
      into v_matching_expected
      from jsonb_array_elements(v_expected_actual) as actual(value)
      where value ->> 'resource_type' = v_expected_entry ->> 'resource_type'
        and value ->> 'resource_id' = v_expected_entry ->> 'resource_id'
        and (value ->> 'version')::integer = v_expected_version;

      if v_matching_expected <> 1 then
        raise exception 'stale or unknown contract resource in expected_resources: %/% version %',
          v_expected_entry ->> 'resource_type',
          v_expected_entry ->> 'resource_id',
          v_expected_version;
      end if;
    end loop;

    select count(*)
    into v_expected_unique_count
    from (
      select distinct
        value ->> 'resource_type' as resource_type,
        value ->> 'resource_id' as resource_id
      from jsonb_array_elements(v_expected_resources) as expected(value)
    ) as unique_expected;

    if v_expected_unique_count <> v_expected_count then
      raise exception 'payload.expected_resources contains duplicate resource identities';
    end if;
  end if;
""",
    "strict fingerprint validation",
)

regressions = Path("tests/backend-3.3.0/season-rollover-v1.sql")
duplicate_test = r'''-- A fingerprint cannot duplicate one valid resource while omitting another.
do $$
declare
  v_expected jsonb := (select result -> 'expected_resources' from rollover_preview);
  v_duplicate jsonb;
  v_failed boolean := false;
  v_state_before integer := (select version from public.archers_franchise_state where id = 'stl-2026');
begin
  if jsonb_array_length(v_expected) < 2 then
    raise exception 'duplicate fingerprint regression requires at least two contracts';
  end if;

  v_duplicate :=
    (v_expected - (jsonb_array_length(v_expected) - 1)) ||
    jsonb_build_array(v_expected -> 0);

  begin
    perform public.archers_rollover_season(
      'season_rollover',
      'season-rollover',
      jsonb_build_object(
        'from_season', 2026,
        'to_season', 2027,
        'strict', true,
        'expected_resources', v_duplicate
      ),
      (select (result ->> 'current_state_version')::integer from rollover_preview),
      'rollover-v1-duplicate-fingerprint',
      'Reject duplicate rollover fingerprint',
      'SYSTEM',
      null,
      false
    );
  exception when others then
    if position('duplicate resource identities' in sqlerrm) = 0 then
      raise;
    end if;
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'duplicate fingerprint unexpectedly succeeded';
  end if;
  if (select version from public.archers_franchise_state where id = 'stl-2026') <> v_state_before then
    raise exception 'duplicate fingerprint changed state';
  end if;
  if exists (
    select 1 from public.archers_operation_log
    where idempotency_key = 'rollover-v1-duplicate-fingerprint'
  ) then
    raise exception 'duplicate fingerprint wrote an operation log';
  end if;
end;
$$;

'''
replace_once(
    regressions,
    "create temporary table rollover_execution as\n",
    duplicate_test + "create temporary table rollover_execution as\n",
    "duplicate fingerprint regression",
)

edge = Path("edge-function-archers-franchise.ts")
exact_resource_function = r'''async function readExactResource(
  supabase: SupabaseClient,
  ref: ContextResourceRef,
  includeArchived = false,
) {
  let query = supabase
    .from("archers_resources")
    .select(
      "franchise_id, resource_type, resource_id, season, status, visibility, version, data, created_at, updated_at",
    )
    .eq("franchise_id", FRANCHISE_ID)
    .eq("resource_type", ref.resource_type)
    .eq("resource_id", ref.resource_id);

  if (!includeArchived) {
    query = query.eq("status", "ACTIVE");
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ?? null;
}
'''
batch_helper = exact_resource_function + r'''

async function readResourceRefsBatched(
  supabase: SupabaseClient,
  refs: ContextResourceRef[],
  includeArchived = false,
) {
  const grouped = new Map<string, Set<string>>();
  for (const ref of refs) {
    const resourceType = String(ref.resource_type ?? "").trim();
    const resourceId = String(ref.resource_id ?? "").trim();
    if (!resourceType || !resourceId) continue;
    const ids = grouped.get(resourceType) ?? new Set<string>();
    ids.add(resourceId);
    grouped.set(resourceType, ids);
  }

  const rows: Record<string, unknown>[] = [];
  const batchSize = 100;
  for (const [resourceType, idSet] of grouped.entries()) {
    const ids = [...idSet];
    for (let offset = 0; offset < ids.length; offset += batchSize) {
      const batch = ids.slice(offset, offset + batchSize);
      let query = supabase
        .from("archers_resources")
        .select(
          "franchise_id, resource_type, resource_id, season, status, visibility, version, data, created_at, updated_at",
        )
        .eq("franchise_id", FRANCHISE_ID)
        .eq("resource_type", resourceType)
        .in("resource_id", batch);

      if (!includeArchived) {
        query = query.eq("status", "ACTIVE");
      }

      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data ?? []));
    }
  }

  return rows;
}
'''
replace_once(edge, exact_resource_function, batch_helper, "batched resource helper")
replace_once(
    edge,
    r'''  const additionalRefs = [...additionalRefMap.values()].slice(0, 250);
  const additionalRows = await Promise.all(
    additionalRefs.map((ref) => readExactResource(supabase, ref, true)),
  );
''',
    r'''  const additionalRefs = [...additionalRefMap.values()];
  const additionalRows = await readResourceRefsBatched(
    supabase,
    additionalRefs,
    true,
  );
''',
    "remove verification ceiling",
)
replace_once(
    edge,
    """  const affectedResources = [...affectedResourceMap.values()];
  const loggedVersionExpectations = new Map<string, number>();
""",
    """  const affectedResources = [...affectedResourceMap.values()];
  const affectedResourceSample = affectedResources.slice(0, 250);
  const loggedVersionExpectations = new Map<string, number>();
""",
    "verification response sample",
)
replace_once(
    edge,
    """    affected_resource_versions: affectedResources,
    affected_resource_versions_deduplicated: true,
    affected_resource_versions_verified: affectedResourceVersionsVerified,
    logged_affected_resource_count: loggedVersionExpectations.size,
""",
    """    affected_resource_versions: affectedResourceSample,
    affected_resource_versions_deduplicated: true,
    affected_resource_versions_verified: affectedResourceVersionsVerified,
    affected_resource_versions_total: affectedResources.length,
    affected_resource_versions_returned: affectedResourceSample.length,
    affected_resource_versions_truncated:
      affectedResourceSample.length < affectedResources.length,
    logged_affected_resource_count: loggedVersionExpectations.size,
""",
    "bounded verification response",
)
Path("archers-franchise-index-v3.3.0.ts").write_text(
    edge.read_text(encoding="utf-8"),
    encoding="utf-8",
)

ci = Path(".github/workflows/backend-3.3.0-ci.yml")
replace_once(
    ci,
    """              'affected_resource_versions_verified',
          ]
""",
    """              'affected_resource_versions_verified',
              'readResourceRefsBatched',
              'affected_resource_versions_truncated',
          ]
""",
    "edge scale tokens",
)
replace_once(
    ci,
    """          for token in required:
              assert token in text, token

          print("edge_source_sha256=" + hashlib.sha256(versioned).hexdigest())
""",
    """          for token in required:
              assert token in text, token
          assert '.slice(0, 250);\\n  const additionalRows' not in text

          print("edge_source_sha256=" + hashlib.sha256(versioned).hexdigest())
""",
    "ceiling absence check",
)

readme = Path("tests/backend-3.3.0/README.md")
readme_text = readme.read_text(encoding="utf-8")
if "duplicate contract-resource identity rejection" not in readme_text:
    readme_text = readme_text.replace(
        "- stale contract-resource fingerprint rejection;\n",
        "- stale contract-resource fingerprint rejection;\n- duplicate contract-resource identity rejection;\n",
    )
    readme.write_text(readme_text, encoding="utf-8")

design = Path("SEASON_ROLLOVER_ENGINE_V1_DESIGN.md")
design_text = design.read_text(encoding="utf-8")
if "## Scale-safe verification" not in design_text:
    design_text += r'''

## Scale-safe verification

The execution fingerprint must contain each contract resource identity exactly once. Duplicate identities are rejected, preventing one valid resource from being repeated while another is omitted.

Operation verification reloads every logged affected resource in bounded database batches. It verifies the full set, while returning at most 250 resource summaries plus total, returned, and truncation metadata so Action responses remain bounded as the league grows.
'''
    design.write_text(design_text, encoding="utf-8")

print("Season Rollover Engine v1 hardening applied")
