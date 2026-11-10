# Local architecture decisions

Status: accepted direction; implementation and validation are in progress. The
existing service still uses its legacy routes and mutable Lua session.
Investigation entries below are chronological; later follow-ups supersede earlier
observations where they differ. The evidence table records current limitations.

## Scope and dependency direction

One repository, one local MCP service using stdio, and PoE 1 only. Skills are
separately maintained client guidance. No HTTP service, accounts or multi-user
model is in scope. MCP transport and feature handlers call application services;
application services use narrow build storage, engine, market and data ports.
Lua details stay inside the PoB adapter. Market and pure crafting do not require
PoB. Timeless search is a separate feature. Ascendancy and tree version fixes
belong in the adapter. Machine interfaces and internal diagnostics use English;
user explanations use Simplified Chinese.

## Independent data-source foundations

The following are separate internal adapters in the same local service. None is
required to start another adapter. Their ports expose structured, source-native
facts and typed errors; they do not implement user-facing recommendations.

| Adapter | Responsibility | Boundary |
| --- | --- | --- |
| PoB | Build snapshots, engine execution and versioned game data used by PoB | Does not assign market prices or establish crafting probabilities. |
| poe.ninja | International PoE 1 league/category snapshots and currency reference data; preserve the source, request, actual fetch time, currency and available sample metadata | Aggregated reference data is not a live purchasable listing, final build cost, or verified crafting outcome. Missing categories and provider errors remain unknown, not zero. |
| Official Trade | International league search metadata, explicit query construction and listing fetch; preserve official IDs, status, query, returned sample and actual fetch time | A listing is not evidence of a completed sale; authentication, rate limits, availability and partial results remain explicit. |
| Verified game and crafting data | Versioned source adapters for item and modifier definitions and independently verified crafting rules | PoB spawn weight alone is not a success probability. Different data sources and game versions are not silently merged. |

The market application owns appraisal policy, currency conversion assumptions,
source statistics and build budgets. Its default buyable-listing policy is the
existing international `securable` priced search; the official trade adapter must
preserve the exact requested filters rather than silently broadening them.
Cross-domain workflows explicitly compose market facts with PoB evaluation and
report missing items, partial failures and both data-source identities.

The PoB modifier-table adapter is independently available without starting the
calculation engine. It fingerprints the actual input bytes for each table and
reuses parsed data only when that fingerprint matches; it exposes table facts,
not crafting probabilities or proof of item legality.

The cache mechanism is shared infrastructure; each adapter owns its cache keys,
TTL and refresh/error policy. Cache hits retain the original provider fetch time;
a stale, partial or failed response is never presented as a fresh complete
response. Credentials and provider-specific rules stay in the relevant adapter,
not in a global domain object or skill.

Current state: existing `PoeNinjaClient`, `NinjaPrices` and trade clients remain
separate legacy implementations. The new `EconomySource` port and poe.ninja
adapter use the shared cache; `estimate_snapshot_cost` combines that source with
an explicit immutable PoB snapshot. Its pure price model is shared with the
legacy cost tool and compared in unit tests; the legacy router and client/skill
migration remain pending. The independent `OfficialTradeSource` and adapter now
back `estimate_trade_comparable`, `search_official_trade`, `sample_trade_item_price`, `search_trade_stats`
and `list_trade_leagues`.
The comparable policy and query/source-audit rules now live in feature/domain
modules without a legacy-client dependency; temporary re-exports serve old
callers until their routes are removed. Market-only tools can start without the
PoB snapshot or Lua engine; snapshot preview and build costs still require the
foundation. The economy adapter instance is shared with build-cost workflows.
Other source ports remain pending.

On 2026-11-11 a local, read-only Standard-league probe of the new adapter
successfully fetched public skill-gem and currency snapshots. The legacy
`/api/data/currencyoverview` spread endpoint returned HTTP 404 for the same
league. Preserve that typed source failure; it does not prove there are no
arbitrage opportunities, and no unverified replacement endpoint is assumed.
The opt-in `test:smoke:snapshot-cost` also exercised the new cost tool with real
PoB and all six public Standard item categories; it is a live-source check, not a
stable offline CI fixture or proof of listing availability.

