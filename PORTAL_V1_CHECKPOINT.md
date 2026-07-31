# Archers Portal v1 Checkpoint

This checkpoint contains the first reviewable Portal and app-foundation implementation.

- Replaces the visual Overview layout with the Archers Portal.
- Preserves compatibility IDs required by the current live base console.
- Reads state, Decision Queue, players, staff, Transaction Ledger, canon events and schedule.
- Adds Needs Your Attention, Staff Briefing, Calendar, Team Pulse, recent activity and Quick Launch.
- Adds a contract-derived Squad Planner outlook foundation.
- Adds a read-only continuation prompt copier.
- Adds shared app configuration and route helpers.
- Converts the Phase Three loader to ordered asset manifests.
- Adds static and JavaScript regression checks.

No Supabase migration, Edge Function deployment, franchise write or canon change is included.
