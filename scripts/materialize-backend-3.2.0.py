#!/usr/bin/env python3
"""Materialize backend 3.2.0 from the verified 3.1.4 source.

The script performs narrow, assertion-guarded replacements. It refuses to write
when the expected 3.1.4 source shape or checksum has changed.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "archers-franchise-index-v3.1.4.ts"
OUTPUT = ROOT / "archers-franchise-index-v3.2.0.ts"
CANONICAL = ROOT / "edge-function-archers-franchise.ts"
EXPECTED_SHA256 = "6ae0bf210a8c01539a1366180ae334a8932f15e43a1ad837000ca683c68c239a"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def main() -> None:
    source = SOURCE.read_text(encoding="utf-8")
    source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
    if source_hash != EXPECTED_SHA256:
        raise RuntimeError(
            "Verified 3.1.4 source checksum changed: "
            f"expected {EXPECTED_SHA256}, found {source_hash}"
        )

    transformed = replace_once(
        source,
        'const BACKEND_VERSION = "3.1.4";',
        'const BACKEND_VERSION = "3.2.0";',
        "backend version",
    )

    transformed = replace_once(
        transformed,
        '  "patch_franchise_state",\n  "upsert_resource",',
        '  "patch_franchise_state",\n  "update_decision",\n  "upsert_resource",',
        "write operation allowlist",
    )

    transformed = replace_once(
        transformed,
        '''            composite_read_features: [
              "DECISION_CONTEXT_BUNDLE",
              "OPERATION_VERIFICATION_BUNDLE",
              "THREE_CALL_DECISION_WORKFLOW",
              "UNIQUE_AFFECTED_RESOURCE_VERSIONS",
              "OPERATION_SCOPED_UNRESOLVED_ISSUES",
            ],
            write_operations: [...WRITE_OPERATIONS],''',
        '''            composite_read_features: [
              "DECISION_CONTEXT_BUNDLE",
              "OPERATION_VERIFICATION_BUNDLE",
              "THREE_CALL_DECISION_WORKFLOW",
              "UNIQUE_AFFECTED_RESOURCE_VERSIONS",
              "OPERATION_SCOPED_UNRESOLVED_ISSUES",
            ],
            write_features: [
              "ATOMIC_DECISION_UPDATE",
            ],
            write_operations: [...WRITE_OPERATIONS],''',
        "capability write features",
    )

    transformed = replace_once(
        transformed,
        '              "EXPECTED_STATE_VERSION_WHEN_RPC_SUPPORTS_IT",\n              "IDEMPOTENCY",',
        '              "EXPECTED_STATE_VERSION_WHEN_RPC_SUPPORTS_IT",\n              "DECISION_IDENTITY_PRESERVATION",\n              "IDEMPOTENCY",',
        "decision safeguard",
    )

    route_block = '''
        if (operation === "update_decision") {
          const suppliedIdempotencyKey =
            typeof body.idempotency_key === "string" &&
              body.idempotency_key.trim().length > 0;

          if (!suppliedIdempotencyKey) {
            return jsonResponse(
              { error: "idempotency_key is required for update_decision" },
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
            resourceType !== "decision_queue" ||
            resourceId !== "decision-queue"
          ) {
            return jsonResponse(
              {
                error:
                  "update_decision requires resource_type decision_queue and resource_id decision-queue",
              },
              400,
            );
          }

          if (expectedVersion === null) {
            return jsonResponse(
              { error: "expected_version is required for update_decision" },
              400,
            );
          }

          if (expectedStateVersion === null) {
            return jsonResponse(
              {
                error:
                  "expected_state_version is required for update_decision",
              },
              400,
            );
          }

          const decisionId = typeof payload.decision_id === "string"
            ? payload.decision_id.trim()
            : "";
          const changes = payload.changes;

          if (!decisionId) {
            return jsonResponse(
              { error: "payload.decision_id is required" },
              400,
            );
          }

          if (!isPlainObject(changes) || Object.keys(changes).length === 0) {
            return jsonResponse(
              {
                error:
                  "payload.changes must be a non-empty JSON object",
              },
              400,
            );
          }

          const { data, error } = await supabase.rpc(
            "archers_update_decision",
            {
              p_resource_type: "decision_queue",
              p_resource_id: "decision-queue",
              p_payload: payload,
              p_expected_version: expectedVersion,
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
              "Atomic decision update failed",
              409,
            );
          }

          return jsonResponse(data);
        }

'''

    transformed = replace_once(
        transformed,
        '''        if (body.dry_run === true) {
          const currentState =''',
        route_block + '''        if (body.dry_run === true) {
          const currentState =''',
        "atomic decision route",
    )

    if transformed == source:
        raise RuntimeError("No backend changes were materialized")

    OUTPUT.write_text(transformed, encoding="utf-8")
    CANONICAL.write_text(transformed, encoding="utf-8")

    output_hash = hashlib.sha256(transformed.encode("utf-8")).hexdigest()
    print(f"source_sha256={source_hash}")
    print(f"output_sha256={output_hash}")
    print(f"output_bytes={len(transformed.encode('utf-8'))}")


if __name__ == "__main__":
    main()