On 2026-11-11 the opt-in `test:smoke:source-comparable` validated official
international league and stat metadata, a `securable` and `priced` search,
listing fetch, general and comparable searches, per-source statistics and
separate original retrieval times.
These new trade tools are advertised only when `POE_TRADE_ENABLED=true` and the
legacy router is disabled. While the legacy mutable Trade client is enabled in
compatibility mode, the new trade tools are hidden to avoid two uncoordinated
per-process rate limiters; the old trade surface remains available. Replacing
that temporary gating and retiring the legacy client are migration work.

## Contracts

- An immutable build snapshot identifies its content, source, parent, format,
  and confirmed engine, adapter and data versions. Unknown versions remain
  unknown. A file or share code is imported explicitly; future file changes do
  not modify an existing snapshot.
- Evaluation specifies snapshot, skill/configuration and metrics. Player, minion
  and full DPS are separate; missing values are unknown, not zero. Evaluation
  uses an isolated engine and reports actual versions and diagnostics.
- A typed changeset runs on an isolated copy. Publish a new snapshot only after
  the entire change succeeds and serialization is validated. Failures leave the
  parent intact. Save/export is explicit; overwrite requires explicit intent.
- Stable MCP tools expose basic build and calculation operations plus a small
  number of workflows. Domain results are structured independently of MCP.
  Registry discovery and invocation enforce the same capability checks. Never
  truncate structured payloads, XML or share codes into invalid data.
- Durable snapshots persist locally; trial candidates expire unless retained.
  Writes are atomic and a data directory has one writer. Engine workers are
  bounded (default two), each request owns its engine and reloads its baseline.
  Timeout or uncertain state discards the worker. Jobs have IDs, progress,
  cancellation and per-item results; restart marks unfinished jobs interrupted.
- Cache keys include all material inputs and versions. Each domain defines TTL;
  cache preserves original fetch timestamps, never caches failures as empty data.
- International trade defaults to the existing `securable` priced search rule.
  Preserve currencies, samples, query, source coverage and fetch time; ninja
  reference prices are not listings and PoB weights are not crafting odds.

XML serialization alone is not proven to capture every live PoB state. Until
round-trip tests establish coverage, a snapshot implementation must report its
limitations and must not promise complete reproducibility.

Retention decision: trial candidates are eligible for expiry after seven days.
Explicitly retained snapshots are durable, and their ancestors remain available
so parent links continue to resolve. Existing records predate trial metadata and
are treated as durable, never retroactively classified as trials. No expiry of
those records is implied by this decision.

Retention implementation constraints:

- Trial status must be explicit at creation; a normal import or ordinary derived
  snapshot is not reclassified merely because it is new. The default trial TTL
  is seven days. Retention state and expiry must be observable to callers.
- A retain operation must be durable and idempotent. Expiry must not invalidate
  a snapshot while an operation is using it. A first implementation may collect
  expired trials only during startup, after acquiring exclusive store ownership
  and before accepting requests; seven days is then the earliest collection time,
  not a promise of deletion at an exact instant.
- Before removing any candidate, inspect and integrity-check the entire snapshot
  graph. Protect durable and unexpired records and all their ancestors. Failure to
  read or validate the graph must abort collection without deleting anything.
  Remove eligible descendants before ancestors so an interrupted cleanup cannot
  strand a surviving child. Never infer eligibility from filenames or age alone.
- Review persisted jobs that refer to snapshots before collection: an unfinished
  or resumable job must not silently lose its inputs. Define and test that rule
  along with corruption, crash, retain/cleanup races and old-record migration.
  Until those checks exist, do not enable snapshot deletion.

The store creates trial records only when explicitly requested with `trial: true`
on a derive operation. They carry an expiry timestamp in their immutable identity;
normal imports, normal derived snapshots and old records are durable. Retaining
a snapshot writes a separate durable marker, keeping its ID stable. The explicit
file-save operation retains before writing: a failed file write may therefore
still leave the snapshot retained. `foundation_snapshot_retention` exposes the
trial expiry and explicit retention status.

Collection runs only on service startup under exclusive store ownership, before
requests. It integrity-checks the snapshot graph and retained markers, protects
roots referenced by queued/running/cancel-requested/interrupted jobs, and fsyncs
the directory after each descendant-first deletion. Unreadable or incomplete
job references skip collection; invalid snapshots or markers abort startup
before collection. Old interrupted jobs without recorded inputs therefore do
not cause their unknown snapshots to be removed. Completed, failed and cancelled
jobs are not roots. Interrupted jobs remain protected until their records are
resolved or removed. Trial expiry is an earliest collection time; a continuously
running service does not collect until its next startup.

