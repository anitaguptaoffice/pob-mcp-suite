# Trade Tool Workflows

Use this reference when the user asks for prices, market searches, shopping lists, or gear upgrades.

## Availability

Trade tools are environment-gated.

- If `POE_TRADE_ENABLED=false`, do not claim live prices.
- If trade tools are enabled, results are still time-sensitive and league-sensitive.
- Always state the league when interpreting trade data.

## Tool Selection

- Use `get_leagues` before searching when the league is unclear.
- Use `search_stats` to find trade stat identifiers before building detailed stat filters.
- Use `search_trade_items` for concrete item searches.
- Use `get_item_price` for simple price checks.
- Use `find_item_upgrades`, `find_resistance_gear`, and `generate_shopping_list` only after loading or identifying the build.
- Use `compare_trade_items` when the user provides two specific options.

## Search Workflow

1. Confirm league, budget, item slot, and mandatory stats.
2. Keep searches bounded with price caps, online filters, rarity, links, and stat minimums.
3. Prefer a small ranked shortlist over broad market dumps.
4. If recommending an item, explain what it improves and what it may cost the build.
5. Recalculate with Lua after applying pasted item text when possible.

## Upgrade Workflow

1. Load the build and inspect equipped items.
2. Identify the weakest slot or the user-selected slot.
3. Search with constraints that preserve required stats such as attributes, resistances, suppression, or gem levels.
4. Apply or simulate one item at a time.
5. Report before/after DPS, EHP, resistances, and any lost utility.

## Price Guidance

Do not treat trade search output as complete market truth.

- Mention whether results are online-only.
- Mention the currency and league.
- Avoid extrapolating from tiny sample sizes.
- For crafted rares, report comparable listing ranges instead of a single exact value.
