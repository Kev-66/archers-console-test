# Trade Finder v2 Validation

## Required automated checks

- Parse `phase3-trade-finder-engine.js`.
- Parse `phase3-trade-center.js`.
- Run `tests/trade-finder-v2/engine-validation.cjs`.
- Run `tests/trade-finder-v2/static-validation.mjs`.
- Run the existing Backend 3.2.0 regression suite.

## Required market behaviors

- A seller with a current player market can generate an offer.
- A buyer or contender buying at that position cannot casually sell a merely listening starter.
- Unavailable players and franchise cornerstones produce no offer.
- Stale market evidence produces no offer.
- Untouchable Archers assets never appear in packages.
- Optional first-round protection excludes first-round picks.
- A search with no credible market returns zero offers without inventing targets.

## Deployment boundary

The website may deploy before market resources are populated. In that state it must report that the league market is not initialized. It must not manufacture league players, team postures, availability, or asking prices.
