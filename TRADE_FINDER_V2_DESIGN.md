# Draft a Dynasty Trade Finder v2

## Status

Phase 3.3B and 3.3C read-only website feature.

## Product goal

Trade Finder v2 replaces the manual-first Trade Center workflow with an NBA 2K-style league offer generator.

The normal user flow is:

1. Choose one position.
2. Choose the desired role.
3. Optionally narrow the search to one team.
4. Mark Archers players and picks as Available, Consider, or Untouchable.
5. Run the finder.
6. Review complete generated offers.

The user does not manually enter a target's OVR, age, development trait, cap hit, contract years, or market tier during the normal flow.

## Market truth

Searching the entire league does not make the entire league available.

A generated offer requires:

- a current player-specific market entry;
- a team posture that provides a credible reason to engage;
- a target who meets the requested position and role;
- an Archers package that matches the other team's current preferences;
- a package that clears the market's value and complexity requirements.

A valid search may return no offers.

The finder must never manufacture availability merely because two numerical values can be balanced.

## Team posture

Supported team postures:

- `BUYER`
- `SELLER`
- `HOLD`
- `HYBRID`
- `REBUILDER`
- `CONTENDER`

Posture can be position-specific through buying and selling position arrays.

A buyer or contender that is also buying at the target's position will not normally move that player unless the player is explicitly marked `ACTIVELY_SHOPPED` or `AVAILABLE`.

## Player market status

Supported player statuses:

- `ACTIVELY_SHOPPED`
- `AVAILABLE`
- `LISTENING`
- `UNLIKELY`
- `UNAVAILABLE`
- `FRANCHISE_CORNERSTONE`

Missing players are not assumed available.

`UNAVAILABLE` and `FRANCHISE_CORNERSTONE` never generate offers.

`UNLIKELY` may generate only expensive proposals.

## Archers asset policy

Every current Archers player and draft asset has one browser-local policy:

- `AVAILABLE`: preferred by the package generator.
- `CONSIDER`: used only when required to reach a credible package.
- `UNTOUCHABLE`: excluded from all generated packages.

The policy board is not canon and performs no database write.

## Offer generation

For each eligible target, the engine:

1. Calculates the target's market value from football profile, contract, availability, and team posture.
2. Scores Archers assets differently for the other team's current needs and preferences.
3. Excludes untouchable assets and optional protected first-round picks.
4. Searches combinations of up to four outgoing assets.
5. Produces Value, Balanced, and Strong package variants when credible combinations exist.
6. Ranks offers by market tier, roster fit, evidence confidence, and cost.

The generated package is a heuristic proposal, not a prediction that the other team would accept.

## Results

Results are grouped into:

- Credible Offers
- Possible, but Expensive or Uncertain
- No Current Market

The finder reports matching indexed players that had no active market instead of converting them into fake offers.

## Data sources

The website reads:

- `cff_teams`
- current Archers player resources
- `draft_capital / draft-capital`
- `league_player_index / league-player-index`
- `team_market_state / team-market-state`
- `trade_market / trade-market`
- current franchise cap and week context

All three market resources use `visibility: CONSOLE`.

The browser performs no Supabase write.

## Staff handoff

Each offer can generate a read-only staff-review prompt.

The prompt requires the Custom GPT to verify current resources, distinguish verified and stale information, explain the other team's incentives, and stop for Kevin Dorey before outreach, negotiation, a Decision Queue creation, a transaction, or any canon write.

## Specific-player fallback

A collapsed fallback can evaluate a manually named player.

The fallback is explicitly speculative and assigns `MODEL_INFERENCE` evidence with `UNLIKELY` availability. It does not establish a market.

## Non-goals

Trade Finder v2 does not:

- create league rosters;
- infer that every player is obtainable;
- contact another team;
- open negotiations;
- create a Decision Queue item;
- execute a trade;
- modify players, contracts, cap, draft assets, transactions, or canon;
- guarantee acceptance.

## Future transaction phase

A later transaction workflow may add verified outreach, negotiation state, dry-run multi-record effects, Kevin approval, and an atomic trade operation. That phase remains separate from this read-only finder.
