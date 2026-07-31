# Contract Intake Guard v1: Production Report

**Completed:** July 30, 2026  
**Backend:** 3.4.0  
**Franchise:** St. Louis Archers (`stl-2026`)

## Source and deployment

- Contract Intake Guard v1 merged through PR #10.
- Identifier-validation hardening merged through PR #11.
- Backend 3.4.0 was deployed from production trigger commit `e3b74b2bc4bc8e988d70bb4692cc099f70acdecc`.
- Database migration `20260731005000_contract_intake_guard_v1` installed the evaluator, validation RPC, immediate normalization trigger, and deferred final-state trigger.
- Database migration `20260731005200_contract_intake_guard_v1_identifier_patch` aligned preview identity validation with the authoritative resource table constraints.
- The previous Backend 3.3.0 Edge source and public database schema were backed up before deployment.
- Automatic Edge restoration was not needed.

## Production verification

The live verification passed every stage:

- Transactional database installation self-test: passed
- Backend capabilities version: `3.4.0`
- Existing player contracts validated: **69**
- Existing staff contracts validated: **16**
- Total existing contract blockers: **0**
- Existing contract warnings: **24**
- Warning type: `START_SEASON_UNKNOWN` only
- Complete hypothetical player contract: accepted
- Legacy summary-only contract: rejected
- Guarded `upsert_resource` dry run: accepted and normalized
- 2026-to-2027 Season Rollover dry run: ready
- Rollover processable contracts: **85**
- Rollover blockers: **0**

The 24 warnings preserve the previously established boundary for remaining-term contracts whose original start season was never known. Their current and future salary and cap schedules remain authoritative and rollover-ready.

## No-write proof

Production state remained unchanged throughout live verification:

- State version before: **37**
- State version after: **37**
- Canon events created: **0**
- Audit rows created: **0**
- Test resources created: **0**
- Personnel transactions executed: **0**
- Real season rollovers executed: **0**

The installation self-test inserted one valid temporary resource inside a database transaction, confirmed that the trigger normalized it, deleted it, and committed with no test resource remaining. It separately confirmed that a contractless active Archers player write is rejected atomically.

## Protected future workflows

The database boundary now protects contract-bearing resources created or changed through:

- draft signings
- free-agent signings
- re-signings
- contract extensions
- trade acquisitions
- practice-squad agreements
- staff hires and staff contract changes
- generic single-resource upserts
- generic bulk-resource upserts
- direct SQL and future composite transaction operations

A contract-bearing write must provide a canonical schedule that the Season Rollover Engine can process. Legacy display strings do not satisfy intake requirements.

The guard validates and derives contract data. It does not itself sign, trade, release, extend, hire, fire, promote, exercise an option, or make another personnel decision.

## Custom GPT guidance boundary

`DAD_LEAGUE_AND_RESOURCE_RULES.md` now instructs the Draft a Dynasty GPT to use `validate_contract_intake` before consequential player or staff contract writes. The repository copy is current, but an already-uploaded Custom GPT Knowledge copy does not update automatically. Database enforcement protects production regardless of whether that Knowledge file has been refreshed.

## Evidence

- GitHub Actions run: `30595693402`
- Evidence artifact: `backend-3.4.0-contract-intake-production-30595693402`
- Artifact ID: `8780028391`
- Artifact SHA-256: `05fd35c722bb8088a38f0a4412a22eb4a46754d096a295abe19bbdc5df3cffd7`
