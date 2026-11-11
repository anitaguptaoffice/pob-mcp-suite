import { BuildService } from '../services/buildService.js';
import { TreeService } from '../services/treeService.js';
import { WatchService } from '../services/watchService.js';
import { ValidationService } from '../services/validationService.js';
import { BuildExportService } from '../services/buildExportService.js';
import { SkillGemService } from '../services/skillGemService.js';
import { TradeApiClient } from '../services/tradeClient.js';
import { StatMapper } from '../services/statMapper.js';
import { PoeNinjaClient } from '../services/poeNinjaClient.js';
import { ItemRecommendationEngine } from '../services/itemRecommendationEngine.js';
import { NinjaPrices } from '../features/buildCost/ninjaPrices.js';
import { ContextBuilder } from '../utils/contextBuilder.js';
import type { OfficialTradeSource } from '../ports/officialTrade.js';
import { LuaClientManager } from './luaClientManager.js';
import { routeToolCall } from './toolRouter.js';

/** Transitional legacy runtime; never constructed by the snapshot-only server. */
export class LegacyRuntime {
  readonly buildService: BuildService;
  private readonly watchService: WatchService;
  private readonly lua: LuaClientManager;
  private readonly contextBuilder: ContextBuilder;
  private readonly tradeClient: TradeApiClient | null;
  private readonly statMapper: StatMapper | null;
  private readonly recommendationEngine: ItemRecommendationEngine | null;
  private readonly ninjaClient = new PoeNinjaClient();
  private readonly buildCostPrices = new NinjaPrices();

  constructor(directory: string, luaEnabled: boolean, tradeEnabled: boolean, source?: OfficialTradeSource) {
    this.buildService = new BuildService(directory);
    const treeService = new TreeService(this.buildService);
    this.watchService = new WatchService(directory, this.buildService);
    this.lua = new LuaClientManager(luaEnabled);
    this.tradeClient = tradeEnabled ? new TradeApiClient({
      requestsPerSecond: parseInt(process.env.POE_RATE_LIMIT_PER_SECOND || '4', 10),
      cacheTTL: parseInt(process.env.POE_CACHE_TTL || '300', 10),
      ...(source ? { source } : {}),
    }) : null;
    this.statMapper = this.tradeClient ? new StatMapper() : null;
    this.recommendationEngine = this.tradeClient ? new ItemRecommendationEngine(this.tradeClient) : null;
    this.contextBuilder = new ContextBuilder({
      buildService: this.buildService, treeService, watchService: this.watchService,
      validationService: new ValidationService(), exportService: new BuildExportService(directory),
      skillGemService: new SkillGemService(), pobDirectory: directory, luaEnabled,
      getLuaClient: () => this.lua.getClient(), ensureLuaClient: () => this.lua.ensureClient(),
      stopLuaClient: () => this.lua.stopClient(),
      createIsolatedLuaClient: async () => {
        const manager = new LuaClientManager(luaEnabled);
        try {
          await manager.ensureClient();
          const client = manager.getClient();
          if (!client) throw new Error('Comparison bridge failed to start');
          return { client, close: () => manager.stopClient() };
        } catch (error) { await manager.stopClient(); throw error; }
      },
    });
  }

  get luaEnabled(): boolean { return this.lua.isEnabled(); }
  get tradeEnabled(): boolean { return this.tradeClient !== null; }
  route(name: string, args: Record<string, unknown> | undefined) {
    return routeToolCall(name, args, {
      contextBuilder: this.contextBuilder, tradeClient: this.tradeClient, statMapper: this.statMapper,
      recommendationEngine: this.recommendationEngine, ninjaClient: this.ninjaClient,
      buildCostPrices: this.buildCostPrices, getLuaClient: () => this.lua.getClient(),
      ensureLuaClient: () => this.lua.ensureClient(),
    });
  }
  async close(): Promise<void> {
    const results = await Promise.allSettled([Promise.resolve().then(() => this.watchService.stopWatching()), Promise.resolve().then(() => this.lua.stopClient())]);
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (errors.length) throw new AggregateError(errors.map(error => error.reason), 'Legacy runtime shutdown failed');
  }
}
