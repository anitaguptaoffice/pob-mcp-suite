import {
  TradeQuery,
  StatFilterGroup,
  ResistanceRequirements,
  SearchOptions,
  TradeStatus,
} from '../../types/tradeTypes.js';

/**
 * Builder class for constructing Path of Exile Trade API queries
 *
 * Provides a fluent API for building complex trade queries with:
 * - Item type and name filtering
 * - Price ranges
 * - Stat requirements
 * - Socket/link requirements
 * - Resistance requirements
 * - Online-only filtering
 */
export class TradeQueryBuilder {
  private query: TradeQuery = {
    query: {
      status: { option: 'available' },
      filters: {},
    },
  };

  /**
   * Set item name filter
   */
  withName(name: string): this {
    this.query.query.name = name;
    return this;
  }

  /**
   * Set item type filter (base type or category)
   */
  withType(type: string): this {
    // Map generic categories to trade API categories
    const categoryMap: Record<string, string> = {
      'boots': 'armour.boots',
      'gloves': 'armour.gloves',
      'helmet': 'armour.helmet',
      'body armour': 'armour.chest',
      'chest': 'armour.chest',
      'shield': 'armour.shield',
      'quiver': 'armour.quiver',
      'ring': 'accessory.ring',
      'amulet': 'accessory.amulet',
      'belt': 'accessory.belt',
      'jewel': 'jewel',
      'flask': 'flask',
      'bow': 'weapon.bow',
      'claw': 'weapon.claw',
      'dagger': 'weapon.dagger',
      'wand': 'weapon.wand',
      'one hand sword': 'weapon.onesword',
      'two hand sword': 'weapon.twosword',
      'one hand axe': 'weapon.oneaxe',
      'two hand axe': 'weapon.twoaxe',
      'one hand mace': 'weapon.onemace',
      'two hand mace': 'weapon.twomace',
      'sceptre': 'weapon.sceptre',
      'staff': 'weapon.staff',
      'warstaff': 'weapon.warstaff',
    };

    const typeLower = type.toLowerCase();
    const category = categoryMap[typeLower];

    if (category) {
      // Use category filter for generic types
      this.withCategory(category);
    } else {
      // Use specific base type
      this.query.query.type = type;
    }

    return this;
  }

  /**
   * Set item category filter
   */
  withCategory(category: string): this {
    if (!this.query.query.filters) {
      this.query.query.filters = {};
    }
    if (!this.query.query.filters.type_filters) {
      this.query.query.filters.type_filters = {};
    }
    if (!this.query.query.filters.type_filters.filters) {
      this.query.query.filters.type_filters.filters = {};
    }

    this.query.query.filters.type_filters.filters.category = {
      option: category,
    };

    return this;
  }

  /**
   * Set search term (generic search)
   */
  withTerm(term: string): this {
    this.query.query.term = term;
    return this;
  }

  /**
   * Filter by online status
   * - 'available': Shows both instant buyout and in-person trade items (recommended)
   * - 'securable': Instant buyout, including offline sellers
   * - 'online': In-person trade with currently online sellers
   * - 'onlineleague': Only shows items from sellers online in the same league
   * - 'any': Shows all items regardless of seller status
   */
  withOnlineStatus(status: TradeStatus): this {
    this.query.query.status = { option: status };
    return this;
  }

  /**
   * Set sale type filter
   */
  withSaleType(saleType: 'priced' | 'unpriced' | 'any' = 'any'): this {
    if (!this.query.query.filters) {
      this.query.query.filters = {};
    }
    if (!this.query.query.filters.trade_filters) {
      this.query.query.filters.trade_filters = {};
    }
    if (!this.query.query.filters.trade_filters.filters) {
      this.query.query.filters.trade_filters.filters = {};
    }

    // Only set sale_type if not 'any' - omitting it allows all types
    if (saleType !== 'any') {
      this.query.query.filters.trade_filters.filters.sale_type = {
        option: saleType,
      };
    }

    return this;
  }

  /**
   * Set price range filter
   */
  withPriceRange(min?: number, max?: number, currency: string = 'chaos'): this {
    if (!this.query.query.filters) {
      this.query.query.filters = {};
    }
    if (!this.query.query.filters.trade_filters) {
      this.query.query.filters.trade_filters = {};
    }
    if (!this.query.query.filters.trade_filters.filters) {
      this.query.query.filters.trade_filters.filters = {};
    }

    this.query.query.filters.trade_filters.filters.price = {
      min,
      max,
      option: currency,
    };

    return this;
  }

