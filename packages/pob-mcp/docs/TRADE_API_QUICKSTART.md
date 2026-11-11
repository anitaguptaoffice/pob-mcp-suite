# Official Trade guide

The Trade tools query the official international Path of Exile 1 trade site.
They are disabled by default.

## Enable

```json
{
  "env": {
    "POE_TRADE_ENABLED": "true",
    "POE_SESSION_ID": "<POESESSID cookie value>",
    "POE_RATE_LIMIT_PER_SECOND": "4"
  }
}
```

Restart the server after changing the environment. `POE_SESSION_ID` is only
needed for endpoints that require a login; never commit it.

## Pricing contract

- Searches default to `status: securable` and `sale_type: priced`. Both can be
  overridden explicitly, and the response then labels the result accordingly.
- `~price` (instant buyout) and `~b/o` (asking price) are reported separately.
  An asking price is not an executable buyout.
- Unverified listings, missing prices and failed searches are counted, not
  converted to zero.
- A sample is a sample. `sample_trade_item_price` returns at most ten listings;
  `estimate_trade_comparable` returns grouped statistics, not an appraisal.
- Currency conversion uses `reference_currency_rates`, which is reference data
  from poe.ninja with a timestamp. It is not a tradeable rate.

## Find stat IDs

```json
{ "name": "search_trade_stats", "arguments": { "query": "maximum life", "limit": 10 } }
```

Results are grouped by identical display text with their source
(`explicit`, `implicit`, `fractured`, `crafted`, `enchant`). Pick the source
that matches the item; searching the wrong source silently misses modifiers.

## Search listings

```json
{ "name": "search_official_trade", "arguments": {
  "league": "Standard",
  "item_type": "Gold Ring",
  "item_rarity": "rare",
  "mods": [{ "stat_id": "explicit.stat_3299347043", "min": 40 }],
  "min_price": 2, "max_price": 10, "price_currency": "chaos",
  "sort": "price_asc", "limit": 5
} }
```

Use `stat_groups` for `and` / `or` / `not` / `count` / `weight` logic. A count
group needs a range that can be satisfied; contradictory ranges are rejected
before any request is sent.

`list_trade_leagues` returns the exact league names currently accepted.

## Compare or preview

```json
{ "name": "estimate_trade_comparable", "arguments": {
  "league": "Standard",
  "base_type": "Hubris Circlet",
  "stat_groups": [{ "type": "and", "filters": [
    { "stat_id": "explicit.stat_3299347043", "min": 40 }
  ] }]
} }
```

```json
{ "name": "preview_trade_listings", "arguments": {
  "snapshot_id": "<id>", "league": "Standard", "slot": "Helmet",
  "search_id": "<from search_official_trade>",
  "item_ids": ["<listing id>", "<listing id>"]
} }
```

`preview_trade_listings` fetches up to five listings, compares each exact
clipboard item in an isolated engine and reports per-item failures. It does not
rank or prove an upgrade.

## Snapshot-driven flows

| Tool | Use |
|---|---|
| `search_resistance_listings` | Resistance targets with a per-item and total budget |
| `search_cluster_listings` | Cluster size, enchant and exact notable names |
| `generate_snapshot_weighted_trade` | Build a PoB weighted query from explicit metric weights |
| `search_snapshot_weighted_trade` | Run that query against official Trade |
| `screen_snapshot_budget_candidates` | Search within a chaos budget and preview candidates |
| `assemble_snapshot_budget_bundle` | Sum selected explicit chaos buyouts and compare the combined trial |

## Rate limits and caching

- Client-side throttle: `POE_RATE_LIMIT_PER_SECOND` (default 4).
- Responses are cached per query; the response reports the source time.
- On `429`, wait for the reported interval and retry. Do not loop.
- `POE_SESSION_ID` must be present for authenticated searches; a missing cookie
  is an error, not an empty result.

## Limitations

- International PoE 1 only; console and Chinese realms differ.
- Listings can expire between search and fetch.
- Prices exclude fees, availability and negotiation.
- No automatic purchase, whisper or bulk exchange.
