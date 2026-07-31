from pathlib import Path

SOURCE = Path("archers-franchise-index-v3.3.0.ts")
VERSIONED = Path("archers-franchise-index-v3.4.0.ts")
CANONICAL = Path("edge-function-archers-franchise.ts")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


text = SOURCE.read_text(encoding="utf-8")
text = replace_once(
    text,
    'const BACKEND_VERSION = "3.3.0";',
    'const BACKEND_VERSION = "3.4.0";',
    "backend version",
)
text = replace_once(
    text,
    '  "rollover_season",\n',
    '  "rollover_season",\n  "validate_contract_intake",\n',
    "validation operation allowlist",
)
text = replace_once(
    text,
    ']);\n\ntype SupabaseClient = ReturnType<typeof createClient>;',
    ']);\n\nconst CONTRACT_GUARDED_RESOURCE_TYPES = new Set([\n'
    '  "player",\n'
    '  "staff",\n'
    '  "player_contract",\n'
    '  "staff_contract",\n'
    '  "contract",\n'
    ']);\n\ntype SupabaseClient = ReturnType<typeof createClient>;',
    "guarded resource types",
)
text = replace_once(
    text,
    '              "PLAYER_AND_STAFF_CONTRACT_ROLLOVER",\n',
    '              "PLAYER_AND_STAFF_CONTRACT_ROLLOVER",\n'
    '              "CONTRACT_INTAKE_VALIDATION",\n'
    '              "DATABASE_CONTRACT_INTAKE_GUARD",\n'
    '              "CANONICAL_CONTRACT_DERIVATION",\n',
    "capability write features",
)
text = replace_once(
    text,
    '              "DRY_RUN_REQUIRED_FOR_SEASON_ROLLOVER",\n',
    '              "DRY_RUN_REQUIRED_FOR_SEASON_ROLLOVER",\n'
    '              "CONTRACT_INTAKE_AT_DATABASE_BOUNDARY",\n'
    '              "DEFERRED_ROLLOVER_REVALIDATION",\n'
    '              "NO_LEGACY_CONTRACT_GUESSING",\n',
    "capability safeguards",
)

validation_route = r'''
        if (operation === "validate_contract_intake") {
          if (body.dry_run !== true) {
            return jsonResponse(
              {
                error:
                  "validate_contract_intake is read-only and requires dry_run true",
              },
              400,
            );
          }

          const resourceType = typeof body.resource_type === "string"
            ? body.resource_type.trim().toLowerCase()
            : "";
          const resourceId = typeof body.resource_id === "string"
            ? body.resource_id.trim()
            : "";

          if (!CONTRACT_GUARDED_RESOURCE_TYPES.has(resourceType)) {
            return jsonResponse(
              {
                error:
                  "validate_contract_intake supports player, staff, player_contract, staff_contract, or contract",
              },
              400,
            );
          }

          if (!resourceId) {
            return jsonResponse(
              { error: "resource_id is required for contract intake validation" },
              400,
            );
          }

          if (expectedStateVersion === null) {
            return jsonResponse(
              {
                error:
                  "expected_state_version is required for contract intake validation",
              },
              400,
            );
          }

          const { data, error } = await supabase.rpc(
            "archers_validate_contract_intake",
            {
              p_resource_type: resourceType,
              p_resource_id: resourceId,
              p_payload: payload,
              p_expected_state_version: expectedStateVersion,
            },
          );

          if (error) {
            return errorResponse(
              error,
              "Contract intake validation failed",
              409,
            );
          }

          return jsonResponse(data);
        }

'''
text = replace_once(
    text,
    '        if (operation === "rollover_season") {\n',
    validation_route + '        if (operation === "rollover_season") {\n',
    "validation route",
)

upsert_preview = r'''
        if (
          body.dry_run === true &&
          operation === "upsert_resource"
        ) {
          const resourceType = typeof body.resource_type === "string"
            ? body.resource_type.trim().toLowerCase()
            : "";
          const resourceId = typeof body.resource_id === "string"
            ? body.resource_id.trim()
            : "";

          if (CONTRACT_GUARDED_RESOURCE_TYPES.has(resourceType)) {
            if (!resourceId) {
              return jsonResponse(
                { error: "resource_id is required for guarded resource intake" },
                400,
              );
            }
            if (expectedStateVersion === null) {
              return jsonResponse(
                {
                  error:
                    "expected_state_version is required for guarded resource intake",
                },
                400,
              );
            }

            const { data, error } = await supabase.rpc(
              "archers_validate_contract_intake",
              {
                p_resource_type: resourceType,
                p_resource_id: resourceId,
                p_payload: payload,
                p_expected_state_version: expectedStateVersion,
              },
            );

            if (error) {
              return errorResponse(
                error,
                "Guarded upsert preview failed",
                409,
              );
            }

            if (isPlainObject(data)) {
              return jsonResponse({
                ...data,
                requested_operation: "upsert_resource",
              });
            }
            return jsonResponse(data);
          }
        }

'''
text = replace_once(
    text,
    '        if (body.dry_run === true) {\n',
    upsert_preview + '        if (body.dry_run === true) {\n',
    "guarded upsert dry-run route",
)

for token in [
    'const BACKEND_VERSION = "3.4.0";',
    '"validate_contract_intake",',
    '"CONTRACT_INTAKE_VALIDATION"',
    '"DATABASE_CONTRACT_INTAKE_GUARD"',
    '"CONTRACT_INTAKE_AT_DATABASE_BOUNDARY"',
    '"archers_validate_contract_intake"',
    'validate_contract_intake is read-only and requires dry_run true',
]:
    if token not in text:
        raise RuntimeError(f"generated source missing {token}")

VERSIONED.write_text(text, encoding="utf-8")
CANONICAL.write_text(text, encoding="utf-8")
print(f"generated {VERSIONED} and {CANONICAL} ({len(text)} characters)")
