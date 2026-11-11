**Accepted decisions:** [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md). The remainder describes the earlier proposal and current prototype; where it conflicts, the accepted decisions take precedence.

# Architecture and parallel development

**Status: proposal for discussion, not an approved design.** The registry is a
working prototype, not an agreement to migrate all modules in this form. See
the Chinese discussion draft in [ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md).

## Scope and current state

The repository provides a PoE 1 MCP server, a bundled Path of Building engine,
and a separately packaged client plugin and skills. The server is a single
process with a serialized Lua bridge; a parallel team does not make a single
live PoB build safe for concurrent mutations.

Current code is partly modular: `packages/pob-mcp/src/features/` contains
focused features, while `server/toolRouter.ts`, `server/toolSchemas.ts`,
`adapters/pob/bridge.ts`, and `lua/pob_ops.lua` remain shared integration points.
The registry in `server/featureRegistry.ts` is the first incremental migration:
two always-available crafting tools register their schema and handler together.
Legacy and capability-gated tools retain their existing routes. This is not yet
a complete module system or an authorization mechanism.

## Dependency direction

```
MCP transport / feature registry / composition root
       |                         |
       v                         v
feature application logic   client skills (usage guidance only)
       |
       +--> narrow PoB operations --> isolated or serialized bridge --> PoB
       +--> trade / price ports --> international Trade API / poe.ninja
       +--> pure crafting and analysis rules --> versioned evidence
```

Feature code owns domain behavior, input validation, output semantics, and its
tests. The transport owns tool names, serialization, availability and truncation.
Adapters own external I/O and version-specific conversions. Skills explain when
and how to call tools; they are not a source of game calculations.

## Contracts to preserve

1. **PoB:** identify the engine/build/configuration, keep missing metrics
   unknown, serialize calls to one bridge, and use isolated snapshots for
   comparisons. Simulations must be checked against actual PoB changes and
   must not mutate the live build. Explicit mutations must report partial state.
2. **Trade and prices:** require the international league, preserve official
   query constraints, status, currencies, sample count, provenance and actual
   retrieval time. Default to `securable` for the user's instant-buyout search;
   do not treat an aggregated poe.ninja reference as a verified listing.
3. **Crafting:** carry the input item state, version, mechanic, assumptions and
   probability source. Unknown legality or odds remain unknown; a PoB weight
   or mathematical model is not by itself a crafting probability.
4. **MCP migration:** the user permits changing tool names and wire formats for
   a coherent new design. Document old-to-new mappings, affected clients and
   skills, and any temporary compatibility period before applying changes.
   A registered tool must have one authoritative schema, handler,
   availability policy and truncation policy. Detect duplicate names and test
   direct invocation as well as advertisement. Do not treat `toolGate.ts` as
   permission enforcement; it is currently a no-op.
5. **Language:** internal contracts, errors, test cases and structured output
   default to English; explain results in Simplified Chinese to the user.

## Migration plan

1. Establish the registry using the two pure crafting tools and verify that
   advertisement and dispatch remain compatible. This first step is implemented.
2. Add capability-aware registrations and composition-root checks before moving
   Lua- or Trade-dependent tools. Test every availability combination, hidden
   direct calls, duplicate names and non-truncated raw data.
3. Extract narrow engine, market and crafting contracts from working use cases.
   Move one vertical slice at a time, retaining a temporary legacy router.
4. Consolidate shared data types and adapter code only after callers and real
   engine tests have migrated. Do not duplicate protocol IDs or game rules.

## Parallel ownership

Each writer uses a separate worktree based on an agreed integration commit.
Workers own feature-local files and corresponding tests; the integrator alone
owns shared schemas, router, bridge, Lua operations, lockfiles, workflows,
registry and final integration. Interface changes are proposed and merged by
the integrator before dependent work begins. Keep local commits local until
the user requests the agreed batch publication.

Independent workstreams once the contracts are accepted:

- **Engine and analysis:** snapshot fidelity, PoB calculation comparisons,
  passive and gem simulations. Never share a mutable Lua process across workers.
- **Trade and economy:** official search semantics, source statistics, cache
  provenance and price comparison. Keep market data separate from crafting odds.
- **Crafting and item data:** verified modifier sources, item state, bounded
  simulator mechanics and explicit evidence; use independent modules.
- **Skills and documentation:** separate guides for economy and crafting,
  updated against accepted tool contracts rather than duplicating logic.

## Acceptance

Record results and skips separately for: (1) feature unit and contract tests;
(2) real PoB engine comparison and non-mutation controls; (3) MCP discovery,
invocation, errors, gating and truncation through the integrated server;
(4) optional read-only live international market checks; and (5) the installed
local wrapper, selected image and an actual client call. `npm run validate`
is the repository baseline, not a substitute for the applicable live layers.
