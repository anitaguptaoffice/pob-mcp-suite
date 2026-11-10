import { describe, expect, it, jest } from '@jest/globals';
import { compareItem } from '../../src/features/itemComparison/tool';

describe('item comparison adapter', () => {
  it('keeps player and minion metrics separate and omits deltas without baselines', async () => {
    const client = { compareItem: jest.fn(async () => ({ slot: 'Amulet', candidate: { name: 'Test', base: 'Citrine Amulet' }, baseline: { Life: 100, CombinedDPS: 200 }, candidateStats: { Life: 120, CombinedDPS: 180, MinionCombinedDPS: 300 } })) };
    const report = await compareItem(client, { slot: 'Amulet', item_text: 'Rarity: RARE\nTest\nCitrine Amulet' });
    expect(report.delta).toEqual({ Life: 20, CombinedDPS: -20 });
    expect(report.candidateStats.MinionCombinedDPS).toBe(300);
    expect(report.warnings.join(' ')).toContain('does not equip or save');
  });
  it('rejects missing and oversized inputs before calling the engine', async () => {
    const client = { compareItem: jest.fn() } as any;
    await expect(compareItem(client, { slot: 'Amulet', item_text: '' })).rejects.toThrow();
    await expect(compareItem(client, { slot: 'Amulet', item_text: 'x'.repeat(10241) })).rejects.toThrow();
    expect(client.compareItem).not.toHaveBeenCalled();
  });
});
