import type { ToolSchema } from '../../server/toolSchema.js';
import type { PoBLuaApiClient } from '../../adapters/pob/bridge.js';
import { estimateBuildCost, type PriceSource } from './estimate.js';

export function buildCostSchemas(): ToolSchema[] {
  return [{
    name: 'estimate_build_cost',
    description: 'Estimate reference prices for the currently loaded PoE 1 build using public poe.ninja economy data. Requires the exact international league. Unknown and ambiguous items are excluded from the subtotal; it is never a complete build price.',
    inputSchema: { type: 'object', properties: { league: { type: 'string', description: 'Exact international league name, e.g. Standard. Never guess or substitute.' } }, required: ['league'] },
  }];
}

export async function handleEstimateBuildCost(
  getClient: () => PoBLuaApiClient | null, ensureClient: () => Promise<void>, source: PriceSource, args?: Record<string, unknown>,
) {
  const league = typeof args?.league === 'string' ? args.league.trim() : '';
  if (!league) throw new Error('The exact international league is required.');
  await ensureClient();
  const client = getClient();
  if (!client) throw new Error('Lua bridge not active. Load a build first.');
  // One bridge request ensures equipment and skills come from the same state.
  const { items, skills } = await client.getCostSnapshot();
  if (!Array.isArray(items) || !Array.isArray(skills?.groups) || skills.groups.some(group => !Array.isArray(group.gems))) {
    throw new Error('The loaded build did not provide complete item and skill-group data.');
  }
  const report = await estimateBuildCost(source, league, items, skills.groups);
  return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
}
