# Draft a Dynasty Trade Center v1

## Status

Phase 3.3A read-only website feature.

## Purpose

Trade Center v1 is a planning and comparison surface inside the Franchise Console Front Office tab. It combines current console-visible St. Louis player resources, live draft-capital assets, and current practical cap flexibility with a manually entered proposed external target.

It does not claim that the target exists, is available, has the entered contract, or would accept the proposed package. Those facts remain hypothetical until separately verified through authoritative league context.

## Placement

The Trade Center appears inside Front Office between Draft Capital and Transaction Center.

## Authoritative inputs

The browser reads only:

- `archers_franchise_state` for current state version and practical cap flexibility.
- active `player` resources with `visibility: CONSOLE` for Archers outgoing players.
- active `draft_capital / draft-capital` with `visibility: CONSOLE` for outgoing selections.

The workbench performs no Supabase writes.

## User-entered inputs

- trade objective
- proposed target identity and team
- target position, OVR, age, development trait, cap hit, and contract years
- evidence level and asking-price note

These fields are planning assumptions, not canon.

## Evaluation model

The interface exposes six heuristic scores:

1. Roster Fit
2. Trade Realism
3. Cap Feasibility
4. Short-Term Impact
5. Long-Term Value
6. Evidence Confidence

Values are calculated from visible assumptions including OVR, positional depth, age, development trait, cap movement, draft round, draft year, asset status, package size, and evidence quality.

The model is intentionally not an acceptance predictor. It labels package balance as light offer, negotiating range, or Archers premium and displays evidence boundaries.

## Scenario comparison

Up to three scenarios may be stored in browser `localStorage`. They are not canon, are not shared across devices, and are not written to Supabase.

## Draft a Dynasty handoff

The Copy Staff Review Prompt action generates a read-only review request that instructs the Custom GPT to:

- read current authoritative context
- verify all external and internal facts
- distinguish verified, unknown, and unsupported information
- provide staff analysis with real tradeoffs
- stop for Kevin Dorey before outreach, negotiation, transaction, or canon write

## Non-goals

Trade Center v1 does not:

- search a league-wide roster database
- create a trade market
- contact another team
- open negotiations
- execute a transaction
- modify roster, cap, contracts, picks, transaction history, decisions, or canon
- guarantee that a trade is fair or acceptable

## Future phases

- Phase 3.3B: structured `trade_market / trade-market` resource
- Phase 3.3C: ranked finder using verified candidates and team motivations
- Phase 3.3D: dry-run and atomic transaction workflow after Kevin approval
