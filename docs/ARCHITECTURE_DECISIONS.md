# Architecture decisions

Accepted decisions for the current service. They describe what the code does.

## One service surface

**Decision.** Every tool is registered once with a schema and an invoke function
in `src/server/featureRegistry.ts`, and dispatched by exact name.

**Why.** One registry makes advertisement and dispatch the same source of truth,
so a name cannot resolve differently between discovery and invocation.

**Consequence.** A capability group contributes one set of names; a call outside
that set fails with an unknown-tool error, and the advertised set is the served
set.

## Immutable, content-addressed snapshots

**Decision.** Every build state is a JSON record addressed by the SHA-256 of its
content, including its parent ID. Mutations create children.

**Why.** Addressing a snapshot by its content, including its parent, makes every
result reproducible: the ID pins the XML, engine identity and limitations.
Deriving a child instead of editing a parent keeps earlier results valid.

**Consequence.** Trial snapshots expire after seven days unless retained.
Cleanup never removes an ancestor of a live child. Writes are atomic and
serialized by a store lock.

## Isolated engine processes

**Decision.** Calculations start a headless PoB process per unit of work and
close it afterwards. Each unit of work gets a fresh process.

**Why.** A hang or crash is contained, and a candidate evaluation cannot change
the baseline. This is required for fair rankings.

**Consequence.** Each evaluation pays process startup. Long rankings are jobs,
not single calls. A request deadline is enforced per engine request.

## Unknown is not zero

**Decision.** Missing metrics, unavailable graphs, unparsed modifiers and
unfetched prices stay explicitly unknown with a reason.

**Why.** A zero that means "not calculated" produces wrong claims about
resistances, DPS and cost. The service must not invent values.

**Consequence.** Responses carry `metrics`/`status` objects rather than bare
numbers where availability can vary. Tests assert the unknown state.

## Engine identity travels with results

**Decision.** A result includes the engine version, data version, adapter
version and the snapshot ID that produced it.

**Why.** Numerical differences between PoB revisions are expected; without
identity they look like bugs.

**Consequence.** Jobs reject comparisons whose baseline identity differs from
the candidate's.

## Trade evidence policy

**Decision.** Searches default to `status: securable` and a priced sale type.
`~price` (instant buyout), `~b/o` (asking price) and missing/unknown prices are
reported separately. Every result carries source time and the exact query.

**Why.** An asking price is not an executable buyout, and an aggregated market
reference is not a listing.

**Consequence.** Price tools can return a sample with no usable buyout and say
so. They never describe reference data as profit.

## Crafting needs caller-verified inputs

**Decision.** The crafting tools carry item state, assumptions and supplied
success rates. They do not infer game probabilities.

**Why.** A PoB spawn weight is not a crafting probability, and an unversioned
model would present guesses as facts.

**Consequence.** `compare_craft_budget` compares costs only from inputs the
caller can defend. `simulate_simple_annul` requires a confirmed explicit
modifier list and no special rules.

## Bounded search, explicit sample

**Decision.** Listing tools fetch a stated maximum and report the bound.
Cluster checks inspect the fetched text locally and say the trade link is
broader than the sample.

**Why.** A price from three listings is not the market.

**Consequence.** Tools that sample cannot be described as complete appraisals.

## Two-port data boundary

**Decision.** Official Trade and poe.ninja are separate ports with separate
adapters. Market reference data never substitutes for a listing.

**Why.** They have different freshness, authentication and semantics.

**Consequence.** A comparable search never silently falls back to poe.ninja,
and a price report names its source.

## Snapshot-only analysis entry point

**Decision.** Build analysis takes a snapshot ID; file paths are only used by
explicit import and restore tools.

**Why.** Path-based analysis re-read the file mid-comparison and could analyse
a different build than the one evaluated.

**Consequence.** Callers import first, then reuse the returned ID.

## Language boundary

**Decision.** Tool names, schemas, errors, logs, test assertions and serialized
fields are English. User-facing explanations are Simplified Chinese, with
established Chinese game terms and the original identifier when useful.

**Why.** Machine interfaces must stay stable and unambiguous; users need
readable explanations.

**Consequence.** Do not translate protocol identifiers or rename fields for
presentation.

## Module boundaries

`src/index.ts` is the composition root: it resolves the engine, opens the store,
builds one feature registry and serves stdio. Tool implementations live in
`src/features`, engine and data access in `src/adapters`, interfaces in
`src/ports`, invariants in `src/domain`, and snapshot, job and engine
orchestration in `src/foundation`. `src/server` holds the registry and schema
types used by those groups.
