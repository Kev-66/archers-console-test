from pathlib import Path

canonical = Path("edge-function-archers-franchise.ts")
text = canonical.read_text(encoding="utf-8")

def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)

replace_once(
    'const BACKEND_VERSION = "3.2.0";',
    'const BACKEND_VERSION = "3.3.0";',
    "backend version",
)
replace_once(
    '  "update_decision",\n  "upsert_resource",',
    '  "update_decision",\n  "rollover_season",\n  "upsert_resource",',
    "write operation allowlist",
)
replace_once(
    '            write_features: [\n              "ATOMIC_DECISION_UPDATE",\n            ],',
    '            write_features: [\n              "ATOMIC_DECISION_UPDATE",\n              "ATOMIC_SEASON_ROLLOVER",\n              "PLAYER_AND_STAFF_CONTRACT_ROLLOVER",\n            ],',
    "write features",
)
replace_once(
    '              "DECISION_IDENTITY_PRESERVATION",\n              "IDEMPOTENCY",',
    '              "DECISION_IDENTITY_PRESERVATION",\n              "CONTRACT_RESOURCE_FINGERPRINT",\n              "DRY_RUN_REQUIRED_FOR_SEASON_ROLLOVER",\n              "NO_AUTOMATIC_OPTION_EXERCISE",\n              "IDEMPOTENCY",',
    "rollover safeguards",
)

rollover_branch = r'''
        if (operation === "rollover_season") {
const suppliedIdempotencyKey =
  typeof body.idempotency_key === "string" &&
    body.idempotency_key.trim().length > 0;
if (!suppliedIdempotencyKey) {
  return jsonResponse(
    { error: "idempotency_key is required for rollover_season" },
    400,
  );
}

const resourceType = typeof body.resource_type === "string"
  ? body.resource_type.trim().toLowerCase()
  : "";
const resourceId = typeof body.resource_id === "string"
  ? body.resource_id.trim()
  : "";

if (
  resourceType !== "season_rollover" ||
  resourceId !== "season-rollover"
) {
  return jsonResponse(
    {
      error:
        "rollover_season requires resource_type season_rollover and resource_id season-rollover",
    },
    400,
  );
}

if (expectedStateVersion === null) {
  return jsonResponse(
    {
      error:
        "expected_state_version is required for rollover_season",
    },
    400,
  );
}

const fromSeason = Number(payload.from_season);
const toSeason = Number(payload.to_season);
if (
  !Number.isInteger(fromSeason) ||
  !Number.isInteger(toSeason) ||
  fromSeason < 1 ||
  toSeason !== fromSeason + 1
) {
  return jsonResponse(
    {
      error:
        "payload.from_season and payload.to_season must advance exactly one positive-integer season",
    },
    400,
  );
}

const { data, error } = await supabase.rpc(
  "archers_rollover_season",
  {
    p_resource_type: "season_rollover",
    p_resource_id: "season-rollover",
    p_payload: payload,
    p_expected_state_version: expectedStateVersion,
    p_idempotency_key: idempotencyKey,
    p_summary: summary.trim(),
    p_source_label: sourceLabel,
    p_exact_kevin_text: exactKevinText,
    p_dry_run: body.dry_run === true,
  },
);

if (error) {
  return errorResponse(
    error,
    "Atomic season rollover failed",
    409,
  );
}

return jsonResponse(data);
        }

'''
replace_once(
    '        if (operation === "update_decision") {',
    rollover_branch + '        if (operation === "update_decision") {',
    "rollover operation route",
)

