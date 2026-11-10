import type { ToolSchema } from '../../server/toolSchemas.js';
import { simulateSimpleAnnul, type AnnulAffix } from './annul.js';

export function craftSimulatorSchemas(): ToolSchema[] {
  return [{ name: 'simulate_simple_annul', description: 'Enumerate the single-use outcomes of an Orb of Annulment on a manually verified ordinary magic or rare PoE 1 item. Every explicit affix must be supplied separately; hybrid multi-line mods count once. Refuses items with unconfirmed protection, fractured mods, catalyst weighting, corruption, mirroring, or other special rules. Does not inspect or modify an item.',
    inputSchema: { type: 'object', properties: {
      rarity: { type: 'string', enum: ['magic', 'rare'] },
      affixes: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, disposition: { type: 'string', enum: ['keep', 'remove'] } }, required: ['name', 'disposition'] } },
      no_fractured: { type: 'boolean' }, no_protection: { type: 'boolean' }, no_catalyst: { type: 'boolean' },
      no_corruption: { type: 'boolean' }, no_mirrored: { type: 'boolean' }, no_special_rules: { type: 'boolean' },
    }, required: ['rarity', 'affixes', 'no_fractured', 'no_protection', 'no_catalyst', 'no_corruption', 'no_mirrored', 'no_special_rules'] },
  }];
}

export function handleSimpleAnnul(args: Record<string, unknown>) {
  const result = simulateSimpleAnnul({ rarity: args.rarity as 'magic' | 'rare', affixes: args.affixes as AnnulAffix[],
    noFractured: args.no_fractured === true, noProtection: args.no_protection === true, noCatalyst: args.no_catalyst === true,
    noCorruption: args.no_corruption === true, noMirrored: args.no_mirrored === true, noSpecialRules: args.no_special_rules === true });
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}
