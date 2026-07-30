# Backend 3.3.0 Regression Coverage

The Season Rollover Engine v1 regression suite runs after the preserved Backend 3.2.0 atomic Decision Queue tests.

State-version assertions are relative rather than tied to a fixture constant. This verifies that rollover increments the current global state exactly once even when an earlier protected operation has already advanced the test database.

Coverage includes:

- player and staff contract rollover;
- legacy-contract normalization blockers;
- dry-run no-write behavior;
- salary and cap schedule changes;
- final-year and expired contracts;
- unresolved option reporting without option exercise;
- exact idempotent replay;
- stale contract-resource fingerprint rejection;
- duplicate contract-resource identity rejection;
- atomic rollback on failure;
- wrong-season rejection.

The final pull-request validation runs this suite together with Edge parsing, schema checks, documentation checks, and the existing Trade Finder regressions.
