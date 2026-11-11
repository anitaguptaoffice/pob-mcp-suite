# Testing guide

Three layers cover different risks. Unit tests run in milliseconds and need no
engine; smoke tests start the real PoB engine and the real MCP server.

## Prerequisites

| Layer | Needs |
|---|---|
| Jest | Node.js 20+, no engine |
| Offline smoke | Compatible LuaJIT and PoB `src/` |
| Live smoke | Network access; `POE_SESSION_ID` for authenticated Trade |
| Docker smoke | Docker with access to the built image |

The engine is resolved like the server: `POB_PATH`, then an installed app, then
`vendor/PathOfBuilding/src`. `POB_CMD` selects the interpreter. Smoke tests fail
when neither the engine checkout nor LuaJIT is usable; there is no degraded mode.

## Jest

```bash
npm --prefix packages/pob-mcp test
npm --prefix packages/pob-mcp test -- tests/unit/clusterTrade.test.ts --runInBand
npm --prefix packages/pob-mcp run test:ci
```

`test` runs every `tests/**/*.test.ts`. `test:ci` adds coverage with the
thresholds in `jest.config.cjs` (75% branches, 85% functions, 80% lines).

Unit tests cover:

- foundation snapshot lifecycle, retention, job store and runner
- engine port boundaries: no feature imports the Lua bridge directly
- each feature's validation, query shape and failure disclosure
- modifier/affix resolution against PoB data excerpts
- trade query construction, source audit and price classification

Fixtures with names like `expected-*-query.json` are the query-shape baseline.
They are captured from verified behaviour and must not be regenerated from the
current build; a mismatch is a contract change that needs review.

## Smoke

```bash
npm --prefix packages/pob-mcp run test:smoke
```

Starts the real engine and checks the adapter lifecycle, state truthfulness and
one MCP stdio round trip.

| Command | Focus | Requirements |
|---|---|---|
| `test:smoke` | Bridge + stdio | Engine |
| `test:smoke:offline` | State truthfulness without MCP | Engine |
| `test:smoke:foundation` | Full snapshot/tree/item/gem/job surface | Engine |
| `test:smoke:requirements` | Startup fails without PoB or LuaJIT, succeeds with both | Engine |
| `test:smoke:build-info` | Lua build info without a tree | `luajit` on `PATH` |
| `test:smoke:trade` | Live Trade search, stats and price paths | Network |
| `test:smoke:snapshot-cost` | Snapshot cost in a stated league | Engine, network |
| `test:smoke:source-comparable` | Listing comparison with source audit | Network |
| `test:smoke:currency-reference` | poe.ninja currency output | Network |
| `test:smoke:trade-preview` | Preview listings in an isolated engine | Engine, network |
| `test:smoke:cluster-trade` | Cluster listing search | Network |
| `test:smoke:upstream-tree` | Upstream tree node reader | Network |
| `test:smoke:truthfulness` | Adapter state equals engine state | Engine |

The full foundation suite runs about fifty independent scripts. Each script owns
its temp directories and server process, so the suite runs them with bounded
parallelism:

```bash
npm run test:smoke:foundation                      # up to 4 jobs by default
node scripts/smoke-suite.mjs foundation --jobs=6   # more cores on a local machine
SMOKE_CONCURRENCY=4 npm run test:smoke:foundation  # CI setting
```

The runner prints one `ok` or `FAIL` line per script, buffers each script's
output and prints it only on failure, and applies `SMOKE_TIMEOUT_MS` per script
(15 minutes by default). On CI, set `SMOKE_CONCURRENCY` to the container's CPU
count (4 on a standard GitHub runner); memory is the limiting factor, not the
number of scripts. Both CI workflows run the suite this way, so a full run costs
one parallel pass instead of a per-script pass. Use filters or `--skip` to rerun
part of the suite:

```bash
node scripts/smoke-suite.mjs foundation gem masteries
node scripts/smoke-suite.mjs foundation --skip=foundation-requirements,foundation
```

During development, run the one script that covers your change:

```bash
node tests/smoke/foundation-cluster-analysis.mjs
```

## Engine regression

```bash
cd packages/pob-mcp
node scripts/engine-regression.mjs
```

Fixed numerical baselines (player damage, minion damage, poison-inclusive
damage, anointments, alternate ascendancies) for the pinned engine revision.
When the engine is updated, investigate the difference before editing an
expected value.

## What each layer proves

| Layer | Proves | Does not prove |
|---|---|---|
| Jest | Contracts, validation, query shapes, regressions | Engine behaviour |
| Offline smoke | Adapter and snapshot flows against a real engine | Network behaviour |
| Live smoke | Request shape and response handling against live services | Every league, item or price |
| Engine regression | Representative calculations stay stable | All builds and mechanics |

Skipped cases are reported in the summary, not counted as passes.

## Adding a test

1. Pure logic belongs in `tests/unit`, with a fake for each port it consumes.
2. Anything that needs PoB goes in `tests/smoke` and uses
   `tests/smoke/pobSource.mjs` for engine resolution.
3. Prefer asserting the exact user-visible field and the explicit unknown
   state over snapshotting a whole response.
4. Anything that changes startup dependencies belongs in
   `foundation-requirements.mjs`: the server has no degraded mode, so a missing
   engine or interpreter must fail before the transport opens.
