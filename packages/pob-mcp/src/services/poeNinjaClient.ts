/**
 * poe.ninja API Client
 *
 * Fetches real-time currency rates and item prices from poe.ninja
 */

interface CurrencyRate {
  currencyTypeName: string;
  chaosEquivalent: number;
  pay?: {
    value: number;
    count: number;
    listing_count: number;
  };
  receive?: {
    value: number;
    count: number;
    listing_count: number;
  };
  detailsId: string;
}

// New API format (poe1/api/economy/exchange/current)
interface NewCurrencyLine {
  id: string;
  primaryValue: number;
  volumePrimaryValue?: number;
  maxVolumeCurrency?: string;
  maxVolumeRate?: number;
  sparkline?: {
    totalChange: number;
    data: number[];
  };
}

interface NewCurrencyItem {
  id: string;
  name: string;
  image: string;
  category: string;
  detailsId: string;
}

interface NewCurrencyRate {
  id: string;
  pay?: number;
  receive?: number;
  primaryValue: number;
  secondaryValue: number;
}

interface NewCurrencyOverview {
  core: {
    items: NewCurrencyItem[];
    rates: Record<string, NewCurrencyRate>;
    primary: string;
    secondary: string;
  };
  lines: NewCurrencyLine[];
  items: NewCurrencyItem[];
}

interface CurrencyOverview {
  lines: CurrencyRate[];
  currencyDetails: Array<{
    id: number;
    name: string;
    tradeId?: string;
  }>;
}

/**
 * poe.ninja changed its economy endpoint from named `lines` with
 * `chaosEquivalent` to parallel item/rate collections. Normalize both shapes
 * at the boundary so callers do not need to care which API generation replied.
 */
export function normalizeCurrencyOverview(data: unknown): CurrencyOverview {
  const overview = data as Partial<NewCurrencyOverview & CurrencyOverview>;
  if (Array.isArray(overview.lines) && overview.lines.length > 0 && 'currencyTypeName' in overview.lines[0]) {
    return overview as CurrencyOverview;
  }

  const items = Array.isArray(overview.items) ? overview.items : [];
  const rates = Array.isArray(overview.lines) ? overview.lines : [];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const rateById = new Map(rates.map((rate) => [rate.id, rate]));
  const chaosItem = items.find((item) => item.name === 'Chaos Orb');
  const chaosRate = chaosItem ? rateById.get(chaosItem.id) : undefined;
  // Fragment responses quote directly in chaos but omit a Chaos Orb line.
  const chaosPrimaryValue = chaosRate?.primaryValue ?? (overview.core?.primary === 'chaos' ? 1 : undefined);

  if (typeof chaosPrimaryValue !== 'number' || !Number.isFinite(chaosPrimaryValue) || chaosPrimaryValue <= 0) {
    throw new Error('poe.ninja API response did not contain a usable Chaos Orb rate');
  }

  const lines: CurrencyRate[] = [];
  for (const rate of rates) {
    const item = itemById.get(rate.id);
    const chaosEquivalent = rate.primaryValue / chaosPrimaryValue;
    if (!item?.name || !Number.isFinite(chaosEquivalent) || chaosEquivalent <= 0) continue;
    lines.push({
      currencyTypeName: item.name,
      chaosEquivalent,
      detailsId: item.detailsId,
    });
  }

  return {
    lines,
    currencyDetails: items.map((item, index) => ({ id: index, name: item.name, tradeId: item.detailsId })),
  };
}

/**
 * Client for fetching data from poe.ninja API
 */
export class PoeNinjaClient {
  private baseUrl = 'https://poe.ninja/poe1/api/economy/exchange/current';
  private cache = new Map<string, { data: CurrencyOverview; timestamp: number }>();
  private cacheTTL = 300000; // 5 minutes

  /**
   * Get currency rates for a league
   */
  async getCurrencyRates(league: string): Promise<CurrencyOverview> {
    const cacheKey = `currency:${league}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    const url = `${this.baseUrl}/overview?league=${encodeURIComponent(league)}&type=Currency`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'pob-mcp-server/1.0',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`poe.ninja API request failed (${response.status}): ${await response.text()}`);
    }

    const data = normalizeCurrencyOverview(await response.json());
    this.putInCache(cacheKey, data);
    return data;
  }

  /**
   * Build a currency exchange rate map (all rates in chaos equivalent)
   */
  async getCurrencyExchangeMap(league: string): Promise<Map<string, number>> {
    const data = await this.getCurrencyRates(league);
    const rateMap = new Map<string, number>();
    rateMap.set('Chaos Orb', 1.0);
    for (const line of data.lines) {
      if (line.currencyTypeName && line.chaosEquivalent > 0) {
        rateMap.set(line.currencyTypeName, line.chaosEquivalent);
      }
    }
    return rateMap;
  }

  /**
   * Get from cache if not expired
   */
  private getFromCache(key: string): CurrencyOverview | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    return null;
  }

  /**
   * Put data in cache
   */
  private putInCache(key: string, data: CurrencyOverview): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }
}
