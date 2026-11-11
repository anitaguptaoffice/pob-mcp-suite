import { createCurrencyReferenceTools, readCurrencyRates } from '../../src/features/currencyReference/tools.js';
import type { EconomySource } from '../../src/ports/economySource.js';

const fetchedAt = '2026-01-01T00:00:00.000Z';
const payload = { core: { primary: 'chaos' }, items: [{ id: 'divine', name: 'Divine Orb', detailsId: 'divine-orb' }, { id: 'exalted', name: 'Exalted Orb', detailsId: 'exalted-orb' }], lines: [{ id: 'divine', primaryValue: 120 }, { id: 'exalted', primaryValue: 20 }] };
const makeSource = () => ({ read: jest.fn(async () => ({ source: 'poe.ninja' as const, query: { kind: 'currency' as const, league: 'Standard' }, fetchedAt, payload })) });

describe('currency reference workflows', () => {
  it('preserves legacy chaos quotes and anchors a non-chaos primary currency to its actual chaos line', () => {
    const snapshot = { source: 'poe.ninja' as const, query: { kind: 'currency' as const, league: 'Standard' }, fetchedAt, payload };
    expect(readCurrencyRates({ ...snapshot, payload: { lines: [{ currencyTypeName: 'Divine Orb', chaosEquivalent: 120 }] } }, 'Standard').rates).toEqual([
      { name: 'Divine Orb', id: null, chaosValue: 120 }, { name: 'Chaos Orb', id: 'chaos', chaosValue: 1 },
    ]);
    const modern = { core: { primary: 'divine' }, items: [{ id: 'chaos', name: 'Chaos Orb' }, { id: 'divine', name: 'Divine Orb' }], lines: [{ id: 'chaos', primaryValue: 0.01 }, { id: 'divine', primaryValue: 1 }] };
    expect(readCurrencyRates({ ...snapshot, payload: modern }, 'Standard').rates).toContainEqual({ name: 'Divine Orb', id: 'divine', chaosValue: 100 });
    expect(() => readCurrencyRates({ ...snapshot, payload: { ...modern, lines: [modern.lines[1]] } }, 'Standard')).toThrow('no usable Chaos Orb reference');
  });
  it('normalizes source rates and retains source time and quote currency', async () => {
    const source = makeSource();
    const [ratesTool] = createCurrencyReferenceTools(source as EconomySource);
    const result = JSON.parse((await ratesTool.invoke({ league: 'Standard' })).content[0].text);
    expect(result.rates).toContainEqual(expect.objectContaining({ name: 'Divine Orb', chaosValue: 120 }));
    expect(result.rates).toContainEqual(expect.objectContaining({ name: 'Exalted Orb', chaosValue: 20 }));
    expect(result.rates).toContainEqual({ name: 'Chaos Orb', id: 'chaos', chaosValue: 1 });
    expect(result.fetchedAt).toBe(fetchedAt);
    expect(result.warnings.join(' ')).toContain('not executable');
  });
  it('reports a partial chain with no invented final result when a rate is missing', async () => {
    const [, tool] = createCurrencyReferenceTools(makeSource() as EconomySource);
    const result = JSON.parse((await tool.invoke({ league: 'Standard', currency_chain: ['Divine Orb', 'Chaos Orb', 'Missing', 'Divine Orb'], start_amount: 2 })).content[0].text);
    expect(result).toMatchObject({ complete: false, reason: 'missing_rate', missingRates: ['Missing'], lastKnown: { currency: 'Chaos Orb', amount: 240 }, result: null });
    expect(result.steps).toHaveLength(1);
    expect(result).not.toHaveProperty('profit');
  });
  it('does not claim an arbitrage profit from reference rates and validates before requests', async () => {
    const source = makeSource(); const [, tool] = createCurrencyReferenceTools(source as EconomySource);
    const result = JSON.parse((await tool.invoke({ league: 'Standard', currency_chain: ['Divine Orb', 'Chaos Orb', 'Divine Orb'] })).content[0].text);
    expect(result.complete).toBe(true); expect(result.result.amount).toBe(1); expect(result).not.toHaveProperty('profit');
    source.read.mockClear();
    for (const args of [{ league: '', currency_chain: ['A', 'B'] }, { league: 'Standard', currency_chain: ['A'] }, { league: 'Standard', currency_chain: ['A', 'B'], start_amount: 0 }, { league: 'Standard', currency_chain: ['A', 'B'], extra: true }]) await expect(tool.invoke(args)).rejects.toThrow();
    expect(source.read).not.toHaveBeenCalled();
  });
  it('fails closed on duplicate names and mismatched source provenance', async () => {
    const source = makeSource();
    const [tool] = createCurrencyReferenceTools(source as EconomySource);
    source.read.mockResolvedValueOnce({ source: 'poe.ninja', query: { kind: 'currency', league: 'Hardcore' }, fetchedAt, payload });
    await expect(tool.invoke({ league: 'Standard' })).rejects.toThrow('provenance');
    source.read.mockResolvedValueOnce({ source: 'poe.ninja', query: { kind: 'currency', league: 'Standard' }, fetchedAt, payload: { ...payload, items: [...payload.items, { id: 'other', name: 'Divine Orb', detailsId: 'other' }], lines: [...payload.lines, { id: 'other', primaryValue: 2 }] } });
    await expect(tool.invoke({ league: 'Standard' })).rejects.toThrow('ambiguous name');
    source.read.mockResolvedValueOnce({ source: 'poe.ninja', query: { kind: 'currency', league: 'Standard' }, fetchedAt, payload: { ...payload, lines: [] } });
    await expect(tool.invoke({ league: 'Standard' })).rejects.toThrow('no usable market rates');
  });
});