## Migration and acceptance

### Release decision, 2026-11-11

Keep the currently deployed `main` and its default behavior unchanged throughout
the migration. Continue on the integration branch and do not merge a partial
replacement. The end state is a single local stdio service whose business
capabilities run in their appropriate new modules over the independent PoB,
poe.ninja, official Trade and game-data foundations. The old business handlers,
mutable-session router and compatibility implementation are to be removed after
their capabilities have been replaced and validated; leaving the old code as the
permanent implementation is not the goal. Do not silently lose features or the
existing correctness fixes when removing code.

Before the final direct merge to `main`, account for every entry in
`LEGACY_MIGRATION_CONTRACTS.md`, affected client/skill entry points and each
existing regression. A replacement must have a defined interface, independent
module ownership and appropriate parity/real-source evidence, including the
international `securable` price and source-statistics rules. Verify default tool
discovery and invocation, real PoB calculations, relevant market and crafting
boundaries, installed local wrapper/client behavior and the removal of obsolete
routes. Explicitly report unsupported features and unresolved decisions rather
than marking migration complete. The user authorized the final merge once this
full gate is met; this does not authorize merging a partial migration now.

Before feature migration complete the inventory and map each registered legacy
tool to its replacement, validation evidence and affected skills. Legacy tools
are isolated behind an explicit opt-in, default off, and cannot mutate the new
snapshot store. Maintain existing fixes and regression fixtures. Migrate a tool
only after contract and real-engine validation; do not silently drop a feature.

| Layer | Acceptance |
|---|---|
| Snapshot | XML, items, skills, selection, tree, masteries, config and calculated outputs round-trip against real PoB; unverified state explicitly reported |
| Isolation | failed changes, invalid inputs, crash, timeout and cancellation do not modify the original snapshot |
| Vertical slice | import, calculate, apply change to derived snapshot, export and reload; verify baseline and changed result with real engine |
| Registry | duplicate names, capability gating for discovery and direct invocation, structured outputs, opt-in legacy isolation |
| Market | league, securable priced filters, source ambiguities, currency and original fetch times preserved |
| Release | local unit/contract, real-engine and MCP end-to-end tests reported separately; no push before requested |

### Evidence and outstanding boundaries

| Requirement | Evidence | Remaining boundary |
|---|---|---|
| Import, calculate, derive, export and reload | `foundation.mjs`, `foundation-mcp.mjs`, `foundation-mastery.mjs`, `foundation-item.mjs` use real PoB; derived state is checked before publication | Only observed sections and selected metrics are compared; complete PoB state equivalence is not proven. |
| Items, skills, selection, tree and configuration | `foundation-roundtrip.mjs` and the real-engine derived-snapshot fixtures cover representative builds | Fixtures do not cover every item, skill, alternate set or configuration; gem mutation has no new contract yet. |
| Failed changes and isolation | `buildFoundation.test.ts` checks rejection and parent preservation; `foundation-failures.mjs` injects a real engine crash and a response timeout after a level change and verifies the parent and snapshot directory | Fault injection covers the tested level-change path, not every mutation. Cancellation is cooperative between job items. |
| Registry and storage ownership | `foundation-gating.mjs`, registry and store unit tests | Existing legacy behavior remains available outside foundation mode; legacy opt-in in foundation mode is transitional. |
| MCP client interoperability | `foundation-sdk.mjs` uses the official MCP SDK over stdio to list tools, import a build and calculate Life with real PoB | The user's installed client configuration and wrapper were not changed or independently exercised for foundation mode. |
| Trial retention | `snapshotRetention.test.ts`, `snapshotStore.test.ts`, `jobStore.test.ts`, `foundation-retention.mjs` and the real-engine `foundation-item.mjs` cover graph protection, interrupted cleanup, seven-day expiry, retained IDs, jobs and MCP creation | Collection runs only on restart. Interrupted job records and their inputs are retained until resolved or removed; unrecognized job references skip collection. Filesystem sync guarantees depend on the underlying filesystem. |
| Calculation context | `foundation-selection.mjs` compares two real PoB skill parts under the same enemy configuration, checks the returned context and rejects an invalid part; `buildFoundation.test.ts` rejects unconfirmed selection or config | This verifies the tested skill and config, not every skill, support or conditional mechanic. |
| Poison minion damage | `foundation-minion.mjs` compares direct PoB player/minion and poison-inclusive metrics with foundation evaluation, derives an amulet change and verifies export/reload; the snapshot guard compares minion combined DPS and Full DPS as well as other selected metrics | This checks the specified Summon Raging Spirit fixture and configuration; it does not establish all minion or ailment mechanics. |
| Existing PoB fixes | `scripts/engine-regression.mjs` passed against the local PoB image, including alternate/event ascendancy names, tree simulations, timeless jewel data and poison-inclusive minion damage | This verifies its pinned PoB fixture and checks, not every upstream version or game mechanic. |
| Tool migration | `LEGACY_TOOL_INVENTORY.md` enumerates 114 registered tools and known packaged skill references; `LEGACY_MIGRATION_CONTRACTS.md` specifies proposed replacements and acceptance cases for each; the inventory check enforces name coverage | External callers and dynamic references are unknown; proposed acceptance cases are not evidence that features have migrated or passed tests. |
| Market and source adapters | Boundaries and buyable-listing policy are specified above | New shared adapter ports and cache are not connected; no new live-market acceptance is claimed. |

