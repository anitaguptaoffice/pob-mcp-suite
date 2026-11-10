# Trade Tool Workflows

Use this reference when the user asks for prices, market searches, shopping lists, or gear upgrades.

## Availability

Trade tools are environment-gated.

- If `POE_TRADE_ENABLED=false`, official Trade tools are not advertised; do not
  claim their listing prices. Public poe.ninja reference tools may still work,
  but their aggregates are not verified purchasable listings.
- If trade tools are enabled, results are still time-sensitive and league-sensitive.
- Always state the league when interpreting trade data.

## Snapshot and independent-source workflow

Use these tools when advertised; check the schemas rather than assuming legacy
tool arguments carry over. They do not share a mutable loaded build.

1. Confirm the exact international league; `list_trade_leagues` lists official
   choices but does not select one for the user. Import a build and keep its
   snapshot ID when a PoB comparison is needed.
2. Use `search_trade_stats` for official stat IDs and their source groups. For
   compatible alternatives use separate `count` or `or` groups per required
   stat. Source IDs with identical text are not automatically interchangeable.
3. Use `search_official_trade` for a bounded search. It defaults to
   `status: securable` and `sale_type: priced`; it does not accept `online_only`.
   Check the actual returned query, `listingScope`, source times, missing IDs,
   source audit and `inexact`. A different requested status must remain explicit.
4. Use `estimate_trade_comparable` for a confirmed rare base and stat groups,
   or `sample_trade_item_price` for a confirmed item name. Both sample at most
   ten asking prices, preserve currencies separately, and default to the
   securable priced search. They are comparable samples, not exact appraisals.
   `estimate_snapshot_cost` is a separate poe.ninja reference subtotal, not an
   instant-buyout quote or proof that a complete build can be purchased.
5. Use `compare_official_trade_listings` to inspect raw listings; its price
   does not establish securable status. For a PoB comparison, use
   `preview_trade_listings` with the snapshot ID, exact league and slot, the
   original `searchId` and up to five IDs from that search. For a pasted item use
   `foundation_preview_item`. Review each result, original currency, fetch time
   and `parseDiagnostics`; unsupported modifiers, item legality, sockets,
   requirements and current listing availability need separate checks.

`search_resistance_listings` bounds each candidate by the supplied per-item
budget; it does not prove a set of purchases fits a combined budget or report
net resistances after replacement. `search_cluster_listings` locally checks at
most 30 fetched results; an empty filtered sample is not an empty market.
`list_snapshot_equipment` requires a snapshot and exact league; it reports the
active item set and optional reference prices, not a complete shopping plan.

## Legacy tool selection

On a server that advertises only legacy tools, use `get_leagues`, `search_stats`,
`search_trade_items`, `get_item_price` and the legacy comparison tools. Their
loaded build is separate from a snapshot. When available, the independent-source
tools above take precedence and the legacy `online_only` alias must not be
passed to `search_official_trade`.

## Search Workflow

1. Confirm league, budget, item slot, and mandatory stats.
2. Use `search_trade_stats` before building detailed filters, or legacy `search_stats` with `official_sources=true` when the new tool is unavailable. Identical text under `Explicit`, `Implicit`, `Fractured`, `Crafted`, or `Enchant` represents distinct trade stat IDs.
   For offline PoB-name or abbreviation lookup, `search_bundled_stat_mappings`
   searches the bundled alias catalog independently. Its candidate IDs are
   unverified and may be obsolete or invalid; do not build a Trade query until
   each ID and its source have been confirmed against current official metadata.
   To explore PoB-generated weights, use `generate_snapshot_weighted_trade` with
   explicit higher-is-better metrics. Check `weightBaselines`: PoB may combine
   player and minion output for unprefixed damage metrics, and its FullDPS
   fallback can differ by candidate. `search_snapshot_weighted_trade` requires
   authenticated Trade access and uses `securable` plus `priced`. Weighted
   results are candidates; use PoB previews to verify actual replacement gains.
3. Prefer an appropriate `Pseudo` total when the official API provides one. Otherwise put compatible source variants for one semantic requirement in one `count`/`or` group.
4. Keep separate mandatory requirements in separate groups. Do not put every alternative in one global Count because two sources of one requirement can satisfy the count incorrectly.
5. Keep searches bounded with price caps, listing status, rarity, links, and stat minimums. For this user, default to `status=securable` for instant-buyout listings; sellers may be offline. `available` also includes in-person trades, while `online` is in-person only.
6. Prefer a small ranked shortlist over broad market dumps.
7. If recommending an item, explain what it improves and what it may cost the build.
8. Preview a candidate with `preview_trade_listings` or `foundation_preview_item` when available; use legacy `compare_equipment_candidate` only for the loaded legacy build. Verify socket and requirement changes separately.

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

1. Import the build and inspect its snapshot equipment, or load it when using the legacy server.
2. Identify the weakest slot or the user-selected slot.
3. Search with constraints that preserve required stats such as attributes, resistances, suppression, or gem levels.
4. Apply or simulate one item at a time.
5. Report before/after DPS, EHP, resistances, and any lost utility.

## Price Guidance

Do not treat trade search output as complete market truth.

- State whether results are instant-buyout or in-person; instant-buyout sellers may be offline.
- Mention the currency and league.
- Avoid extrapolating from tiny sample sizes.
- For crafted rares, report comparable listing ranges instead of a single exact value.
