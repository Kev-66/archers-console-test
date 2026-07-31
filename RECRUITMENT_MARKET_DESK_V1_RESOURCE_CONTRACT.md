# Recruitment & Market Desk v1 resource contract

The Recruitment & Market Desk is a read-only research surface. It discovers candidates from canonical resources and may keep a non-canon watchlist in the current browser. It never signs a player, makes an offer, contacts another team, changes a roster, or writes to Supabase.

## Canonical resources

| Resource type | Resource ID | Purpose |
| --- | --- | --- |
| `league_player_index` | `league-player-index` | League player facts used to resolve trade-market identities |
| `team_market_state` | `team-market-state` | Team posture and evidence used by Trade Finder |
| `trade_market` | `trade-market` | Explicit trade availability; absence is not availability |
| `free_agent_market` | `free-agent-market` | Explicit current free-agent and waiver candidates |
| `draft_prospect_index` | `draft-prospect-index` | Draft prospects with recorded scouting evidence |
| `scouting_report` | report-specific stable ID | Optional evidence attached to a candidate |

The first five resource IDs are singleton resources for `stl-2026`. Scouting reports are individual resources.

## Evidence and freshness

Allowed evidence values are `MODEL_INFERENCE`, `PUBLIC_REPORT`, `STAFF_SCOUTED`, `TEAM_CONTACT`, and `VERIFIED`. Unknown fields remain null or absent. Each market may record `as_of_week` and `review_after_week`; the desk marks data stale when the current week is later than `review_after_week`.

No candidate may be synthesized from a missing resource. A player in `league_player_index` is not a trade target unless an eligible `trade_market` entry explicitly references that player. Baltimore opponent resources are scouting context and are not market evidence.

## Browser-local state

The watchlist and compare selection use `archers-console-market-desk-v1-watchlist` in browser storage. They are convenience data only:

- not canon;
- not synchronized;
- limited to authoritative candidate IDs already rendered by the desk;
- safely reconciled when candidates disappear from the authoritative market.

## Protected boundary

The web interface exposes no sign, offer, claim, contact, transaction, or resource-write action. Trade candidates can route to the existing Trade Finder for hypothetical package work. Any future real personnel workflow requires separate approval, optimistic concurrency, a stable idempotency key, a dry run, and post-write verification.
