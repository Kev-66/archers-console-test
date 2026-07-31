# Contract Normalization Migration v1: Production Report

**Completed:** July 30, 2026  
**Backend:** 3.3.0  
**Franchise:** St. Louis Archers (`stl-2026`)  
**Authority:** Kevin Dorey explicitly delegated canon-changing contract decisions on July 30, 2026.

## Production result

- Global state advanced atomically from version **36** to **37**.
- Canonical season fields now explicitly establish **2026** at:
  - `season`
  - `current_season`
  - `timeline.season`
  - `franchise.season`
- **69 active player resources** now contain canonical contract objects.
- **16 canonical non-owner staff resources** were created with structured contracts.
- Audit operation **33** recorded `normalize_contracts` as `SUCCESS`.
- Canon event **39** recorded the contract normalization.
- Idempotency key: `contract-normalization-v1-20260730`.
- No player was released, promoted, restructured, extended beyond the normalized terms, or assigned a new role guarantee.
- No contract option was exercised.
- No season rollover was executed.

## Player-contract rules

The migration preserved every established 2026 cap hit and every established total or remaining contract value.

Where future annual compensation was not previously established, the remaining value was distributed across the remaining seasons using modest annual escalation while balancing exactly to the established contract value. Contracts described only as a remaining term preserve an unknown original start season rather than inventing one.

Practice-squad agreements preserve their established fictional weekly salaries, use an 18-week 2026 accounting basis, and expire after the 2026 season unless a later football decision establishes otherwise.

Specific preserved clauses include:

- Ethan Cross: established 2027 cap hit of **$3.8M**.
- Jalen Knox: **no starting-role guarantee**.
- Devin Cole: up to **$2.0M NLTBE incentives**, excluded from scheduled contract value.
- Gavin Mercer: unresolved team fifth-year option for 2030.
- Jonah Saye: unresolved team fifth-year option for 2030.

The normalized 2026 active-roster and practice-squad contract accounting totals **$249.0075M**.

## Staff contracts

| Staff member | Position | Term | Annual salaries, millions |
|---|---|---:|---|
| Mara Voss | Vice President of Football Operations | 2026–2030 | 3.20, 3.35, 3.50, 3.65, 3.80 |
| Avery Holt | Head Coach | 2026–2030 | 7.50, 8.00, 8.50, 9.00, 9.50 |
| Petra Lang | Offensive Coordinator | 2026–2028 | 2.40, 2.60, 2.80 |
| Wade Sutter | Defensive Coordinator | 2026–2028 | 2.50, 2.70, 2.90 |
| Darius Bell | Scouting Director | 2026–2029 | 1.60, 1.70, 1.80, 1.90 |
| Elliot Crane | Cap Strategist | 2026–2029 | 1.30, 1.40, 1.50, 1.60 |
| Dr. Anjali Venkataraman | Head Team Physician | 2026–2029 | 1.40, 1.50, 1.60, 1.70 |
| Lenora Pike | Special Teams Coordinator | 2026–2028 | 1.50, 1.60, 1.70 |
| Silas Farrow | Offensive Line Coach | 2026–2027 | 1.05, 1.15 |
| Rhea Viteri | Running Backs Coach | 2026–2027 | 0.85, 0.95 |
| Malcolm Iriye | Wide Receivers Coach | 2026–2027 | 0.95, 1.05 |
| Felix Arriaga | Tight Ends Coach | 2026–2027 | 0.80, 0.90 |
| Immanuel Okafor | Defensive Line Coach | 2026–2027 | 1.00, 1.10 |
| Lenard Quist | Linebackers Coach | 2026–2027 | 0.90, 1.00 |
| Asha Moreau | Safeties Coach | 2026–2027 | 0.85, 0.95 |
| Celeste Navarro | Communications Director | 2026–2028 | 1.00, 1.10, 1.20 |

The established 2026 staff payroll totals **$28.8M**. Staff compensation is organizational payroll and is not included in player salary-cap schedules.

## Season Rollover Engine readiness

The post-normalization 2026-to-2027 dry run returned:

- Ready to execute: **Yes**
- Processable contracts: **85**
- Players: **69**
- Staff: **16**
- Legacy contract records: **0**
- Blockers: **0**
- Warnings: **24**, all for legacy remaining-term contracts whose original start season remains unknown
- Contracts expiring when entering 2027: **27**
- Contracts entering their final year during 2027: **27**
- Scheduled salary changes: **58**
- Scheduled player cap-hit changes: **42**
- Options exercised: **0**
- Personnel moves: **0**

The dry run proposed state version 38 but performed no write. Production remained at state version 37.

## Evidence

GitHub Actions run: `30592065917`  
Evidence artifact: `contract-normalization-v1-production-30592065917`  
Artifact ID: `8778725551`  
Artifact SHA-256: `ebf4fb71ee16c104275cfc1c21a5194a6bad9b61f9e728a7025f1ca13dab8264`