The table reports evidence and limitations rather than declaring whole-layer
acceptance for behavior outside the tested fixtures.

The first delivery is foundation plus the vertical slice. Only after it passes
can feature teams migrate independently. Shared contracts, adapter and final
integration have one owner. Local stdio remains the only transport.

### Round-trip investigation (local prototype)

On the checked-in `occ-vortex.xml` fixture, the existing ordinary PoB export
changes observed item raw text in the live engine. The existing
`item_comparison_snapshot` capture does not change the observed tree, occupied
items, skills, configuration, or selected stats during capture. After reloading
its XML, strict comparison still differs for occupied items and skills; tree,
configuration and selected metrics compare equal. This observation does not
establish whether each difference is cosmetic or affects calculations. Empty
slots were excluded from the round-trip comparison because their `active` field
also changes between absent and false. No complete snapshot-fidelity claim is
valid yet. The prototype rejects derived snapshots when its full observed state
changes; its narrow example-build vertical smoke currently fails this check.
The parent snapshot remains unchanged. Investigate each difference against PoB
semantics before broadening acceptance or connecting the prototype to MCP.

The fixture's occupied-item differences are additions of defence values and
base percentile fields in item raw text. `ItemClass:BuildRaw()` emits these
from `armourData`, so they must not be dismissed without verifying subsequent
PoB parsing and calculations. The skill differences are omitted versus `false`
`includeInFullDPS`; PoB's `Calcs.lua` uses a Lua truthiness check, and the
SkillsTab loader and serializer explicitly handle that field. This establishes
why the observed values differ, but is not a blanket equivalence proof for all
build states. The foundation currently fails closed and reports the affected
sections. It also verifies that the requested level was actually applied before
attempting publication.

Follow-up: an adapter operation now preserves existing item raw text for the
restricted case where an isolated operation has not modified item objects. The
geared fixture then round-trips all observed slots, tree, skills, config and
selected stats. Observation comparison treats only three documented PoB defaults
as equivalent: absent versus false `includeInFullDPS`, absent versus 1
`mainActiveSkill`, and absent versus false `active` on empty slots. Explicit
true values and non-empty item state remain significant. This is one fixture,
not proof that arbitrary item or skill modifications are safe. The separate
level-only vertical smoke also passes; no general mutation tool is enabled.

Version protection remains partial: the foundation now records the adapter and
PoB versions reported by the bridge and refuses a known mismatch before load.
Unknown fields and the fact that these display versions are not content hashes
are included in evaluation warnings. The current adapter cannot establish the
exact engine source or game-data identity. Consequently, matching displayed
versions do not yet satisfy the full reproducibility contract, and this remains
an open acceptance item before the foundation is considered complete.

The foundation adapter now fingerprints every regular file under the resolved
PoB `src` and adapter Lua directories by path and content, twice across process
startup, and refuses a changed or unreadable tree. The snapshot stores these
fingerprints and known mismatches are rejected. Symbolic links are rejected by
this provisional implementation. Fingerprints still do not cover the LuaJIT
executable, external Lua modules, runtime directory, concurrent changes after
startup, or data outside those directories. No claim of complete environment
reproducibility follows from a match. The full source directory is large; the
cost and safe caching strategy still need measurement before MCP integration.

