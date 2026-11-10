---
name: pob-economy
description: Use for Path of Exile 1 international-league build budgets, item appraisal, trade comparisons, or crafting costs with the PoB MCP server.
---

# PoB economy

Use Simplified Chinese for user-facing answers and verified Simplified Chinese game terminology. Keep official item names or IDs when necessary for searches. The user plays the international realm.

1. Confirm the exact league and load the user's build in the PoB engine. Do not assume Standard when the league is unknown.
2. Use `estimate_build_cost` for public poe.ninja reference prices. Report the league, retrieval time, per-item assumptions, subtotal, and every unpriced or ambiguous item. The subtotal is not a complete build cost or a guaranteed market floor.
3. Use `estimate_comparable_item` or existing official trade search tools for individual rare items only when the user supplies or confirms the required base and stat filters. Use `search_stats` to find official IDs and include appropriate source groups. Show the exact constraints, sample size, search link and price units. Looser searches do not price the exact item.
4. For crafting instructions and probability assumptions, use the separate `pob-crafting` skill in `../pob-crafting/SKILL.md`. `compare_craft_budget` compares repeated-attempt costs only when externally verified single-attempt odds and complete per-attempt costs are provided; it is a mathematical model, not a PoE crafting simulator.
5. Clearly distinguish the item's market asking price, the estimated cost to reproduce it, and an upgrade's PoB-calculated benefit. Disabled or alternate skill groups may not all need to be purchased.

The poe.ninja source covers public economy data only. Do not call its internal builds/profile endpoints. Prices and availability change; respect source limits and caching. If data or a rate is unavailable, say so instead of estimating zero.

Trade search is optional and only advertised when `POE_TRADE_ENABLED=true` in the MCP server's environment; the Docker wrapper defaults it to `false`. Explain that the MCP server must be restarted after changing the setting. Public reference-price and craft-budget tools do not require a trade session cookie.
