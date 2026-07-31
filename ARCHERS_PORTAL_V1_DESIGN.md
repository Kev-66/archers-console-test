# Archers Portal v1 and App Foundation

## Purpose

The Archers Portal replaces the former Overview tab as Kevin Dorey's permanent franchise home screen. It is designed to serve both the hosted console and the eventual Tauri Windows application without changing the authoritative Supabase backend.

The Portal answers one question first:

> What requires Kevin's attention now, and where should he go next?

## Current v1 scope

The Portal reads and combines:

- current franchise state
- active structured Decision Queue
- player resources
- staff resources
- structured Transaction Ledger
- recent canon events
- Archers schedule

It performs no franchise write.

### Portal rooms

- Franchise status strip
- Needs Your Attention
- Staff Briefing
- Upcoming Calendar
- Team Pulse
- Squad Planner Outlook foundation
- Recent Activity
- Quick Launch
- Continue Franchise prompt preparation

## Canon and presentation boundaries

- Supabase remains authoritative.
- Displayed values are pointers and summaries, not permission to bypass fresh authoritative reads before a consequential action.
- The Portal never invents staff dialogue or recommendations.
- Staff Briefing cards are evidence-based operational summaries attributed to a desk or recorded source.
- Deferred decisions do not appear as active attention items.
- The Portal never invents Kevin Dorey's dialogue, choices, promises, commitments or actions.
- Copying a continuation or review prompt performs no canon write.
- Consequential writes remain inside the dedicated authenticated Draft a Dynasty GPT.

## Existing-console compatibility

Portal v1 is layered over the current Phase Three console while preserving the DOM identifiers used by the base state and league renderers. Hidden compatibility anchors prevent the existing realtime code from failing while the old Overview layout is replaced.

All existing operations rooms remain available:

- Weekly Ops
- Game Day
- Roster
- Front Office
- Draft Capital
- Transaction Center and Ledger
- Trade Finder
- League
- Schedule
- Archive

## App-ready foundation

`archers-app-config.js` establishes the first shared application boundary:

- application identity and version
- Supabase public endpoint configuration
- franchise and season identifiers
- shared read-only client construction
- stable route helper
- local-storage namespace

`index-phase3.html` now declares stylesheet and script assets through ordered manifests instead of one long hard-coded injection string. The hosted console still loads the Phase Two base during this transition, but the new manifest is an intermediate step toward one bundled desktop entry point.

## Squad Planner foundation

Portal v1 does not create the full Squad Planner tab. It derives a first positional-control view from current active-roster contracts:

- players currently in each position room
- players controlled into 2027
- current final-year pressure
- rooms with no verified 2027 control

The full Squad Planner will later add role hierarchy, depth, developmental players, emergency options, medical reliability, scheme fit, replacement urgency and multi-season views.

## Future desktop boundary

The eventual Tauri application should package the same frontend modules and continue to use the remote Supabase backend. Deployment credentials and administrative secrets must never be bundled into the application.

Portal and ordinary interface changes should remain web-compatible until the native shell is introduced. Native-only capabilities such as window state, notifications, offline cache and application updates should live behind a desktop adapter rather than being embedded directly into franchise logic.