Follow-up: when a checkout has a sibling `runtime` directory, the adapter now
fingerprints that directory as well, checks it during startup, and stores it
separately. An unavailable runtime remains unknown. A known runtime mismatch is
rejected. This does not identify the interpreter or modules loaded from other
locations. A local warm-cache measurement of one 774 MB source-tree digest was
approximately 1.1 seconds; this is not a general performance guarantee and no
metadata-only cache is used.

The foundation MCP schema and dispatcher are implemented but deliberately not
registered yet. The snapshot directory has a new exclusive lock primitive; it
must be integrated with server startup/shutdown before tools are advertised.
A process crash can leave a lock file. Recovery must verify the owner has stopped
before removing it; the implementation does not automatically break a lock.
The current legacy server remains unchanged and is not yet the agreed final
legacy-opt-in architecture.

The local stdio server now exposes four foundation tools only when explicitly
configured with `POB_FOUNDATION_ENABLED=true`. The optional
`POB_SNAPSHOT_DIRECTORY` chooses the snapshot directory; a process owns its
writer lock for the server lifetime and drains foundation requests before normal
shutdown. A real-engine MCP smoke covers import, calculate, derive level, export
and re-import; a separate offline smoke checks disabled direct calls and lock
contention. This is experimental: legacy tools still use their existing default
routes, and the final registry/legacy isolation, full identity and job contracts
are not yet implemented. A crash may leave a stale lock requiring verified
manual recovery. No release or client migration has occurred.

Local regression: `npm run validate` passed (93 suites and 634 tests passed;
2 suites and 14 tests skipped). The real-engine foundation vertical smoke also
passed for both `example-build.xml` and the geared `occ-vortex.xml`, checking
level-derived snapshots, parent XML and re-imported Life, EnergyShield and
selected player/minion damage fields. These observations do not establish
coverage for all build states or replace the remaining acceptance items.

Compatibility transition: setting `POB_FOUNDATION_ENABLED=true` now advertises
only foundation tools and rejects direct legacy calls and legacy resources.
Set `POB_LEGACY_ENABLED=true` alongside it to expose legacy tools explicitly.
For existing installations that have not enabled foundation mode, the original
legacy default remains unchanged until the foundation passes the full release
acceptance and the final migration is announced. Legacy mutable bridge state is
separate from the foundation's disposable engines and snapshot store.

The experimental foundation interface also imports PoB share codes. It bounds
encoded and expanded input, checks base64 and UTF-8, and then validates the XML
by loading it into an isolated PoB engine. The real-engine MCP vertical smoke
covers importing the same XML directly and via a generated share code. External
share-code URLs and download services are outside this interface.

The foundation now has a durable job-record store. It serializes per-job
updates, records each item and distinguishes cancellation requested from
cancelled. On startup, after obtaining the snapshot writer lock, it marks
previously unfinished jobs interrupted without resuming them. Initialization
failure releases the acquired lock. The runner, active-engine cancellation,
progress API and MCP job tools remain unimplemented; job status alone must not
be presented as evidence that a computation was started or stopped.

A bounded batch-evaluation runner now persists each input and result and waits
for an in-flight item before completing cancellation. Shutdown waits for both
submissions and active jobs; a submission racing with shutdown is cancelled
before execution. This runner is not yet registered with MCP. It cannot kill a
running PoB request; cancellation latency is therefore bounded by the current
request's own timeout and cleanup, not immediate.

Follow-up: the experimental foundation MCP surface now registers batch submit,
job read and cooperative cancellation tools. A real-engine MCP smoke checked a
batch containing one successful calculation and one invalid snapshot, including
per-item results. Cancellation and shutdown races have unit coverage; immediate
termination of an active PoB request remains unimplemented. `completed` means
all items finished processing and can include failed items, which remain visible
in their individual statuses.

A generic bounded in-memory cache primitive is available but is not yet wired
to market or calculation code. It coalesces concurrent loads, retains the
original value and source timestamp, does not cache failures, and prevents an
invalidated in-flight request from repopulating the cache. Callers must construct
complete keys, keep one TTL policy per key and treat cached values as immutable.
No PoB-source fingerprint cache has been introduced: its invalidation and
correctness requirements remain unresolved.

