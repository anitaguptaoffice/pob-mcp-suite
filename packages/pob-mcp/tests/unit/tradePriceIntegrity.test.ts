import { describe, expect, it, jest } from '@jest/globals';
import { handleFindResistanceGear, handleGetItemPrice } from '../../src/handlers/tradeHandlers.js';
import { ItemRecommendationEngine } from '../../src/services/itemRecommendationEngine.js';
import type { TradeApiClient } from '../../src/services/tradeClient.js';

describe('instant-buyout price integrity', () => {
  it('requires the exact league before making a trade request', async () => {
    const searchItems = jest.fn();
    await expect(handleGetItemPrice({ tradeClient: { searchItems } as unknown as TradeApiClient }, { item_name: 'Test' })).rejects.toThrow('exact international league');
    expect(searchItems).not.toHaveBeenCalled();
  });
  it('uses instant buyout and reports grouped sample prices with an even median', async () => {
    const searchItems = jest.fn(async (_league: string, _query: unknown) => ({ id: 'query', result: ['a', 'b', 'c', 'd'], total: 100, inexact: true }));
    const fetchItems = jest.fn(async () => [
      { listing: { price: { amount: 2, currency: 'chaos' } } },
      { listing: { price: { amount: 4, currency: 'chaos' } } },
      { listing: { price: { amount: 0.005, currency: 'divine' } } },
      { listing: { price: { amount: 0, currency: 'chaos' } } },
    ]);
    const result = await handleGetItemPrice({ tradeClient: { searchItems, fetchItems } as unknown as TradeApiClient }, { item_name: 'Test', league: 'Standard' });
    const query = searchItems.mock.calls[0][1] as any;
    expect(query.query.status.option).toBe('securable');
    expect(query.query.filters.trade_filters.filters.sale_type.option).toBe('priced');
    expect(result.content[0].text).toContain('Median: 3 chaos');
    expect(result.content[0].text).toContain('0.005 divine');
    expect(result.content[0].text).toContain('近似匹配');
    expect(result.content[0].text).toContain('不是成交价');
    expect(result.content[0].text).toContain('/Standard/query');
  });
  it('discloses an inexact search even if it has no results', async () => {
    const client = { searchItems: async () => ({ id: 'q', result: [], total: 0, inexact: true }) } as unknown as TradeApiClient;
    const text = (await handleGetItemPrice({ tradeClient: client }, { item_name: 'Test', league: 'Standard' })).content[0].text;
    expect(text).toContain('近似匹配');
    expect(text).toContain('/Standard/q');
  });
});

describe('resistance recommendation integrity', () => {
  it('never recommends one item above the entire budget', async () => {
    const findResistanceGear = jest.fn(async (_gaps: unknown, _budget: unknown) => []);
    const context = { tradeClient: {} as TradeApiClient, recommendationEngine: { findResistanceGear } } as unknown as Parameters<typeof handleFindResistanceGear>[0];
    await handleFindResistanceGear(context, { league: 'Standard', max_price_per_item: 50, total_budget: 10 });
    expect(findResistanceGear.mock.calls[0][1]).toMatchObject({ maxPricePerItem: 10, totalBudget: 10 });
  });

  it('respects instant-buyout and budget currency, excluding invalid and mixed prices', async () => {
    const searchItems = jest.fn(async (_league: string, _query: unknown) => ({ id: 'q', total: 4, result: ['a', 'b', 'c', 'd'], inexact: true }));
    const item = { explicitMods: ['+30% to Fire Resistance'] };
    const fetchItems = jest.fn(async () => [
      { item, listing: { price: { amount: 2, currency: 'chaos' } } },
      { item, listing: { price: { amount: 1, currency: 'divine' } } },
      { item, listing: { price: { amount: 0, currency: 'chaos' } } },
      { item, listing: { price: { amount: 30, currency: 'chaos' } } },
    ]);
    const engine = new ItemRecommendationEngine({ searchItems, fetchItems } as unknown as TradeApiClient);
    const result = await engine.findResistanceGear({ fire: 30, cold: 0, lightning: 0, chaos: 0 }, { maxPricePerItem: 20, totalBudget: 100, currency: 'chaos' }, 'Standard', ['Ring 1']);
    const query = searchItems.mock.calls[0][1] as any;
    expect(query.query.status.option).toBe('securable');
    expect(query.query.filters.trade_filters.filters.price).toMatchObject({ option: 'chaos', max: 20 });
    expect(result).toHaveLength(1);
    expect(result[0].costBenefit.efficiency).toBe(15);
    expect(result[0].warnings?.join(' ')).toContain('近似匹配');
  });
  it('uses the chosen currency without presenting divine prices as chaos efficiency', async () => {
    const searchItems = jest.fn(async (_league: string, _query: unknown) => ({ id: 'q', total: 1, result: ['a'] }));
    const fetchItems = jest.fn(async () => [{ item: { explicitMods: ['+30% to Fire Resistance'] }, listing: { price: { amount: 2, currency: 'divine' } } }]);
    const engine = new ItemRecommendationEngine({ searchItems, fetchItems } as unknown as TradeApiClient);
    const result = await engine.findResistanceGear({ fire: 30, cold: 0, lightning: 0, chaos: 0 }, { maxPricePerItem: 3, totalBudget: 3, currency: 'divine' }, 'Standard', ['Ring 1']);
    expect((searchItems.mock.calls[0][1] as any).query.filters.trade_filters.filters.price.option).toBe('divine');
    expect(result[0].costBenefit.efficiency).toBe(15);
    expect(result[0].costBenefit.pointsPerChaos).toBeUndefined();
    expect(result[0].reasons.join(' ')).not.toContain('chaos');
  });

  it('counts fractured and hybrid resistance, preserves negatives and ignores conditions and maximum caps', () => {
    const engine = new ItemRecommendationEngine({} as TradeApiClient);
    const extract = (engine as unknown as { extractResistances(item: unknown): unknown }).extractResistances.bind(engine);
    expect(extract({ explicitMods: ['+30% to Fire and Cold Resistances', '-10% to Cold Resistance', '+40% to Fire Resistance while stationary', '+5% to maximum Fire Resistance'], fracturedMods: ['+12% to all Resistances'] }))
      .toEqual({ fire: 42, cold: 32, lightning: 12, chaos: 12 });
  });
});
