# DAD League and Resource Rules

**Module status:** Operational knowledge module v1.0  
**Purpose:** Govern structured franchise resources, roster and medical records, transactions, contracts, teams, schedules, official results, standings inputs, provenance, and data hygiene.

## 1. General resource model

Use structured resources for concepts without a dedicated relational table, including players, contracts, injuries, staff, draft assets, transactions, promises, awards, inactive lists, league news, Decision Queue, Draft Capital, and Transaction Ledger records.

Rules:

- `resource_type` uses lowercase letters, numbers, and underscores.
- `resource_id` is stable and identity-preserving.
- Use canonical spelling for names, positions, teams, statuses, and identifiers.
- Read the existing record before changing it.
- Include expected_version when updating an existing resource.
- Use `CONSOLE` only for public-safe information; otherwise use `PRIVATE`.
- Archive rather than hard-delete.
- Preserve provenance and source references.
- Never place secrets in resource data.

Do not create a new resource merely because an existing canonical record was difficult to find. Use resource_index or narrow discovery first.

## 2. Reads

Use exact resource filters whenever the identity is known.

For discovery:

- Use resources with `include_data=false` for version and metadata checks.
- Use resource_index for broad type and version discovery.
- Paginate rather than assuming the first page is complete.
- Include archived records only when history or correction requires them.
- Avoid loading the entire Transaction Ledger, Decision Queue, or player population when a filtered read can answer the question.

## 3. Roster and eligibility

Structured roster and eligibility state governs:

- Active-roster count.
- Practice-squad count.
- Elevation usage and remaining eligibility.
- Protections.
- Active, inactive, reserve, waived, released, or practice-squad status.
- Corresponding roster displacement.
- Participation eligibility.

A personnel move must update every dependent record reasonably affected by the move. Do not infer a release, promotion, activation, or displacement from discussion alone.

Practice-squad protection, elevation, promotion, and reversion are distinct actions. Preserve each one exactly.

Kevin approval is required for material personnel moves unless a specific delegation or standing policy clearly authorizes them.

## 4. Transactions and contracts

The Transaction Ledger is the authoritative structured history for completed personnel transactions.

A completed transaction should retain, when supported:

- Stable transaction ID.
- Type and effective date or week.
- Parties and counterparty.
- Assets in and out.
- Roster and contract effects.
- Related resource IDs.
- Source label and provenance.
- Resulting state version, event ID, and audit operation ID when available.
- Amendment or reversal links.

Do not invent contract numbers, guarantees, cap charges, dead money, deadlines, conditions, or transaction mechanics.

Elliot Crane, Cap Strategist, may explain only verified figures and clearly labeled uncertainty.

For a reversal or correction, preserve the original transaction and link the new correcting record. Do not erase history.

## 5. Medical resources

Medical records control diagnosis, function, restrictions, availability, treatment boundaries, and uncertainty.

Keep distinct:

- Diagnosis or issue.
- Functional limitation.
- Risk.
- Practice participation.
- Game availability.
- Workload restriction.
- Treatment plan.
- Unresolved tests or checkpoints.

Do not turn expected participation into certainty. Do not let a coach, scout, or executive overrule verified medical restrictions.

Public visibility must respect privacy boundaries. Use PRIVATE for details not appropriate for the console.

## 6. Draft capital and assets

Draft Capital records govern pick ownership, conditions, origin, year, round, status, and transaction history.

Never infer ownership from conversational memory when the structured record exists.

Conditional assets remain conditional. Do not promote them to owned or conveyed before the trigger is verified.

Any trade must update the transaction record and every affected asset record. Use dry-run previews for consequential multi-record transactions.

## 7. Teams and league alignment

Use the current team operation returned by capabilities for verified identity, alignment, activation, or correction.

Team records should preserve stable team IDs, canonical city and nickname, conference, division, activity, and Archers identity guardrails.

The Collegiate Football Federation exists independently of St. Louis. Other teams act in their own interests.

Do not invent alignment, relocation, ownership, or activation changes.

## 8. Schedule and official games

Use the current game operation for one official game record, the current bulk game operation for a verified slate, and the schedule operation for the Archers schedule.

Store each completed official result once.

A game record should preserve supported:

- Game ID.
- Season and week.
- Date and kickoff label.
- Away and home teams.
- Final score.
- Status.
- Overtime or neutral-site state.
- Provenance.
- Finalization time and version.

Changing an established final score requires CORRECTION. When the correct score is ambiguous, Kevin must resolve the conflict before history changes.

## 9. Standings and derived data

Standings derive from official FINAL game records.

Never write standings, wins, losses, points for, points against, differential, streak, or rankings directly when the system derives them from games.

Official standings are factual. Editorial power rankings must be separately labeled and must not replace standings.

When derived output appears wrong, inspect its game inputs rather than patching the displayed total.

## 10. Provenance and unknown data

Use only source labels returned by capabilities.

Conceptually:

- USER_EXPLICIT records Kevin’s direct decision or exact words.
- LIVE_SESSION_LOG records established simulated events.
- CORRECTION records a transparent repair.
- CHECKPOINT records a sealed historical boundary.
- SYSTEM records infrastructure or synchronization only.

Preserve record-level provenance such as PRESERVED, SIMULATED, USER_SUPPLIED, or CORRECTION when the module supports it.

Unknown information remains null, UNKNOWN, UNRECOVERED, or NOT_TRACKED. Display-friendly labels never replace the underlying authoritative value.

## 11. Multi-record changes

For consequential changes touching several records:

1. Read every affected current record and version.
2. Confirm identity and dependency links.
3. Use dry_run=true when supported.
4. Review the normalized preview.
5. Execute with current versions and one exact intent.
6. Verify the audit operation, canon event, target versions, and dependent records.
7. Update or resolve any Decision Queue item only after the domain effects are verified.

Never split one logically atomic transaction into casual writes when the backend supplies a protected bulk or composite operation.

## 12. Corrections and archive

Archive obsolete resources rather than deleting them.

A correction must preserve:

- What was wrong.
- Which source controls.
- The narrow corrected value.
- Necessary dependent changes.
- Provenance that a correction occurred.

Do not use correction to revise a disappointing result, improve a roster choice, or clean up inconvenient history.


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


## 14. Contract intake guard

When current capabilities advertise `validate_contract_intake`, use it before creating or replacing a player or staff contract through a draft signing, free-agent signing, re-signing, extension, trade acquisition, practice-squad agreement, or staff hire.

The preview must use `dry_run: true`, the current global state version, the exact player or staff resource identity, and one native JSON payload containing the proposed resource data. Review every blocker, warning, derived current value, option, and normalized schedule before the consequential write.

Canonical contracts must use absolute seasons and complete established schedules. Preserve supported `start_season`, `end_season`, `salary_by_season`, player `cap_hit_by_season`, guarantees, options, incentives, clauses, and provenance. A remaining-term contract may retain an unknown original start season, but its current and future schedules must be explicit.

Never submit only a display string such as `3 yrs/$30M`. Do not infer missing salary years, cap years, guarantees, option values, trade assumptions, or staff compensation from a summary. Unknown terms remain unresolved until Kevin or controlling canon establishes them.

Database enforcement is final. A rejected contract-bearing write must not be retried by removing fields, bypassing the preview, or splitting an atomic transaction. Correct the proposed canonical contract, reread current versions, use a new idempotency key when the request changes, and verify the completed transaction normally.

Contract intake validation and database normalization do not themselves sign, release, trade, extend, hire, fire, promote, exercise an option, or promise a role. Those personnel effects require the appropriate protected operation and authority.
