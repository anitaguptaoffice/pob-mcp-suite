# Recommendation evidence

Shared by the build-review and gear-upgrade skills. Read this contract before
performing those workflows; read detailed tool references only as needed.

## Baseline

Discover the connected MCP schemas. Only advertised tools are available. The
runtime skill covers connection and import details. Reuse an explicit snapshot
or import a specified source, then keep its ID for the whole comparison.

Record the saved main skill/group, active passive spec, active item/weapon set,
tree version and enemy/configuration. Use the saved scenario unless the task
calls for another; any changed scenario is explicit and gets its own trial.
Saved XML values are labelled historical observations, not current PoB output.

Use a metric relevant to the selected skill: player, minion and full damage
outputs can overlap. Poison-inclusive minion comparisons need a metric that
includes that damage. Read unknown values and context before comparing numbers.

## Candidate evidence

Start each independent candidate from the same baseline. Current comparison
modules recalculate their observations and check runtime identity. Mixed or
unknown identities, changed scenarios, failed candidates and missing metrics
must remain visible; do not turn an unverified result into a confident ranking.

An edit must be confirmed by state readback and survive reload. If a result is
unchanged, inspect the intended item/gem/node/config before assuming the edit
failed. Skill compatibility alone is not an upgrade, and a successful tool
response alone is not confirmation that every requested change took effect.

For defense, compare the relevant physical/elemental/chaos maximum hits,
recovery and avoidance rather than deriving a universal survival score from
TotalEHP. For gear, verify attributes, costs/reservation, links and critical
mechanics when observations are available. Unknown constraints do not become
satisfied constraints. Numerical gains do not prove in-game legality or uptime.

Each gain is measured relative to its own baseline. Candidate interactions
require a combined trial; individual gains and percentages are not additive.
Search bounds and partial jobs limit the claim: state what was inspected, not
that the whole space was optimized.

## Output and persistence

Lead with the actionable finding. Present baseline/scenario, measured changes,
tradeoffs and uncertainty. Market recommendations also carry exact league,
currency, query/link, source time, price evidence and unpriced expenses. Preserve
trial IDs so the user can choose a result. Trial versions expire after seven
days unless retained. Diagnosis and trial generation do not authorize a file
overwrite, purchase or external message.

Explain findings in Simplified Chinese, using established Chinese game names
and short explanations for beginners. Check https://poedb.tw/cn/ when a precise
game name is uncertain. Keep technical identifiers and raw tool data unchanged.

## Ownership

- Skills select goals, obtain material missing inputs, sequence tools and
  explain observations. They carry no independent damage or market model.
- Feature/domain modules own repeatable calculations, constraint validation,
  candidate/budget arithmetic, job state and evidence fields.
- Foundation and adapters own immutable revisions, isolation, serialization,
  engine identities, official listing data and poe.ninja reference data.

A new skill can reuse existing modules without a new server endpoint. Add a
feature only when a deterministic operation is missing or a repeated tool
sequence needs a shared contract; keep it behind the existing ports and registry.
