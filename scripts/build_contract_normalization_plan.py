import json
import re
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

SEASON = 2026
PRACTICE_SQUAD_WEEKS = 18
EVIDENCE = Path("evidence")


def quantize(value):
    return Decimal(str(value)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def distribute_contract_value(total, current, years):
    total_value = Decimal(str(total))
    current_value = Decimal(str(current))
    if years == 1:
        return [quantize(total_value)]

    remaining = total_value - current_value
    weights = [Decimal("1") + Decimal("0.08") * index for index in range(years - 1)]
    weight_total = sum(weights)
    values = [quantize(current_value)]
    allocated = Decimal("0")

    for index, weight in enumerate(weights):
        if index == len(weights) - 1:
            value = quantize(remaining - allocated)
        else:
            value = quantize(remaining * weight / weight_total)
            allocated += value
        values.append(value)

    values[-1] = quantize(values[-1] + quantize(total_value - sum(values)))
    return values


def build_player_contract(resource):
    data = resource["data"]
    resource_id = resource["resource_id"]
    player_name = data["player_name"]
    summary = data["contract_summary"]
    notes = data.get("contract_notes") or ""

    contract = {
        "contract_schema_version": 1,
        "contract_kind": "PLAYER",
        "player_id": resource_id,
        "player_name": player_name,
        "currency": "USD",
        "amount_unit": "MILLIONS",
        "current_season": SEASON,
        "normalization_basis": {
            "source": "Legacy 2026 player resource",
            "source_contract_summary": summary,
            "source_contract_notes": notes,
            "authority": "Kevin Dorey delegated contract canon decisions on 2026-07-30",
            "method": "Preserve the established current cap hit and total or remaining value; distribute unestablished future compensation conservatively with modest escalation.",
        },
        "options": [],
        "options_due": [],
    }

    if data.get("roster_status") == "PRACTICE_SQUAD":
        weekly_salary = Decimal(str(data["practice_squad_weekly_salary"]))
        annual_salary = quantize(
            weekly_salary * PRACTICE_SQUAD_WEEKS / Decimal("1000000")
        )
        contract.update({
            "employment_class": "PRACTICE_SQUAD",
            "start_season": SEASON,
            "end_season": SEASON,
            "years_remaining": 1,
            "salary_by_season": {str(SEASON): float(annual_salary)},
            "cap_hit_by_season": {str(SEASON): float(annual_salary)},
            "weekly_salary_by_season": {str(SEASON): int(weekly_salary)},
            "scheduled_weeks_by_season": {str(SEASON): PRACTICE_SQUAD_WEEKS},
            "current_salary": float(annual_salary),
            "current_salary_season": SEASON,
            "current_cap_hit": float(annual_salary),
            "current_cap_hit_season": SEASON,
            "rollover_status": "FINAL_YEAR",
            "guarantee_status": "WEEKLY_WHILE_ROSTERED",
        })
        return contract

    match = re.search(r"(\d+)\s*yrs?/\$([0-9.]+)M", summary)
    if not match:
        raise ValueError(f"Unsupported contract summary for {resource_id}: {summary}")

    years = int(match.group(1))
    total_value = Decimal(match.group(2))
    current_cap = Decimal(str(data["cap_hit_2026_millions"]))
    values = distribute_contract_value(total_value, current_cap, years)
    schedule = {
        str(SEASON + index): float(value)
        for index, value in enumerate(values)
    }

    contract.update({
        "employment_class": "ACTIVE_ROSTER",
        "end_season": SEASON + years - 1,
        "years_remaining": years,
        "contract_value_millions": float(quantize(total_value)),
        "salary_by_season": schedule,
        "cap_hit_by_season": dict(schedule),
        "current_salary": float(values[0]),
        "current_salary_season": SEASON,
        "current_cap_hit": float(values[0]),
        "current_cap_hit_season": SEASON,
        "rollover_status": "FINAL_YEAR" if years == 1 else "ACTIVE",
    })

    if "remaining" not in summary.lower():
        contract["start_season"] = SEASON
        contract["term_basis"] = "FULL_TERM_ESTABLISHED_AT_2026_START"
    else:
        contract["term_basis"] = "REMAINING_TERM_ESTABLISHED_AT_2026_START"

    if "fully guaranteed" in notes.lower():
        contract["guaranteed_by_season"] = dict(schedule)
        contract["guarantee_status"] = "FULLY_GUARANTEED"

    if "fifth-year option" in notes.lower():
        contract["options"] = [{
            "option_type": "TEAM_FIFTH_YEAR",
            "season": SEASON + years,
            "status": "UNRESOLVED",
            "compensation_status": "TO_BE_ESTABLISHED_AT_OPTION_DECISION",
        }]

    if "no starting guarantee" in notes.lower():
        contract["role_guarantees"] = []
        contract["clauses"] = ["No starting-role guarantee"]

    if "NLTBE" in notes.upper():
        contract["incentives"] = [{
            "type": "NLTBE",
            "maximum_millions": 2.0,
            "included_in_scheduled_value": False,
        }]

    return contract


STAFF_SPECS = [
    ("mara-voss", "Mara Voss", "Vice President of Football Operations", "she/her", 2030, [3.20, 3.35, 3.50, 3.65, 3.80]),
    ("avery-holt", "Avery Holt", "Head Coach", "she/her", 2030, [7.50, 8.00, 8.50, 9.00, 9.50]),
    ("petra-lang", "Petra Lang", "Offensive Coordinator", "she/her", 2028, [2.40, 2.60, 2.80]),
    ("wade-sutter", "Wade Sutter", "Defensive Coordinator", "he/him", 2028, [2.50, 2.70, 2.90]),
    ("darius-bell", "Darius Bell", "Scouting Director", "he/him", 2029, [1.60, 1.70, 1.80, 1.90]),
    ("elliot-crane", "Elliot Crane", "Cap Strategist", "he/him", 2029, [1.30, 1.40, 1.50, 1.60]),
    ("anjali-venkataraman", "Dr. Anjali Venkataraman", "Head Team Physician", "she/her", 2029, [1.40, 1.50, 1.60, 1.70]),
    ("lenora-pike", "Lenora Pike", "Special Teams Coordinator", "she/her", 2028, [1.50, 1.60, 1.70]),
    ("silas-farrow", "Silas Farrow", "Offensive Line Coach", "he/him", 2027, [1.05, 1.15]),
    ("rhea-viteri", "Rhea Viteri", "Running Backs Coach", "she/her", 2027, [0.85, 0.95]),
    ("malcolm-iriye", "Malcolm Iriye", "Wide Receivers Coach", "he/him", 2027, [0.95, 1.05]),
    ("felix-arriaga", "Felix Arriaga", "Tight Ends Coach", "he/him", 2027, [0.80, 0.90]),
    ("immanuel-okafor", "Immanuel Okafor", "Defensive Line Coach", "he/him", 2027, [1.00, 1.10]),
    ("lenard-quist", "Lenard Quist", "Linebackers Coach", "he/him", 2027, [0.90, 1.00]),
    ("asha-moreau", "Asha Moreau", "Safeties Coach", "she/her", 2027, [0.85, 0.95]),
    ("celeste-navarro", "Celeste Navarro", "Communications Director", "she/her", 2028, [1.00, 1.10, 1.20]),
]


def build_staff_resource(spec):
    resource_id, staff_name, position, pronouns, end_season, salaries = spec
    schedule = {
        str(SEASON + index): float(quantize(value))
        for index, value in enumerate(salaries)
    }
    contract = {
        "contract_schema_version": 1,
        "contract_kind": "STAFF",
        "staff_id": resource_id,
        "staff_name": staff_name,
        "currency": "USD",
        "amount_unit": "MILLIONS",
        "start_season": SEASON,
        "end_season": end_season,
        "current_season": SEASON,
        "years_remaining": end_season - SEASON + 1,
        "salary_by_season": schedule,
        "cap_hit_by_season": {},
        "current_salary": schedule[str(SEASON)],
        "current_salary_season": SEASON,
        "current_cap_hit": None,
        "current_cap_hit_season": None,
        "rollover_status": "ACTIVE",
        "options": [],
        "options_due": [],
        "normalization_basis": {
            "source": "Draft a Dynasty Bible v1.1 Appendix A personnel canon",
            "authority": "Kevin Dorey delegated contract canon decisions on 2026-07-30",
            "method": "Inaugural Archers staff contract established by role scope, market seniority, and organizational continuity.",
        },
    }
    data = {
        "profile_schema_version": 1,
        "staff_id": resource_id,
        "staff_name": staff_name,
        "name": staff_name,
        "position": position,
        "role": position,
        "pronouns": pronouns,
        "employment_status": "ACTIVE",
        "contract_summary": f"{end_season - SEASON + 1} yrs/${sum(salaries):.2f}M",
        "contract": contract,
    }
    return {
        "resource_type": "staff",
        "resource_id": resource_id,
        "status": "ACTIVE",
        "visibility": "CONSOLE",
        "season": SEASON,
        "data": data,
    }


players = json.loads((EVIDENCE / "active-player-resources.json").read_text(encoding="utf-8"))
core = json.loads((EVIDENCE / "core-state.json").read_text(encoding="utf-8"))
organizational = json.loads((EVIDENCE / "organizational-state-fields.json").read_text(encoding="utf-8"))

if core.get("version") != 36:
    raise RuntimeError(f"Expected state version 36, found {core.get('version')}")
if len(players) != 69:
    raise RuntimeError(f"Expected 69 active player resources, found {len(players)}")
if organizational.get("fields", {}).get("franchise", {}).get("season") != SEASON:
    raise RuntimeError("The sealed franchise section does not establish the 2026 season")

player_updates = [{
    "resource_type": "player",
    "resource_id": resource["resource_id"],
    "expected_version": resource["version"],
    "contract": build_player_contract(resource),
} for resource in players]
staff_inserts = [build_staff_resource(spec) for spec in STAFF_SPECS]

plan = {
    "plan_schema_version": 1,
    "operation": "normalize_contracts",
    "franchise_id": "stl-2026",
    "season": SEASON,
    "expected_state_version": 36,
    "idempotency_key": "contract-normalization-v1-20260730",
    "summary": "Normalize all established 2026 Archers player and staff contracts for Season Rollover Engine v1",
    "source_label": "USER_EXPLICIT",
    "exact_kevin_text": "Lets Do It. I trust you with all canon changing decisions with these contracts.",
    "player_updates": player_updates,
    "staff_inserts": staff_inserts,
    "state_patch": {
        "season": SEASON,
        "current_season": SEASON,
        "timeline": {"season": SEASON},
        "franchise": {"season": SEASON},
        "contracts": {
            "current_season": SEASON,
            "normalization_version": 1,
            "normalized_player_contracts": len(player_updates),
            "established_staff_contracts": len(staff_inserts),
            "normalization_authority": "Kevin Dorey explicit delegation on 2026-07-30",
        },
    },
    "decision_rules": {
        "preserve_established_current_cap_hits": True,
        "preserve_established_total_or_remaining_values": True,
        "future_compensation_method": "Modest escalation balancing exactly to established total",
        "practice_squad_basis_weeks": PRACTICE_SQUAD_WEEKS,
        "staff_contracts_created_from_canonical_personnel_list": True,
        "automatic_options_exercised": False,
        "personnel_moves_made": False,
    },
}

for update in player_updates:
    contract = update["contract"]
    total = contract.get("contract_value_millions")
    if total is not None:
        scheduled = quantize(sum(Decimal(str(value)) for value in contract["salary_by_season"].values()))
        if scheduled != quantize(total):
            raise RuntimeError(f"Contract total mismatch for {update['resource_id']}")

(EVIDENCE / "contract-normalization-plan-v1.json").write_text(
    json.dumps(plan, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
    encoding="utf-8",
)

summary = {
    "state_version": core["version"],
    "season": SEASON,
    "player_updates": len(player_updates),
    "staff_inserts": len(staff_inserts),
    "active_roster_and_practice_squad_2026_cap_millions": float(quantize(sum(
        Decimal(str(update["contract"]["current_cap_hit"])) for update in player_updates
    ))),
    "staff_2026_payroll_millions": float(quantize(sum(
        Decimal(str(resource["data"]["contract"]["current_salary"])) for resource in staff_inserts
    ))),
    "expiring_after_2026": sum(
        1 for update in player_updates if update["contract"]["end_season"] == SEASON
    ),
    "unresolved_fifth_year_options": sum(
        len(update["contract"].get("options", [])) for update in player_updates
    ),
}
(EVIDENCE / "contract-normalization-plan-summary.json").write_text(
    json.dumps(summary, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
print(json.dumps(summary, indent=2, sort_keys=True))
