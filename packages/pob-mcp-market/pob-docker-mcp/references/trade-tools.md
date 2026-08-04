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
2. Use `search_stats` with `official_sources=true` before building detailed filters. Identical text under `Explicit`, `Implicit`, `Fractured`, `Crafted`, or `Enchant` represents distinct trade stat IDs.
3. Prefer an appropriate `Pseudo` total when the official API provides one. Otherwise put compatible source variants for one semantic requirement in one `count`/`or` group.
4. Keep separate mandatory requirements in separate groups. Do not put every alternative in one global Count because two sources of one requirement can satisfy the count incorrectly.
5. Keep searches bounded with price caps, listing status, rarity, links, and stat minimums. Use `status=securable` when the user wants instant-buyout listings.
6. Prefer a small ranked shortlist over broad market dumps.
7. If recommending an item, explain what it improves and what it may cost the build.
8. Recalculate with Lua after applying pasted item text when possible.

### Source-aware stat group example

The following shape requires a corrupted maximum-cold-resistance implicit and accepts either a normal or fractured attack-block modifier. Each mandatory requirement has its own group.

```json
{
  "league": "Allflame",
  "status": "securable",
  "corrupted": true,
  "stat_groups": [
    {
      "type": "and",
      "filters": [
        { "stat_id": "implicit.stat_3676141501", "min": 2 }
      ]
    },
    {
      "type": "count",
      "min": 1,
      "filters": [
        { "stat_id": "explicit.stat_4061558269", "min": 3 },
        { "stat_id": "fractured.stat_4061558269", "min": 3 }
      ]
    }
  ]
}
```

Do not mechanically add every identical-text source. A named unique item normally needs its own explicit unique modifier, while a non-unique finished-item search often benefits from compatible Explicit/Fractured alternatives.

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
