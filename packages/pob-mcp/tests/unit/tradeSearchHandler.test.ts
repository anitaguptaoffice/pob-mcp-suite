import { describe, expect, it, jest } from '@jest/globals';
import { handleSearchStats, handleSearchTradeItems } from '../../src/handlers/tradeHandlers';
import { normalizeItemListing } from '../../src/services/tradeClient';

function makeListing() {
  return {
    id: 'listing-1',
    listing: {
      method: 'psapi',
      indexed: '2026-07-24T00:00:00Z',
      whisper: '',
      account: {
        name: 'seller',
        online: { league: 'Standard' },
      },
      price: {
        type: '~price',
        amount: 1,
        currency: 'chaos',
      },
    },
    item: {
      verified: true,
      w: 1,
      h: 1,
      icon: '',
      league: 'Standard',
      id: 'item-1',
      name: 'Test Item',
      typeLine: 'Test Base',
      baseType: 'Test Base',
      identified: true,
      ilvl: 86,
      frameType: 3,
      explicitMods: ['+50 to maximum Life'],
    },
  };
}

describe('search_trade_items schema contract', () => {
  it('maps public schema keys into the official trade query', async () => {
    const searchItems = jest.fn<(league: string, query: any) => Promise<any>>(async () => ({
      id: 'query-1',
      complexity: 1,
      total: 1,
      result: ['listing-1'],
    }));
    const fetchItems = jest.fn<(ids: string[], queryId?: string) => Promise<any>>(async () => [makeListing()]);

    const result = await handleSearchTradeItems(
      {
        tradeClient: { searchItems, fetchItems } as any,
      },
      {
        league: 'Standard',
        item_rarity: 'unique',
        corrupted: false,
        identified: true,
        mods: [{
          stat_id: 'explicit.stat_3299347043',
          min: 40,
        }],
        min_price: 2,
        max_price: 10,
        price_currency: 'divine',
        online_only: false,
        sort: 'price_desc',
      },
    );

    expect(searchItems).toHaveBeenCalledWith('Standard', {
      query: {
        status: { option: 'any' },
        filters: {
          type_filters: {
            filters: {
              rarity: { option: 'unique' },
            },
          },
          misc_filters: {
            filters: {
              corrupted: { option: 'false' },
              identified: { option: 'true' },
            },
          },
          trade_filters: {
            filters: {
              price: {
                min: 2,
                max: 10,
                option: 'divine',
              },
            },
          },
        },
        stats: [{
          type: 'and',
          filters: [{
            id: 'explicit.stat_3299347043',
            value: { min: 40 },
          }],
        }],
      },
      sort: { price: 'desc' },
    });
    expect(result.content[0].text).toContain('Test Item');
  });

  it('keeps legacy rarity and stats keys working', async () => {
    const searchItems = jest.fn<(league: string, query: any) => Promise<any>>(async () => ({
      id: 'query-2',
      complexity: 1,
      total: 0,
      result: [],
    }));

    await handleSearchTradeItems(
      {
        tradeClient: { searchItems } as any,
      },
      {
        league: 'Standard',
        rarity: 'rare',
        stats: [{ id: 'pseudo.pseudo_total_life', min: 100 }],
      },
    );

    const query = searchItems.mock.calls[0][1] as any;
    expect(query.query.filters.type_filters.filters.rarity.option).toBe('rare');
    expect(query.query.stats[0].filters[0].id).toBe('pseudo.pseudo_total_life');
  });

  it('preserves independent source-aware stat groups and securable status', async () => {
    const searchItems = jest.fn<(league: string, query: any) => Promise<any>>(async () => ({
      id: 'query-source-aware',
      complexity: 1,
      total: 0,
      result: [],
    }));
    const getStats = jest.fn(async () => ({ result: [] }));

    await handleSearchTradeItems(
      {
        tradeClient: { searchItems, getStats } as any,
      },
      {
        league: 'Allflame',
        status: 'securable',
        corrupted: true,
        stat_groups: [
          {
            type: 'and',
            filters: [{ stat_id: 'implicit.stat_3676141501', min: 2 }],
          },
          {
            type: 'count',
            min: 1,
            filters: [
              { stat_id: 'explicit.stat_4061558269', min: 3 },
              { stat_id: 'fractured.stat_4061558269', min: 3 },
            ],
          },
        ],
      },
    );

    const query = searchItems.mock.calls[0][1] as any;
    expect(query.query.status).toEqual({ option: 'securable' });
    expect(query.query.stats).toEqual([
      {
        type: 'and',
        filters: [{
          id: 'implicit.stat_3676141501',
          value: { min: 2 },
        }],
      },
      {
        type: 'count',
        value: { min: 1 },
        filters: [
          {
            id: 'explicit.stat_4061558269',
            value: { min: 3 },
          },
          {
            id: 'fractured.stat_4061558269',
            value: { min: 3 },
          },
        ],
      },
    ]);
  });

  it('warns when a non-unique flat Explicit filter omits official source variants', async () => {
    const searchItems = jest.fn<(league: string, query: any) => Promise<any>>(async () => ({
      id: 'query-narrow',
      complexity: 1,
      total: 0,
      result: [],
    }));
    const getStats = jest.fn(async () => ({
      result: [{
        label: 'Explicit',
        entries: [
          { id: 'explicit.stat_4061558269', text: '+#% Chance to Block Attack Damage while holding a Shield', type: 'explicit' },
          { id: 'fractured.stat_4061558269', text: '+#% Chance to Block Attack Damage while holding a Shield', type: 'fractured' },
        ],
      }],
    }));

    const result = await handleSearchTradeItems(
      {
        tradeClient: { searchItems, getStats } as any,
      },
      {
        league: 'Allflame',
        item_type: 'Jewel',
        mods: [{ stat_id: 'explicit.stat_4061558269', min: 3 }],
      },
    );

    expect(result.content[0].text).toContain('Stat source coverage warnings');
    expect(result.content[0].text).toContain('fractured');
    expect(result.content[0].text).toContain('count/or group');
  });
});

describe('search_stats official source discovery', () => {
  it('groups identical text by official stat source', async () => {
    const getStats = jest.fn(async () => ({
      result: [{
        label: 'Stats',
        entries: [
          { id: 'explicit.stat_1085167979', text: '1 Added Passive Skill is Blanketed Snow', type: 'explicit' },
          { id: 'fractured.stat_1085167979', text: '1 Added Passive Skill is Blanketed Snow', type: 'fractured' },
        ],
      }],
    }));

    const result = await handleSearchStats(
      { tradeClient: { getStats } as any },
      { query: 'Blanketed Snow' },
    );

    expect(result.content[0].text).toContain('Official Trade Stat Sources');
    expect(result.content[0].text).toContain('explicit.stat_1085167979');
    expect(result.content[0].text).toContain('fractured.stat_1085167979');
  });
});

describe('trade fetch response normalization', () => {
  it('converts structured mod objects before analyzers consume them', () => {
    const listing = makeListing() as any;
    listing.item.implicitMods = ['Resolute Technique'];
    listing.item.explicitMods = [
      {
        description: '+42 to maximum Life',
        hash: 'explicit.stat_3299347043',
        mods: [],
      },
      {
        mods: [
          { text: '+30% to Fire Resistance' },
          { name: '+25% to Cold Resistance' },
        ],
      },
    ];

    const normalized = normalizeItemListing(listing);

    expect(normalized.item.implicitMods).toEqual(['Resolute Technique']);
    expect(normalized.item.explicitMods).toEqual([
      '+42 to maximum Life',
      '+30% to Fire Resistance, +25% to Cold Resistance',
    ]);
  });
});
