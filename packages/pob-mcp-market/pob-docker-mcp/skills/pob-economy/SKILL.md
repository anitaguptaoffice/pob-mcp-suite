---
name: pob-economy
description: Use for Path of Exile 1 international-league build budgets, item appraisal, trade comparisons, or crafting costs with the PoB MCP server.
---

# PoB economy

Use Simplified Chinese for user-facing answers and verified Simplified Chinese game terminology. Keep official item names or IDs when necessary for searches. The user plays the international realm.

1. Confirm the exact league. Do not assume Standard when the league is unknown. When `estimate_snapshot_cost` is advertised, import the build to an immutable snapshot and use its ID. The legacy mutable build and a foundation snapshot are separate states.
2. Use `estimate_snapshot_cost` for public poe.ninja reference prices when available; otherwise, if the legacy `estimate_build_cost` is advertised, load the build in the legacy engine and use that tool. Report the league, actual source fetch times, partial failures, per-item assumptions, subtotal, and every unpriced or ambiguous item. The subtotal is not a complete build cost or a guaranteed market floor.
3. For market appraisals and shopping recommendations, default to official Trade `status=securable`: this means instant buyout through the seller's hideout even when the seller is offline. `available` mixes instant buyout and in-person trading; `online` is in-person trade. `sale_type=priced` alone does not imply instant buyout. Label any explicitly requested alternative and never substitute it silently. poe.ninja prices are aggregated market references, not verified instant-buyout listings.
4. Use `estimate_trade_comparable` when advertised, otherwise use legacy `estimate_comparable_item` or official trade search, for individual rare items only when the user confirms the required item class/base and stats. For a named item, prefer `sample_trade_item_price` when advertised, otherwise `get_item_price`; distinguish item variants and report currencies separately. For other concrete searches prefer `search_official_trade` when advertised, otherwise `search_trade_items`. Find IDs with `search_trade_stats` when available, otherwise `search_stats`. Prefer an appropriate Pseudo total, or put compatible Explicit/Fractured/Crafted/Implicit alternatives for each requirement in its own OR/Count group. Keep different requirements separate, audit omitted sources and constraints, and do not add incompatible variants blindly. For ordinary jewels use Any Jewel unless a specific base is required; distinguish attack-block from spell-block. Show exact constraints, sample size, search link, price units and actual retrieval times. Looser searches do not price the exact item.
5. For crafting instructions and probability assumptions, use the separate `pob-crafting` skill in `../pob-crafting/SKILL.md`. `compare_craft_budget` compares repeated-attempt costs only when externally verified single-attempt odds and complete per-attempt costs are provided; it is a mathematical model, not a PoE crafting simulator.
6. Clearly distinguish the item's market asking price, the estimated cost to reproduce it, and an upgrade's PoB-calculated benefit. Disabled or alternate skill groups may not all need to be purchased.

When `preview_trade_listings` is advertised, compare up to five official
listings against the same immutable snapshot using the search ID and listing
IDs. Show failures, fetch time, the unchanged currency, and PoB's parsing
diagnostics. A listing price does not prove instant-buyout eligibility; check
the originating search and current availability. For a pasted item without a
listing, use `foundation_preview_item` when available.

The poe.ninja source covers public economy data only. Do not call its internal builds/profile endpoints. Prices and availability change; respect source limits and caching. If data or a rate is unavailable, say so instead of estimating zero.

For currency reference values, use `reference_currency_rates` when advertised,
otherwise `get_currency_rates`. For a reference conversion chain, use
`simulate_reference_currency_chain` when advertised, otherwise
`calculate_trading_profit`. A reference-price round trip is not an executable
arbitrage profit; report source time and missing steps, and check live prices,
spreads and fees before any trading recommendation.

For spread screening, use `screen_currency_spreads` when advertised, otherwise
`find_arbitrage`. Treat stash aggregates as unverified leads, not instant-buyout
offers; report the sampled currency scope, quote times and limits, and confirm
actual availability and transaction costs independently.

Trade search is optional and only advertised when `POE_TRADE_ENABLED=true` in the MCP server's environment; the Docker wrapper defaults it to `false`. Explain that the MCP server must be restarted after changing the setting. Public reference-price and craft-budget tools do not require a trade session cookie.
