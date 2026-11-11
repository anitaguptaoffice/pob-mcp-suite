# Architecture

One local MCP service over stdio, one Path of Building engine per calculation,
and one immutable snapshot store. Skills and client plugins are separate
packages that describe usage; they never compute game values.

## Layers

```
Agent skills (client-side workflow selection and reporting)
   │  call advertised tools
   ▼
MCP transport (src/index.ts)
   │  ListTools / CallTool
   ▼
Feature registry (src/server/featureRegistry.ts)
   │  schema + invoke, one owner per tool name
   ▼
Feature modules (src/features/*)
   │  validation, semantics, response shape
   ├──► Foundation (src/foundation) ──► SnapshotStore / JobStore
   │        │
   │        ▼
   │    PoB engine port (src/ports/pobEngine.ts)
   │        │
   │        ▼
   │    Adapter (src/adapters/pob) ──► headless PoB over stdio
   ├──► Official Trade port ──► official international trade API
   ├──► Economy port ──► poe.ninja
   └──► Domain rules (src/domain) ──► versioned data excerpts
```

Dependencies point downward. Feature modules do not import the Lua bridge,
the snapshot store internals or another feature's private files. Boundary tests
enforce this for the engine, modifier and trade domains.

## Agent workflows

The packaged skills separate runtime/direct operations (`pob-docker-mcp`),
whole-build diagnosis (`pob-build-review`), equipment upgrades
(`pob-gear-upgrade`), price evidence (`pob-economy`) and crafting
(`pob-crafting`). They share a recommendation evidence reference and access the
service through advertised MCP contracts, never server-private imports.

Skills choose goals, sequence calls and explain results. Features/domain rules
own deterministic comparisons, constraints and arithmetic; foundation/adapters
own engine isolation and source data. A new skill need not introduce a new
endpoint. Add a feature when a repeatable deterministic operation needs one
shared implementation, keeping source access behind the existing ports.

## Composition root

`src/index.ts` builds the stores, engine factory and official Trade adapter,
registers every feature module, and dispatches tools by exact name. The tool
list is assembled from capability groups:

| Group | Condition |
|---|---|
| Foundation and feature modules | Always |
| Official Trade | `POE_TRADE_ENABLED=true` |

The advertised list is assembled from these groups, and dispatch accepts exactly
the registered names; an unregistered name is an error, including when a
capability group is disabled.

## Snapshots

A snapshot is a content-addressed JSON record:

```json
{
  "formatVersion": 1,
  "id": "<sha256>",
  "parentId": "<sha256|null>",
  "xml": "<PoB build XML>",
  "source": "import-file:...",
  "engineVersion": "...",
  "dataVersion": "...",
  "adapterVersion": "...",
  "limitations": ["..."],
  "retention": { "kind": "trial", "expiresAt": "..." }
}
```

- Mutations create a child; the parent is never edited.
- A child ID covers its parent ID, so the whole ancestry is pinned while any
  descendant exists.
- Identity fields are creation/edit provenance, not an engine version lock.
  Existing IDs and XML remain usable after an engine update; calculations
  return the current engine identity. Children record their actual edit engine.
- Trial snapshots expire after seven days; retained snapshots never do.
- Cleanup runs at start and removes only unreferenced, expired trials.
- Store writes are atomic (write, fsync, rename).

Multiple writers are excluded by a native OS file lock on a persistent guard
inode. Process exit releases it; only markers from this guard protocol can be
automatically reclaimed. Unrecognized markers require manual recovery.
Use a local filesystem with working file locks. Jobs and history records live
in the same snapshot directory; interrupted jobs are marked on restart.

## Engine isolation

`openPoBEngine()` starts a headless PoB process and exposes a narrow port:
stats, items, skills, tree, config, preview and native lookup operations.
Startup resolves the engine checkout and opens one engine to verify the
interpreter, bridge and data; without `HeadlessWrapper.lua` or a working LuaJIT
the process exits before serving.
`BuildFoundation` composes that port with the store:

- read-only operations start an isolated engine and then exit;
- one-shot mutations derive a child, reload it, and verify the requested state
  before writing the record;
- ranking jobs evaluate each candidate in its own child and engine, so one
  failure cannot change the baseline;
- a request has a deadline (`POB_TIMEOUT_MS`); a dead process fails the request
  instead of serving stale state.

Every calculation reads an immutable snapshot, so a comparison cannot alter
another calculation or the user's open character.

## Result contract

- Engine identity and request context travel with the result.
- Snapshot creation identity never prevents recalculation with the current
  engine. Version differences are warnings; actual load errors and detected
  state loss remain failures. Original XML is never silently rewritten.
- New comparisons recalculate both sides and require consistent runtime
  identities before returning verified deltas or rankings. Historical numbers
  are not reused as a baseline.
- One-shot calculations return results directly. Existing jobs keep their
  results; no independent calculation store or upgrade API is introduced.
- Compatibility checks are bounded: active saved tree version, node IDs and
  mastery selections are checked on load; known non-default gem-quality fields
  remain warned/rejected under the existing policy. A successful load does not
  prove every historical gem, modifier or configuration field was understood.
- Missing values are `unknown`, never `0`.
- Reference prices carry source, league, timestamp and a warning that they are
  not executable.
- Trade prices distinguish instant buyout, asking price and unknown; searches
  default to `securable` plus a priced sale type.
- Heuristics are labelled unverified and list their inputs.
- Bounded samples state the bound and do not claim completeness.

## Storage layout

```
<POB_SNAPSHOT_DIRECTORY>/
  <id>.json              snapshot record
  retained/<id>.json     retention marker
  history/<id>.json      named history entry
  jobs/<job>.json        durable job state

<POB_DIRECTORY>/
  *.xml                  user build files for import, catalog and save
  .pob-mcp-presets/*.json  saved PoB configuration presets
```


## Verification

`npm run validate` builds, runs every Jest suite, validates market metadata and
checks shell syntax. Engine behaviour is covered by `tests/smoke/*` against a
real PoB process. `scripts/smoke-suite.mjs` runs the whole set in parallel on
demand; fixed numerical baselines live in `scripts/engine-regression.mjs`.
The current capability matrix is in [FEATURE_ACCEPTANCE.md](FEATURE_ACCEPTANCE.md).
Passing those layers does not prove every build, mechanic or market result; each
result keeps its own limitations.
