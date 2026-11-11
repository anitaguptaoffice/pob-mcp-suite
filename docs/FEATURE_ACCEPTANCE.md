# Feature acceptance

Each capability has one implementation and explicit inputs. Unit tests live in
`packages/pob-mcp/tests/unit/`; real-engine scripts live in
`packages/pob-mcp/tests/smoke/`. Names below omit those prefixes.

| Capability | Required behavior | Unit evidence | Real-engine evidence |
| --- | --- | --- | --- |
| Build import and export | File/XML/share-code input, exact source preservation, explicit output names and overwrite policy | `localBuildFile`, `shareCode`, `snapshotStore` | `foundation-core`, `foundation-mcp`, `foundation-tree-code` |
| Build creation | Class, ascendancy and tree version are confirmed by PoB | `buildFoundation` | `foundation-create-build` |
| Immutable revisions | Child edits preserve parent bytes; record actual edit provenance; verify reload | `buildFoundation`, `observation`, `loadFidelity` | `foundation-core`, `foundation-roundtrip`, `foundation-failures` |
| Calculations | Actual selected skill/configuration, finite metrics, explicit unknowns, current runtime identity | `buildFoundation`, `gemQualityGuard` | `foundation-core`, `foundation-minion`, `foundation-selection` |
| Comparison and isolation | Both sides recalculated; runtime drift withholds deltas; preview cannot modify a baseline | `snapshotBuildComparison`, `engineLimiter` | `foundation-mcp`, `foundation-item`, `foundation-tree-source` |
| Tree and ascendancy | Native node identity, versions, allocation, paths, masteries and explicit tree replacement | `treePaths`, `officialTreeCode`, `snapshotTreeComparison`, `snapshotTreeTransplant` | `foundation-core-tree`, `foundation-official-tree`, `foundation-tree-paths`, `foundation-mastery` |
| Skills and supports | Saved skill selection, verified gem/group edits, actual support application, measured comparisons | `skillInspection`, `snapshotGemComparison`, `snapshotSupportRanking` | `foundation-gem`, `foundation-group-toggle`, `foundation-discovered-support`, `foundation-minion` |
| Equipment, sets and flasks | Exact target slot, visible slot gates, item inventory, selected item set and active flask state | `buildFoundation`, `emptyGearSlots`, `equipmentAnalysis` | `foundation-item`, `foundation-inventory`, `foundation-item-sets`, `foundation-flask` |
| Cluster jewels | Native socket/subgraph state; local-file inspection keeps source text unchanged | `clusterAnalysis`, `clusterFile` | `foundation-cluster-analysis`, `local-cluster-file` |
| Timeless jewels | Native seed lookup, explicit scope, fixed-keystone handling and bounded sorted results | `timelessSearch` | `foundation-timeless` |
| Jewel and enchant comparisons | Explicit item/metric inputs; poison-inclusive minion damage; consistent context and identities | `watchersEye`, `jewelComparison`, `jewelComparisonContext`, `anointmentTool` | `foundation-watchers-eye`, `foundation-jewel-poison`, `foundation-jewel-comparison`, `foundation-anointment` |
| Long-running jobs | Bounded execution, durable partial results, cancellation and interrupted-state reporting | `jobRunner`, `jobStore`, `masteryJobs`, `jewelJobs`, `snapshotGemJobs`, `passiveRanking` | `foundation-mastery-job`, `foundation-gem-setup-job`, `foundation-passive-ranking`, `foundation-jewel-jobs` |
| Summary and build checks | Actual selected state, missing sections and metrics explicit; no invented overall grade | `snapshotSummary`, `buildIssues`, `snapshotLeveling`, `cachedStats` | `foundation-summary`, `foundation-issues`, `foundation-skill-inspection` |
| Defense, ailments and bosses | Native values, one-life/unknown distinctions, exact enemy conditions and labelled references | `snapshotDefenses`, `snapshotAilments`, `snapshotBossReadiness` | `foundation-defenses`, `foundation-ailments`, `foundation-enemy-config` |
| Configuration and notes | Native config whitelist, atomic presets, unrelated state preserved and exact note text | `configPresets`, `configDerivationIsolation`, `enemyConfig`, `buildFoundation` | `foundation-config-presets`, `foundation-notes` |
| Local catalog, watch and history | Nested safe paths, bounded/stable cursors, file-change observation, retained revisions and explicit restore | `buildFileCatalog`, `localBuildWatcher`, `snapshotHistory`, `restoreLocalFile` | `foundation-file-catalog`, `foundation-notes`, `foundation-retention` |
| Economy references and shopping | Exact international league, timestamps, currency anchors, active slots, bounded/unpriced evidence | `poeNinjaAdapter`, `currencyReference`, `currencySpread`, `snapshotShoppingList`, `snapshotCostTool` | `currency-reference-live`, `snapshot-cost-live`, `foundation-budget-bundle` |
| Official Trade | Securable priced searches, exact league/query, credential-isolated cache, source statistics, retry bounds and cooldown | `officialTradeAdapter`, `cache`, `tradeSearchTool`, `tradeItemPriceTool`, `sourceComparableTool`, `tradeSourceStatistics` | `trade-mcp`, `source-comparable-live`, `trade-preview-live`, `cluster-trade-live` |
| Trade comparison and budget candidates | Exact clipboard/item identity, original currencies, missing listings, verified context and bounded candidate scope | `tradePreview`, `rawTradeListingComparison`, `weightedSnapshotTrade`, `budgetCandidates`, `budgetBundle` | `foundation-weighted-trade`, `foundation-budget-bundle` |
| Modifier and crafting data | Native source identity, eligibility separate from spawn weight, verified references and caller-supplied assumptions | `modifierDataSource`, `pobItemDataSource`, `affixWeight`, `craftingContext`, `craftBudget`, `simpleAnnul` | `modifier-data`, `pob-item-data`, `foundation-crafting-context` |
| Upstream tree reference | Explicit version, original fetch time, cache refresh and raw selected node provenance | `upstreamTree` | `upstream-tree-live`, `foundation-tree-source` |
| MCP surface | Unique names, exact discovery/dispatch agreement, correct capabilities and structured errors | `featureRegistry`, `buildScriptImports`, `pobEngineBoundary`, `modifierDomainBoundary` | `foundation-requirements`, `foundation-sdk` |
| Store ownership | One writer, stable guard inode, crash recovery and unrecognized-marker preservation | `storeLock` | `store-lock`; cross-container check below |
| Docker/client startup | Registry refresh, cached fallback, digest pins, separate download budgets and stdout hygiene | `dockerWrapper` | Installed-client checks below |

