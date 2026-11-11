import { wrapHandler } from '../utils/errorHandling.js';
import { BuildService } from '../services/buildService.js';
import { ShoppingListService } from '../services/shoppingListService.js';
import { TradeApiClient } from '../services/tradeClient.js';
import { StatMapper } from '../adapters/staticStats/catalog.js';
import { PoeNinjaClient } from '../services/poeNinjaClient.js';

interface ShoppingListContext {
  buildService: BuildService;
  tradeClient?: TradeApiClient;
  statMapper?: StatMapper;
  ninjaClient?: PoeNinjaClient;
}

export async function handleGenerateShoppingList(context: ShoppingListContext, args: {
  build_name: string; league: string; budget?: 'budget' | 'medium' | 'endgame'; budget_amount?: number;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  return wrapHandler('generate shopping list', async () => {
    if (typeof args.build_name !== 'string' || !args.build_name.trim() || typeof args.league !== 'string' || !args.league.trim()) throw new Error('build_name and exact league are required');
    if (args.budget !== undefined && !['budget', 'medium', 'endgame'].includes(args.budget)) throw new Error('invalid budget tier');
    if (args.budget_amount !== undefined && (!Number.isFinite(args.budget_amount) || args.budget_amount < 0)) throw new Error('invalid budget amount');
    const build = await context.buildService.readBuild(args.build_name);
    const list = await new ShoppingListService().generateShoppingList(build, args.build_name, args.league.trim());
    let text = `=== Saved Equipment: ${list.buildName} ===\nInternational league: ${list.league}\n`;
    text += 'Based on the saved active item set; unsaved changes are not included. Listings, replacement gains, upgrade priority, costs and budget feasibility were not calculated.\n';
    if (args.budget) text += `Budget tier ${args.budget} is context only; no pricing or filtering was performed.\n`;
    if (args.budget_amount !== undefined) text += `Budget amount ${args.budget_amount} is context only; currency was not specified and no pricing or filtering was performed.\n`;
    if (!list.items.length) text += '\nNo displayable equipment slots were found in the saved item set.\n';
    for (const item of list.items) {
      const detail = item.state === 'empty' ? 'empty in saved build' : item.state === 'unresolved' ? 'item data unavailable' : `${item.currentItem?.name} (${item.currentItem?.rarity})`;
      text += `\n- ${item.slot}: ${detail}`;
    }
    text += '\n\nConfirm the desired slot and modifiers, search securable trade listings, and compare replacement damage and defenses in PoB.';
    return { content: [{ type: 'text', text }] };
  });
}
