import { createCurrencySpreadTool } from '../../src/features/currencySpread/tool.js';
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
  it('screens two-currency loops beyond the first 20 currencies while keeping results bounded', async () => {
    const ordinary = Array.from({ length: 20 }, (_, i) => ({ id: i + 2, name: `A${String(i).padStart(2, '0')}` }));
    const expanded = { currencyDetails: [{ id: 1, name: 'Chaos Orb' }, ...ordinary, { id: 99, name: 'Z Profitable' }], lines: [
      ...ordinary.map(item => ({ currencyTypeName: item.name, pay: side(0.01, item.id, 1), receive: side(110, 1, item.id) })),
      { currencyTypeName: 'Z Profitable', pay: side(0.01, 99, 1), receive: side(50, 1, 99) },
    ] };
    const result = JSON.parse((await createCurrencySpreadTool(source(expanded)).invoke({ league: 'Standard', limit: 1 })).content[0].text);
    expect(result.selectedCurrencies).not.toContain('Z Profitable');
    expect(result.quotes).toHaveLength(21);
    expect(result.candidates[0].currencies).toContain('Z Profitable');
    expect(result.totalCandidates).toBeGreaterThan(result.returnedCount);
    expect(result.returnedCount).toBe(1);
  });
  it('does not invent a quote when one side of a spread is missing', async () => {
    const missing = { ...payload, lines: [{ ...payload.lines[0], receive: undefined as any }] };
    await expect(createCurrencySpreadTool(source(missing)).invoke({ league: 'Standard', min_gain_percent: 0 })).rejects.toThrow('No usable two-sided spread');
  });
  it('labels screening as unverified aggregate data instead of executable profit', async () => {
    const crossed = { ...payload, lines: [{ ...payload.lines[0], receive: side(90, 1, 2) }] };
    const result = JSON.parse((await createCurrencySpreadTool(source(crossed)).invoke({ league: 'Standard' })).content[0].text);
    expect(result.listingScope).toBe('stash_aggregate_unverified');
    expect(result.warnings.join(' ')).toContain('not verified instant-buyout offers');
    expect(result.warnings.join(' ')).toContain('Two-currency loops cover all usable currencies');
    expect(result).not.toHaveProperty('profit');
    expect(result.candidates[0]).not.toHaveProperty('profitPercent');
    expect(result.candidates[0]).toHaveProperty('theoreticalGainPercent');
  });
  it('rejects a source above the supported screening bound and out-of-range limits', async () => {
    const names = Array.from({ length: 1001 }, (_, i) => ({ id: i + 2, name: `Bulk ${String(i).padStart(4, '0')}` }));
    const huge = { currencyDetails: [{ id: 1, name: 'Chaos Orb' }, ...names], lines: names.map(item => ({ currencyTypeName: item.name, pay: side(0.01, item.id, 1), receive: side(110, 1, item.id) })) };
    await expect(createCurrencySpreadTool(source(huge)).invoke({ league: 'Standard' })).rejects.toThrow('supported 1000-currency screening limit');
    await expect(createCurrencySpreadTool(source()).invoke({ league: 'Standard', limit: 51 })).rejects.toThrow('valid screening options');
  });
});