  /** Set the requested rarity without broadening it to all non-unique items. */
  withRarity(rarity: 'normal' | 'magic' | 'rare' | 'unique' | 'any'): this {
    if (!this.query.query.filters) {
      this.query.query.filters = {};
    }
    if (!this.query.query.filters.type_filters) {
      this.query.query.filters.type_filters = {};
    }
    if (!this.query.query.filters.type_filters.filters) {
      this.query.query.filters.type_filters.filters = {};
    }

    this.query.query.filters.type_filters.filters.rarity = {
      option: rarity,
    };

    return this;
  }

  /**
   * Filter by corruption status.
   */
  withCorrupted(corrupted: boolean): this {
    if (!this.query.query.filters) {
      this.query.query.filters = {};
    }
    if (!this.query.query.filters.misc_filters) {
      this.query.query.filters.misc_filters = {};
    }
    if (!this.query.query.filters.misc_filters.filters) {
      this.query.query.filters.misc_filters.filters = {};
    }

    this.query.query.filters.misc_filters.filters.corrupted = {
      option: corrupted ? 'true' : 'false',
    };

    return this;
  }

  /**
   * Filter by identification status.
   */
  withIdentified(identified: boolean): this {
    if (!this.query.query.filters) {
      this.query.query.filters = {};
    }
    if (!this.query.query.filters.misc_filters) {
      this.query.query.filters.misc_filters = {};
    }
    if (!this.query.query.filters.misc_filters.filters) {
      this.query.query.filters.misc_filters.filters = {};
    }

    this.query.query.filters.misc_filters.filters.identified = {
      option: identified ? 'true' : 'false',
    };

    return this;
  }

  /**
   * Set item level range
   */
  withItemLevel(min?: number, max?: number): this {
    if (!this.query.query.filters) {
      this.query.query.filters = {};
    }
    if (!this.query.query.filters.type_filters) {
      this.query.query.filters.type_filters = {};
    }
    if (!this.query.query.filters.type_filters.filters) {
      this.query.query.filters.type_filters.filters = {};
    }

    this.query.query.filters.type_filters.filters.ilvl = {
      min,
      max,
    };

    return this;
  }

  /**
   * Set link requirement
   */
  withLinks(min?: number, max?: number): this {
    if (!this.query.query.filters) {
      this.query.query.filters = {};
    }
    if (!this.query.query.filters.socket_filters) {
      this.query.query.filters.socket_filters = {};
    }
    if (!this.query.query.filters.socket_filters.filters) {
      this.query.query.filters.socket_filters.filters = {};
    }

    this.query.query.filters.socket_filters.filters.links = {
      min,
      max,
    };

    return this;
  }

  /**
   * Set socket color requirements
   */
  withSockets(r?: number, g?: number, b?: number, w?: number): this {
    if (!this.query.query.filters) {
      this.query.query.filters = {};
    }
    if (!this.query.query.filters.socket_filters) {
      this.query.query.filters.socket_filters = {};
    }
    if (!this.query.query.filters.socket_filters.filters) {
      this.query.query.filters.socket_filters.filters = {};
    }

    this.query.query.filters.socket_filters.filters.sockets = {
      r,
      g,
      b,
      w,
    };

    return this;
  }

  /**
   * Set weapon DPS requirement
   */
  withDPS(min?: number, max?: number): this {
    if (!this.query.query.filters) {
      this.query.query.filters = {};
    }
    if (!this.query.query.filters.weapon_filters) {
      this.query.query.filters.weapon_filters = {};
    }
    if (!this.query.query.filters.weapon_filters.filters) {
      this.query.query.filters.weapon_filters.filters = {};
    }

    this.query.query.filters.weapon_filters.filters.dps = {
      min,
      max,
    };

    return this;
  }

  /**
   * Set physical DPS requirement
   */
  withPDPS(min?: number, max?: number): this {
    if (!this.query.query.filters) {
      this.query.query.filters = {};
    }
    if (!this.query.query.filters.weapon_filters) {
      this.query.query.filters.weapon_filters = {};
    }
    if (!this.query.query.filters.weapon_filters.filters) {
      this.query.query.filters.weapon_filters.filters = {};
    }

    this.query.query.filters.weapon_filters.filters.pdps = {
      min,
      max,
    };

    return this;
  }

