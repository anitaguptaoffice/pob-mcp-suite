# Status and roadmap

The server runs on immutable snapshots, isolated PoB engine processes,
durable jobs and a single feature registry.

## Shipped

| Area | State |
|---|---|
| Snapshot lifecycle | Import XML, file and share code; create builds; export and save |
| Build inspection | Build, tree, items, skills, config and cached stats |
| Mutations | Tree, mastery, spec, item set, item, gem, skill group, flask, level, config, notes |
| Calculation | Single evaluations, batch jobs, stat categories, defenses, ailments |
| Tree analysis | Native paths, nearby nodes, keyword suggestions, calculated rankings |
| Gem analysis | Compatible supports, support rankings, gem setup jobs, upgrade comparison |
| Items | Preview, affix weight, equipment analysis, shopping list, cost |
| Jewels | Cluster analysis, Watcher's Eye, jewel comparison jobs |
| Crafting | Crafting context, modifier tiers, bench modifiers, budget comparison, annul simulation |
| Economy | poe.ninja currency and item references, currency spreads, snapshot cost |
| Trade | Official international search, comparable prices, previews, weighted and budget flows |
| Persistence | History catalog, retention, local file restore |

## Known gaps

| Gap | Why it matters |
|---|---|
| Tree data refresh | The server does not re-extract upstream tree data at runtime; it uses the engine's data for the selected version |
| Timeless jewel search | Verified only for Elegant Hubris with Caspiro; other figures and keystones are not covered |
| Market coverage | Rare-item pricing relies on comparable listings; unique and gem data come from poe.ninja references |
| Crafting | No probability engine; callers must supply verified success rates and costs |
| Trade scope | International PoE 1 only; no bulk exchange or automatic purchase |

## Next

1. Broaden timeless jewel coverage and add fixtures for each supported figure.
2. Add engine-side tree data refresh without reintroducing a mutable session.
3. Extend budget flows from single-slot candidates to multi-slot bundles with
   explicit purchase evidence.
4. Add reproducible fixtures for league-specific price behaviour without
   committing live market snapshots.

Items move here only when they have a verifiable input, a reproducible output
and a test that fails when the contract breaks.