Foundation MCP now reads individual snapshot metadata and lists snapshots in
ID order with a cursor and a maximum page size of 50. Import and derive return
metadata rather than repeating XML; XML remains available through the explicit
export tool. Each listed entry is integrity-checked. The cursor is a position,
not a frozen inventory: snapshots inserted before it while paging will not
appear in the remaining pages.

Foundation evaluation now returns the snapshot ID, the raw PoB stats, an
explicit available/unknown result for each requested numeric metric, the
observed build, skill and configuration context, identity and warnings. A zero
is retained as zero; missing, boolean, non-numeric and non-finite values are
unknown. This records the selected context from the snapshot; changing the
selection as part of a request is not yet implemented.

Follow-up: single foundation evaluations can now override the selected skill
group/effect/part and PoB configuration in a disposable engine. Invalid or
rejected options fail the call rather than returning a partly configured result.
The returned context reflects the applied selection and configuration. The
real-engine MCP smoke verifies a selected group and boss setting, and repeats
the baseline afterwards to confirm the snapshot was unchanged. Batch jobs do
not yet accept per-item evaluation options.

Batch evaluation items now accept the same `selection` and `config` options as
a single evaluation. Options are validated before job creation and copied so
the persisted input and execution input remain aligned. A real-engine MCP smoke
verifies a batch item's skill group and boss configuration. Cancellation is
still cooperative between items; active-engine termination remains unverified.

Batch item records now distinguish pending, running, completed, failed and
interrupted. A restarted service marks an in-flight item interrupted while
preserving unstarted items. Real PoB MCP tests cover cancellation during a
running item and service shutdown while work is running: the current item
finishes, the next remains pending, and a second writer is denied until the
first service releases the directory lock. Cancellation remains cooperative.

On POSIX, the adapter now resolves the executable using the child working
directory and PATH, launches the resolved file, and fingerprints its contents
before and after startup. Snapshots carry this additional identity and known
mismatches fail before loading. Windows executable resolution remains unknown.
Scripts may invoke other interpreters and dynamic/external modules are not fully
fingerprinted; a matching executable hash is therefore not a complete runtime
identity. A real-engine MCP smoke verified the snapshot exposes the executable
and source hashes, and unit tests cover PATH resolution and mismatch handling.

The foundation MCP surface now supports importing a named local XML build from
the configured build directory. Reads are bounded, require valid UTF-8 and
check resolved paths remain under that directory. Import creates a snapshot;
later file changes do not update it. Unit tests cover nested names, traversal,
external symlinks and size/encoding limits. A real-engine MCP smoke confirms
that modifying the source file after import leaves the exported snapshot intact.

The experimental foundation can explicitly save a snapshot to the configured
local build directory. Existing files are not replaced unless `overwrite` is
true; the writer uses atomic file replacement and does not create missing
parent directories. The returned flag records permission to overwrite, not a
claim that an existing file was replaced. Unit tests cover concurrent no-clobber
writes and path handling; a real-engine MCP smoke saves and re-imports the file.

The experimental `foundation_inspect` reads requested build, tree, items,
skills and configuration from one isolated snapshot, returning identity and
compatibility warnings. Sections are explicit, duplicates and unknown sections
are rejected before engine startup, and the whole result is returned without
character truncation. The real-engine MCP smoke covers all five sections; this
is a snapshot-state query, not yet the versioned passive/item data API.

The experimental foundation can search passive nodes in the tree loaded from a
specific snapshot. Results carry the observed tree version and engine identity;
the default excludes allocated nodes. The underlying PoB operation yields an
unordered bounded set, so reaching the limit is reported as possibly truncated,
not as a ranked or complete result. Real-engine MCP and default-filter tests
pass. This does not yet cover versioned item or gem data APIs.

The foundation can query PoB's compatible support candidates for a selected
snapshot skill group. The result includes selected skill, bounded candidate
list, total matches, failed compatibility checks and engine identity. It is not
a damage ranking or a claim of market availability. The real-engine MCP test
uses the existing Vortex fixture to check one compatible and one incompatible
support; other skill families still need their own coverage.

The foundation now exposes the PoB item modifier spawn-weight operation in a
snapshot-bound disposable engine, including its data identity and item-level
eligibility when known. A real-engine MCP test checked a nonzero amulet weight,
a zero ring weight and a level restriction. These are weights, not crafting
probabilities or legality/availability proofs; missing eligibility remains null.

