import { toFiniteNumber, type PoBLuaApiClient, type StatsExport } from '../pobLuaBridge.js';
import { wrapHandler, noteIgnoredError } from '../utils/errorHandling.js';

interface ItemShoppingContext { getLuaClient: () => PoBLuaApiClient | null }
const fields: Array<[string, string, string]> = [
  ['Life', 'Life', ''], ['EnergyShield', 'Energy Shield', ''],
  ['FireResist', 'Fire Resistance', '%'], ['ColdResist', 'Cold Resistance', '%'],
  ['LightningResist', 'Lightning Resistance', '%'], ['ChaosResist', 'Chaos Resistance', '%'],
];

/** Gather live PoB facts; the candidate item, prices, and replacement gains are not known yet. */
export async function handleFindItemUpgrades(context: ItemShoppingContext, args: {
  slot: string; priority?: 'dps' | 'defense' | 'resistance' | 'balanced';
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  return wrapHandler('find item upgrades', async () => {
    if (typeof args.slot !== 'string' || !args.slot.trim()) throw new Error('slot is required');
    if (args.priority !== undefined && !['dps', 'defense', 'resistance', 'balanced'].includes(args.priority)) throw new Error('invalid priority');
    const slot = args.slot.trim();
    const client = context.getLuaClient();
    let stats: StatsExport | undefined;
    let itemLine = 'Unknown: equipment data unavailable';
    if (client) {
      try { stats = await client.getStats(fields.map(([field]) => field)); }
      catch (error) { noteIgnoredError('item shopping stats unavailable', error); }
      try {
        const items = await client.getItems();
        const item = items.find(entry => entry.slot === slot && entry.shown !== false && entry.id > 0);
        if (item) itemLine = `${item.name || item.baseName || 'Unknown name'}${item.baseName && item.name !== item.baseName ? ` (${item.baseName})` : ''}${item.rarity ? ` [${item.rarity}]` : ''}`;
        else itemLine = 'No visible equipped item was returned; verify the slot and active item set';
      } catch (error) { noteIgnoredError('item shopping items unavailable', error); }
    }
    let text = `=== Equipment Context: ${slot} ===\nCurrent item: ${itemLine}\n`;
    if (args.priority) text += `Focus: ${args.priority} (context only; no ranking calculated)\n`;
    text += '\nCurrent PoB stats (dependent on configuration):\n';
    for (const [field, label, suffix] of fields) {
      const value = toFiniteNumber(stats?.[field]);
      text += `- ${label}: ${value === undefined ? 'unknown' : `${value}${suffix}`}\n`;
    }
    text += '\nCurrent stats include the equipped item and are not replacement gains. Resistance caps and requirements depend on the build. Confirm required effects and modifiers, search international trade for securable instant-buyout listings, and compare damage, defenses and requirements in PoB. Prices and candidate items have not been checked.';
    return { content: [{ type: 'text', text }] };
  });
}
