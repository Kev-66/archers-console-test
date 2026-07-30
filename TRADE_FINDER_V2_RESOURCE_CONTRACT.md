# Trade Finder v2 Resource Contract

## Canonical resources

Trade Finder v2 reads three active console-visible resources:

| Resource type | Resource ID | Purpose |
|---|---|---|
| `league_player_index` | `league-player-index` | Factual searchable league player profiles |
| `team_market_state` | `team-market-state` | Current buyer, seller, hold, hybrid, rebuilding, or contending posture |
| `trade_market` | `trade-market` | Player-specific availability, evidence, and asking posture |

These resources remain under franchise ID `stl-2026` because they are part of the authoritative Draft a Dynasty universe ledger.

## Important absence rule

Absence is not availability.

- A player missing from `trade_market` has no established current market.
- A team missing from `team_market_state` defaults to HOLD for the website only.
- A player missing from `league_player_index` cannot be counted among no-market matches unless a complete embedded player snapshot exists in `trade_market`.
- Unknown fields remain null or omitted.

## `league_player_index / league-player-index`

This resource contains factual profiles, not trade claims.

Minimum player identity:

```json
{
  "player_id": "stable-player-id",
  "team_id": "stable-team-id",
  "player_name": "Player Name",
  "position": "CB"
}
```

Recommended fields include OVR, age, development trait, role, cap hit, contract years, roster status, and updated week.

This index may be partial. The resource should state its coverage and review window.

## `team_market_state / team-market-state`

Each team entry should explain its current direction.

```json
{
  "team_id": "carolina",
  "posture": "SELLER",
  "confidence": "STAFF_SCOUTED",
  "buying_positions": ["OT"],
  "selling_positions": ["CB"],
  "preferred_assets": ["PICKS", "YOUNG_PLAYERS"],
  "avoided_assets": ["EXPENSIVE_VETERANS"],
  "cap_pressure": "HIGH",
  "as_of_week": 7,
  "review_after_week": 8,
  "summary": "Club is moving veteran salary while preserving young starters."
}
```

Posture alone does not put every player on the market.

## `trade_market / trade-market`

Only players with a meaningful current market need an entry.

```json
{
  "market_id": "carolina-cb-example-w7",
  "player_id": "example-player",
  "team_id": "carolina",
  "availability": "AVAILABLE",
  "evidence": "TEAM_CONTACT",
  "asking_price": "Day Two pick or young starter",
  "movable_reason": "Veteran contract and a younger replacement is ready",
  "desired_assets": ["PICKS", "YOUNG_PLAYERS"],
  "as_of_week": 7,
  "review_after_week": 8
}
```

An entry may embed a `player` snapshot when the league index is incomplete. The website prefers the indexed player and merges supported embedded fields.

## Freshness

Each market resource may use:

- `as_of_week`
- `review_after_week`

The website ignores player entries past `review_after_week`.

Market state should be reviewed after:

- meaningful record changes;
- major injuries;
- depth-chart changes;
- contract developments;
- trades or releases;
- substantial changes in playoff position;
- the approach of the trade deadline.

## Evidence

Supported evidence levels:

- `MODEL_INFERENCE`
- `PUBLIC_REPORT`
- `STAFF_SCOUTED`
- `TEAM_CONTACT`
- `VERIFIED`

The website displays evidence confidence and penalizes speculative entries. It does not promote a lower evidence level to verified.

## Visibility and privacy

Use `CONSOLE` only for market information safe to display on the website.

Private negotiation details, confidential medical data, and unsupported contract figures remain `PRIVATE` or absent.

## Write safety

Creating or refreshing these resources is a canon operation and must follow current capabilities, version checks, idempotency, dry-run rules when appropriate, and operation verification.

The website itself never writes them.