The adapter now rechecks its source, adapter, runtime and executable digests
before returning a calculation/query result and immediately before publishing a
snapshot. Detected changes fail the operation; unit tests verify that neither a
result nor a new snapshot is published on mismatch. This adds a third full
source-tree scan per engine operation. It does not detect transient changes
between checks, and external dependencies and wrapper interpreters remain out
of scope. The real-engine MCP vertical smoke passes with this check enabled.

For local verification, run `npm run validate` to build, check that every legacy
schema is represented in the inventory, run unit tests and validate the plugin.
After configuring a compatible `POB_PATH` and `POB_CMD`, run
`npm --prefix packages/pob-mcp run test:smoke:foundation` for gating, real-engine
round trips, the two-fixture foundation slice and stdio MCP integration. The
latter is intentionally separate from the baseline because it starts multiple
PoB processes and hashes the source tree repeatedly; it is not a live-market or
installed-client validation. Report skipped or unavailable checks separately.

The foundation now supports a typed configuration-derived snapshot in addition
to the level-derived snapshot. It requires PoB to report every requested config
change as applied, verifies the observed values and round-trips all observed
sections before publication. Any rejected or unconfirmed change fails without
publishing. The real-engine MCP smoke checks a boss configuration on the new
snapshot and confirms the parent remains unchanged; item and gem mutation
contracts remain unimplemented.

The foundation can derive a snapshot with explicit passive-node additions and
removals. It compares the actual allocation to the exact requested set, rejects
unexpected node loss, changed class/tree version or unrequested mastery changes,
and requires the normal observed-state round trip before publication. Empty Lua
mastery tables may serialize as `[]`; only that empty representation is treated
as equivalent to an empty map. Real-engine MCP tests added a reachable path,
removed it in a further snapshot and confirmed the original tree and parent
snapshot remained unchanged. Selecting or changing mastery effects is not yet
supported by this derived operation.

The experimental foundation can derive a snapshot by changing effects of
already allocated mastery nodes. It first verifies each requested effect against
PoB's options, then checks the actual node set, class/tree version and all
mastery selections before round-trip publication. New mastery allocation and
full game legality are not asserted. A real-engine 3.29 fixture verifies a
known Life Mastery effect change changes Life, preserves the parent and rejects
an invalid effect. The dedicated smoke has been added to the local foundation
acceptance command; this test exercised the foundation API, not MCP dispatch.

The foundation MCP surface now also returns PoB's effect options for allocated
mastery nodes, including snapshot and tree version. The real PoB mastery smoke
checks the returned option text and effect ID, derives the change both directly
and through MCP, and confirms the resulting snapshot IDs match. The existing
PoB options operation only enumerates allocated masteries; querying or safely
allocating a previously unallocated mastery remains unimplemented.

Follow-up: a snapshot-bound PoB query can read the effects of an allocated or
unallocated mastery node. `foundation_derive_tree` now accepts effects for new
masteries only when they are included in the requested additions and PoB reports
those effect IDs. It still requires exact observed node and mastery state and a
full observed-state round trip. This does not establish complete game legality.
The real-engine mastery smoke verifies query, allocation and MCP dispatch on a
manual-level build, and rejects an invalid effect. For an auto-level build the
same operation is currently rejected when PoB changes the level after reload;
no snapshot is published. Handling auto-level semantics remains unresolved.

Follow-up on auto level: the desktop PoB frame invokes
`EstimatePlayerProgress`, whereas the headless tree-update path did not. The
foundation now calls that PoB method after isolated tree/mastery changes when
automatic level is enabled, then recalculates before round-trip verification.
The real-engine 3.29 mastery fixture now passes in both auto and manual level
modes; auto mode remains enabled and the parent snapshot is unchanged. If the
upstream estimator is unavailable or any later round-trip differs, the change
still fails without publication. This does not prove all possible auto-level
builds behave identically.

Follow-up: `foundation_derive_item` equips an item in a specified PoB slot in
an isolated engine, verifies that PoB selected the new item and that the other
observed slots did not change, then applies the same capture and reload checks
before publishing a child snapshot. Changes that legitimately affect other
slots are currently rejected; support for them is not asserted. A real PoB
fixture verifies a ring's Life change, unchanged parent, incompatible slot
rejection and MCP dispatch. This is not a validation of item trade or crafting
legality, and gem mutation remains unimplemented.
