from pathlib import Path

path = Path("DAD_LEAGUE_AND_RESOURCE_RULES.md")
text = path.read_text(encoding="utf-8")
heading = "## 14. Contract intake guard"

if heading not in text:
    text = text.rstrip() + """


## 14. Contract intake guard

When current capabilities advertise `validate_contract_intake`, use it before creating or replacing a player or staff contract through a draft signing, free-agent signing, re-signing, extension, trade acquisition, practice-squad agreement, or staff hire.

The preview must use `dry_run: true`, the current global state version, the exact player or staff resource identity, and one native JSON payload containing the proposed resource data. Review every blocker, warning, derived current value, option, and normalized schedule before the consequential write.

Canonical contracts must use absolute seasons and complete established schedules. Preserve supported `start_season`, `end_season`, `salary_by_season`, player `cap_hit_by_season`, guarantees, options, incentives, clauses, and provenance. A remaining-term contract may retain an unknown original start season, but its current and future schedules must be explicit.

Never submit only a display string such as `3 yrs/$30M`. Do not infer missing salary years, cap years, guarantees, option values, trade assumptions, or staff compensation from a summary. Unknown terms remain unresolved until Kevin or controlling canon establishes them.

Database enforcement is final. A rejected contract-bearing write must not be retried by removing fields, bypassing the preview, or splitting an atomic transaction. Correct the proposed canonical contract, reread current versions, use a new idempotency key when the request changes, and verify the completed transaction normally.

Contract intake validation and database normalization do not themselves sign, release, trade, extend, hire, fire, promote, exercise an option, or promise a role. Those personnel effects require the appropriate protected operation and authority.
"""
    path.write_text(text, encoding="utf-8")
    print("Appended Contract Intake Guard rules to DAD_LEAGUE_AND_RESOURCE_RULES.md")
else:
    print("Contract Intake Guard knowledge section already present")
