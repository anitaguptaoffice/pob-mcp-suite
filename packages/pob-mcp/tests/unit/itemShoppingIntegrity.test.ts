import { handleFindItemUpgrades } from '../../src/handlers/itemShoppingHandler';

describe('item shopping context', () => {
  it('reports unknown stats when no build is loaded, without inventing goals or item advice', async () => {
    const text = (await handleFindItemUpgrades({ getLuaClient: () => null }, { slot: 'Helmet' })).content[0].text;
    expect(text).toContain('Fire Resistance: unknown');
    expect(text).toContain('Life: unknown');
    expect(text).not.toMatch(/4500|Bone Helmet|enchant|75%/);
    expect(text).toContain('Prices and candidate items have not been checked');
  });

  it('preserves real zeroes and marks missing data unknown, independently of item lookup', async () => {
    const client = { getStats: async () => ({ Life: 1, EnergyShield: 4000, FireResist: 0, ColdResist: undefined }), getItems: async () => { throw new Error('not loaded'); } };
    const text = (await handleFindItemUpgrades({ getLuaClient: () => client as never }, { slot: 'Helmet' })).content[0].text;
    expect(text).toContain('Life: 1');
    expect(text).toContain('Fire Resistance: 0%');
    expect(text).toContain('Cold Resistance: unknown');
    expect(text).toContain('Unknown: equipment data unavailable');
    expect(text).toContain('are not replacement gains');
  });
});
