from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match in {path}, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


verifier = Path("scripts/verify_backend_3_4_0_contract_intake_production.py")
replace_once(
    verifier,
    'valid_id = f"__contract-intake-valid-{RUN_ID}__"\ninvalid_id = f"__contract-intake-invalid-{RUN_ID}__"',
    'valid_id = f"contract-intake-valid-{RUN_ID}"\ninvalid_id = f"contract-intake-invalid-{RUN_ID}"',
    "production verifier resource IDs",
)

ci = Path(".github/workflows/backend-3.4.0-ci.yml")
replace_once(
    ci,
    "      - name: Apply Contract Intake Guard v1 migration\n"
    "        run: psql -f phase3-4-contract-intake-guard-v1.sql\n\n"
    "      - name: Run Contract Intake Guard installation self-test\n",
    "      - name: Apply Contract Intake Guard v1 migration\n"
    "        run: psql -f phase3-4-contract-intake-guard-v1.sql\n\n"
    "      - name: Apply Contract Intake Guard identifier patch\n"
    "        run: psql -f phase3-4-contract-intake-guard-v1-identifier-patch.sql\n\n"
    "      - name: Run Contract Intake Guard installation self-test\n",
    "CI identifier patch migration",
)
replace_once(
    ci,
    "      - name: Run Contract Intake Guard regressions\n"
    "        run: psql -f tests/backend-3.4.0/contract-intake-guard-v1.sql\n\n"
    "      - name: Verify generated Edge sources\n",
    "      - name: Run Contract Intake Guard regressions\n"
    "        run: psql -f tests/backend-3.4.0/contract-intake-guard-v1.sql\n\n"
    "      - name: Run Contract Intake Guard identifier regressions\n"
    "        run: psql -f tests/backend-3.4.0/contract-intake-identifier-hotfix.sql\n\n"
    "      - name: Verify generated Edge sources\n",
    "CI identifier hotfix regressions",
)

production = Path(".github/workflows/backend-3.4.0-contract-intake-production.yml")
replace_once(
    production,
    "          grep -q 'create or replace function public.archers_contract_intake_evaluate_v1' phase3-4-contract-intake-guard-v1.sql\n"
    "          grep -q 'invalid-write self-test' phase3-4-contract-intake-guard-v1-self-test.sql\n",
    "          grep -q 'create or replace function public.archers_contract_intake_evaluate_v1' phase3-4-contract-intake-guard-v1.sql\n"
    "          grep -q 'resource_id has an unsupported format' phase3-4-contract-intake-guard-v1-identifier-patch.sql\n"
    "          grep -q 'invalid-write self-test' phase3-4-contract-intake-guard-v1-self-test.sql\n",
    "production source validation",
)
replace_once(
    production,
    "            cp ../phase3-4-contract-intake-guard-v1.sql \\\n"
    "              supabase/migrations/20260731005000_contract_intake_guard_v1.sql\n\n"
    "            cp ../archers-franchise-index-v3.4.0.ts \\\n",
    "            cp ../phase3-4-contract-intake-guard-v1.sql \\\n"
    "              supabase/migrations/20260731005000_contract_intake_guard_v1.sql\n"
    "            cp ../phase3-4-contract-intake-guard-v1-identifier-patch.sql \\\n"
    "              supabase/migrations/20260731005200_contract_intake_guard_v1_identifier_patch.sql\n\n"
    "            cp ../archers-franchise-index-v3.4.0.ts \\\n",
    "production identifier patch migration",
)

print("Applied Contract Intake Guard identifier hotfix materialization")