old_refs = r'''  const selectedRefs = selectedDecision ? decisionResourceRefs(selectedDecision) : [];
  const additionalRefs = selectedRefs.filter((ref) =>
    !(ref.resource_type === targetRef.resource_type && ref.resource_id === targetRef.resource_id)
  );
  const additionalRows = await Promise.all(
    additionalRefs.map((ref) => readExactResource(supabase, ref, true)),
  );
'''
new_refs = r'''  const selectedRefs = selectedDecision ? decisionResourceRefs(selectedDecision) : [];
  const loggedAffectedEntries =
    isPlainObject(operation.result_payload) &&
      Array.isArray(operation.result_payload.affected_resource_versions)
      ? operation.result_payload.affected_resource_versions.filter(isPlainObject)
      : [];
  const additionalRefMap = new Map<string, { resource_type: string; resource_id: string }>();
  for (const ref of [...selectedRefs, ...loggedAffectedEntries]) {
    const resourceType = String(ref.resource_type ?? "").trim();
    const resourceId = String(ref.resource_id ?? "").trim();
    if (!resourceType || !resourceId) continue;
    if (resourceType === targetRef.resource_type && resourceId === targetRef.resource_id) continue;
    additionalRefMap.set(`${resourceType}/${resourceId}`, {
      resource_type: resourceType,
      resource_id: resourceId,
    });
  }
  const additionalRefs = [...additionalRefMap.values()].slice(0, 250);
  const additionalRows = await Promise.all(
    additionalRefs.map((ref) => readExactResource(supabase, ref, true)),
  );
'''
replace_once(old_refs, new_refs, "operation verification affected refs")

replace_once(
    '  const affectedResources = [...affectedResourceMap.values()];\n\n  const targetIsDecisionQueue =',
    '''  const affectedResources = [...affectedResourceMap.values()];
  const loggedVersionExpectations = new Map<string, number>();
  for (const entry of loggedAffectedEntries) {
    const resourceType = String(entry.resource_type ?? "").trim();
    const resourceId = String(entry.resource_id ?? "").trim();
    const version = Number(entry.version);
    if (resourceType && resourceId && Number.isInteger(version)) {
      loggedVersionExpectations.set(`${resourceType}/${resourceId}`, version);
    }
  }
  const affectedResourceVersionsVerified =
    loggedVersionExpectations.size === 0 ||
    [...loggedVersionExpectations.entries()].every(([key, expectedVersion]) => {
      const current = affectedResourceMap.get(key);
      return current && Number(current.version) >= expectedVersion;
    });

  const targetIsDecisionQueue =''',
    "affected version verification",
)
replace_once(
    '    verified: stateReached && canonEvents.length > 0,',
    '    verified: stateReached && canonEvents.length > 0 && affectedResourceVersionsVerified,',
    "verification result",
)
replace_once(
    '    affected_resource_versions_deduplicated: true,\n    unresolved_issues_evaluation:',
    '    affected_resource_versions_deduplicated: true,\n    affected_resource_versions_verified: affectedResourceVersionsVerified,\n    logged_affected_resource_count: loggedVersionExpectations.size,\n    unresolved_issues_evaluation:',
    "verification metadata",
)

canonical.write_text(text, encoding="utf-8")
Path("archers-franchise-index-v3.3.0.ts").write_text(text, encoding="utf-8")

league = Path("DAD_LEAGUE_AND_RESOURCE_RULES.md")
league_text = league.read_text(encoding="utf-8")
marker = "## 13. Season rollover"
if marker not in league_text:
    league_text += r'''

## 13. Season rollover

Season rollover is a protected league-year transition. Consult the current capabilities and use `rollover_season` only when advertised.

Before execution:

- Read the current global state version and authoritative current season.
- Run `rollover_season` with `dry_run: true`.
- Review every player and staff contract blocker, warning, expiration, final-year flag, salary change, cap change, and option due.
- Normalize legacy contract summaries instead of inferring future terms.
- Obtain Kevin approval for the actual offseason transition.
- Execute with the exact `expected_resources` fingerprint from the current dry run and a new idempotency key.
- Verify the resulting operation, canon event, state version, and every affected resource version.

Rollover advances exactly one season. It may derive remaining years, select established year-specific compensation, and flag expiration or options. It must not exercise an option, renew or terminate a contract, release or sign a player, hire or fire staff, restructure compensation, or make any other discretionary personnel decision.
'''
    league.write_text(league_text, encoding="utf-8")

print("Backend 3.3.0 sources materialized")