  /**
   * Set elemental DPS requirement
   */
  withEDPS(min?: number, max?: number): this {
    if (!this.query.query.filters) {
      this.query.query.filters = {};
    }
    if (!this.query.query.filters.weapon_filters) {
      this.query.query.filters.weapon_filters = {};
    }
    if (!this.query.query.filters.weapon_filters.filters) {
      this.query.query.filters.weapon_filters.filters = {};
    }

    this.query.query.filters.weapon_filters.filters.edps = {
      min,
      max,
    };

    return this;
  }

  /**
   * Add armour/evasion/ES requirements
   */
  withDefenses(armour?: { min?: number; max?: number }, evasion?: { min?: number; max?: number }, es?: { min?: number; max?: number }): this {
    if (!this.query.query.filters) {
      this.query.query.filters = {};
    }
    if (!this.query.query.filters.armour_filters) {
      this.query.query.filters.armour_filters = {};
    }
    if (!this.query.query.filters.armour_filters.filters) {
      this.query.query.filters.armour_filters.filters = {};
    }

    if (armour) {
      this.query.query.filters.armour_filters.filters.ar = armour;
    }
    if (evasion) {
      this.query.query.filters.armour_filters.filters.ev = evasion;
    }
    if (es) {
      this.query.query.filters.armour_filters.filters.es = es;
    }

    return this;
  }

  /**
   * Add stat requirements (uses stat IDs from Trade API)
   */
  withStats(stats: Array<{ id: string; min?: number; max?: number }>): this {
    const statFilters: StatFilterGroup = {
      type: 'and',
      filters: stats.map(stat => ({
        id: stat.id,
        value: {
          min: stat.min,
          max: stat.max,
        },
      })),
    };

    if (!this.query.query.stats) {
      this.query.query.stats = [];
    }

    this.query.query.stats.push(statFilters);
    return this;
  }

  /**
   * Add pre-grouped stat requirements without flattening their boolean logic.
   *
   * Use one count/or group per semantic requirement when equivalent trade
   * stats can come from different sources, such as explicit and fractured.
   */
  withStatGroups(groups: StatFilterGroup[]): this {
    if (!this.query.query.stats) {
      this.query.query.stats = [];
    }

    this.query.query.stats.push(...groups.map(group => ({
      ...group,
      filters: group.filters.map(filter => ({
        ...filter,
        value: filter.value ? { ...filter.value } : undefined,
      })),
      value: group.value ? { ...group.value } : undefined,
    })));
    return this;
  }

  /**
   * Add resistance requirements
   * Uses pseudo stats for total resistances
   */
  withResistances(resists: ResistanceRequirements): this {
    const resistStats: Array<{ id: string; min?: number }> = [];

    if (resists.fire > 0) {
      resistStats.push({
        id: 'pseudo.pseudo_total_fire_resistance',
        min: resists.fire,
      });
    }
    if (resists.cold > 0) {
      resistStats.push({
        id: 'pseudo.pseudo_total_cold_resistance',
        min: resists.cold,
      });
    }
    if (resists.lightning > 0) {
      resistStats.push({
        id: 'pseudo.pseudo_total_lightning_resistance',
        min: resists.lightning,
      });
    }
    if (resists.chaos && resists.chaos > 0) {
      resistStats.push({
        id: 'pseudo.pseudo_total_chaos_resistance',
        min: resists.chaos,
      });
    }

    return this.withStats(resistStats);
  }

  /**
   * Set sort order
   */
  withSort(field: 'price', order: 'asc' | 'desc'): this {
    this.query.sort = {
      [field]: order,
    };
    return this;
  }

  /**
   * Apply common search options
   */
  applyOptions(options: SearchOptions): this {
    // An explicit status wins over the legacy onlineOnly convenience flag.
    this.withOnlineStatus(options.status ?? options.onlineStatus ?? (options.onlineOnly === false ? 'any' : 'available'));

    // Note: We intentionally do NOT set sale_type filter here.
    // By omitting it, we search for ALL items (both priced instant-buyout items AND unpriced negotiable items).
    // This gives users the full range of available items.

    if (options.minPrice !== undefined || options.maxPrice !== undefined) {
      this.withPriceRange(options.minPrice, options.maxPrice, options.priceCurrency);
    }

    if (options.sort) {
      const [field, order] = options.sort.split('_') as ['price', 'asc' | 'desc'];
      this.withSort(field, order);
    }

    return this;
  }

  /**
   * Build and return the final query
   */
  build(): TradeQuery {
    return JSON.parse(JSON.stringify(this.query)); // Deep clone
  }
}