## Checks

- `npm run validate`: build, unit tests, marketplace metadata and shell syntax.
- `npm --prefix packages/pob-mcp run test:smoke:core`: short real-engine gate for
  import, poison-minion DPS, derivation, export/restart/reload, tree/mastery,
  timeless lookup and native store locks. Ordinary PRs run this gate.
- `npm --prefix packages/pob-mcp run test:smoke:foundation`: full real-engine
  feature suite, available locally and through the Docker workflow's
  `full_smoke` input.
- From `packages/pob-mcp/`, run `node scripts/engine-regression.mjs`: fixed
  numerical PoB baselines and direct-engine mutation/preview checks.
- `POB_DOCKER_IMAGE=<image> node packages/pob-mcp-market/scripts/smoke-store-lock.mjs`:
  cross-container exclusion and SIGKILL recovery on a shared directory.

`scripts/engine-regression.mjs` is included in the image and also runs on every
Docker PR. The installed-client check is
`packages/pob-mcp-market/scripts/smoke-mcporter-wrapper.mjs`; it verifies discovery,
import, calculation, derivation, save and restart against an isolated directory.
It does not change the user's active image or client configuration.

## Evidence boundaries

Native PoB is the comparison oracle. Numerical baselines, state isolation,
failure cases and reload checks test different obligations. A populated response
alone does not prove correct damage or defense. A schema test does not replace
a real calculation. Unsupported game state, unrecognized item modifiers,
unverified identities and unavailable market evidence remain explicit.

Unit and container checks exercise Linux. They do not establish macOS/Windows
host behavior, every game mechanic, market availability or real-model tool use.
