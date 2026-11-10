import { describe, expect, it, jest } from '@jest/globals';
import { compareTradeListing, tradeClipboardText } from '../../src/features/itemComparison/tradeListing';

const itemId = 'a'.repeat(64);
const clipboard = 'Item Class: Amulets\r\nRarity: Rare\r\nViper Choker\r\nCitrine Amulet\r\n--------\r\n+21 to Strength and Dexterity\r\n--------\r\n+19% to Chaos Resistance\r\n';
const makeListing = () => ({ id: itemId, item: { league: 'League', identified: true, verified: true, name: 'Viper Choker', typeLine: 'Citrine Amulet', extended: { text: Buffer.from(clipboard).toString('base64') } }, listing: { price: { amount: 3, currency: 'chaos', type: '~b/o' } } } as any);

describe('official trade clipboard comparison', () => {
  it('uses the exact clipboard text and preserves listing price with explicit limitations', async () => {
    const compareItem = jest.fn(async (_slot: string, _text: string) => ({ slot: 'Amulet', candidate: { name: 'Viper Choker' }, baseline: { Life: 100 }, candidateStats: { Life: 120 } }));
    const fetchItems = jest.fn(async () => [makeListing()]);
    const searchId = 'H4sI' + 'A'.repeat(140) + '/+=-';
    const report = await compareTradeListing({ fetchItems }, { compareItem }, { league: 'League', slot: 'Amulet', item_id: itemId, search_id: searchId });
    expect(fetchItems).toHaveBeenCalledWith([itemId], searchId);
    expect(report.listingUrl).toContain('%2F%2B%3D');
    expect(compareItem).toHaveBeenCalledWith('Amulet', clipboard);
    expect(report.delta.Life).toBe(20);
    expect(report.price?.currency).toBe('chaos');
    expect(report.warnings.join(' ')).toContain('cannot be inferred');
  });

  it('refuses missing, malformed or mismatched clipboard data', () => {
    const bad = makeListing();
    bad.item.extended.text = '';
    expect(() => tradeClipboardText(bad, 'League')).toThrow();
    bad.item.extended.text = 'bad%';
    expect(() => tradeClipboardText(bad, 'League')).toThrow();
    bad.item.extended.text = Buffer.from(clipboard.replace('Citrine Amulet', 'Other Amulet')).toString('base64');
    expect(() => tradeClipboardText(bad, 'League')).toThrow();
    expect(() => tradeClipboardText(makeListing(), 'Wrong League')).toThrow();
  });

  it('does not send a different listing or invalid input to PoB', async () => {
    const compareItem = jest.fn();
    const fetchItems = jest.fn(async () => [{ ...makeListing(), id: 'b'.repeat(64) }]);
    await expect(compareTradeListing({ fetchItems }, { compareItem } as any, { league: 'League', slot: 'Amulet', item_id: itemId, search_id: 'q' })).rejects.toThrow('does not match');
    expect(compareItem).not.toHaveBeenCalled();
  });
});
