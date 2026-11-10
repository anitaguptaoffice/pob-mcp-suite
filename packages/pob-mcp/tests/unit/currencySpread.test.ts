import { createCurrencySpreadTool } from '../../src/features/currencySpread/tool.js';
import { PoeNinjaClient } from '../../src/services/poeNinjaClient.js';
import type { EconomySource } from '../../src/ports/economySource.js';

const fetchedAt = '2026-01-01T00:00:00.000Z';
const side = (value: number, from: number, to: number) => ({ value, pay_currency_id: from, get_currency_id: to, count: 3, listing_count: 5, sample_time_utc: fetchedAt });
const payload = { currencyDetails: [{ id: 1, name: 'Chaos Orb' }, { id: 2, name: 'Test Orb' }], lines: [
  { currencyTypeName: 'Test Orb', pay: side(0.01, 2, 1), receive: side(110, 1, 2) },
] };
const source = (body = payload) => ({ read: jest.fn(async () => ({ source: 'poe.ninja' as const, query: { kind: 'currency-spread' as const, league: 'Standard' }, fetchedAt, payload: body })) }) as unknown as EconomySource;

describe('currency spread screening', () => {
  it('uses pay and receive in the correct direction and does not invent profit for a normal spread', async () => {
    const result = JSON.parse((await createCurrencySpreadTool(source()).invoke({ league: 'Standard', min_gain_percent: 0 })).content[0].text);
    expect(result.quotes[0]).toMatchObject({ name: 'Test Orb', sellChaos: 100, buyChaos: 110 });
    expect(result.candidates).toEqual([]);
    expect(result.listingScope).toBe('stash_aggregate_unverified'); expect(result.fetchedAt).toBe(fetchedAt);
  });
  it('reports coherent legs and theoretical results for crossed inputs', async () => {
    const crossed = { ...payload, lines: [{ ...payload.lines[0], receive: side(90, 1, 2) }] };
    const result = JSON.parse((await createCurrencySpreadTool(source(crossed)).invoke({ league: 'Standard' })).content[0].text);
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    expect(candidate.currencies).toEqual(['Chaos Orb', 'Test Orb', 'Chaos Orb']);
    expect(candidate.legs).toEqual([{ from: 'Chaos Orb', to: 'Test Orb', multiplier: 1 / 90 }, { from: 'Test Orb', to: 'Chaos Orb', multiplier: 100 }]);
    expect(candidate.factor).toBeCloseTo(100 / 90); expect(candidate.theoreticalGainPercent).toBeCloseTo((100 / 90 - 1) * 100);
  });
  it('rejects missing and reversed quote directions rather than claiming no opportunities', async () => {
    const reversed = { ...payload, lines: [{ ...payload.lines[0], pay: side(0.01, 1, 2) }] };
    await expect(createCurrencySpreadTool(source(reversed)).invoke({ league: 'Standard' })).rejects.toThrow('No usable two-sided spread');
    const noDetails = { ...payload, currencyDetails: [] };
    await expect(createCurrencySpreadTool(source(noDetails)).invoke({ league: 'Standard' })).rejects.toThrow('Chaos Orb ID');
  });
  it('repairs the same direction error in the legacy calculation', async () => {
    const client = new PoeNinjaClient();
    jest.spyOn(client, 'getCurrencyRatesWithSpread').mockResolvedValue({ lines: [{ currencyTypeName: 'Test Orb', detailsId: 'test', chaosEquivalent: 100, pay: { value: 0.01, count: 3, listing_count: 5 }, receive: { value: 110, count: 3, listing_count: 5 } }], currencyDetails: [] });
    expect(await client.findArbitrageOpportunities('Standard', 0)).toEqual([]);
  });
});
