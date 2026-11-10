#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";

// Authoritative repo root for repo-owned data files (lua bridge adapter).
// Must be set before any module resolves paths: LuaClientManager cannot read
// import.meta itself (the CommonJS test transform rejects it), so the entry —
// which only ever runs as ESM — publishes it here.
if (!process.env.POB_REPO_ROOT) {
  process.env.POB_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BuildFoundation } from './foundation/buildFoundation.js';
import { SnapshotStore } from './foundation/snapshotStore.js';
import { openPoBEngine } from './foundation/pobEngineAdapter.js';
import { acquireStoreLock } from './foundation/storeLock.js';
import { JobStore } from './foundation/jobStore.js';
import { JobRunner } from './foundation/jobRunner.js';
import { foundationSchemas, invokeFoundation } from './foundation/mcpTools.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
// Import services
import { defaultBuildsDirectory } from "./utils/pobLayout.js";
import { BuildService } from "./services/buildService.js";
import { TreeService } from "./services/treeService.js";
import { WatchService } from "./services/watchService.js";
import { ValidationService } from "./services/validationService.js";
import { BuildExportService } from "./services/buildExportService.js";
import { SkillGemService } from "./services/skillGemService.js";
import { TradeApiClient } from "./services/tradeClient.js";
import { StatMapper } from "./services/statMapper.js";
import { PoeNinjaClient } from "./services/poeNinjaClient.js";
import { ItemRecommendationEngine } from "./services/itemRecommendationEngine.js";
import { NinjaPrices } from "./features/buildCost/ninjaPrices.js";
import { buildCostSchemas } from "./features/buildCost/tool.js";
import { comparableToolSchemas } from "./features/tradeComparable/tool.js";
import { featureRegistry } from "./server/featureModules.js";
import { assertUniqueToolSchemas, FeatureRegistry } from "./server/featureRegistry.js";
import { PoeNinjaAdapter } from './adapters/poeNinja/poeNinjaAdapter.js';
import { createSnapshotCostTool, snapshotCostSchema } from './features/buildCost/snapshotTool.js';
import { createShoppingListTool, shoppingListSchema } from './features/shoppingList/tool.js';
import { OfficialTradeAdapter } from './adapters/officialTrade/officialTradeAdapter.js';
import { createSourceComparableTool, sourceComparableSchema } from './features/tradeComparable/sourceTool.js';
import { createTradeMetadataTools, tradeMetadataSchemas } from './features/tradeMetadata/tools.js';
import { createTradeSearchTool, tradeSearchSchema } from './features/tradeSearch/tool.js';
import { createTradeItemPriceTool, tradeItemPriceSchema } from './features/tradePrice/tool.js';
import { createSnapshotTreeComparisonTool, snapshotTreeComparisonSchema } from './features/treeComparison/tool.js';
import { createSnapshotBuildComparisonTool, snapshotBuildComparisonSchema } from './features/buildComparison/tool.js';
import { createSnapshotGemComparisonTool, snapshotGemComparisonSchema, compareSnapshotGemSetups } from './features/snapshotGemComparison/tool.js';
import { createGemSetupJobTools, gemSetupJobSchemas } from './features/snapshotGemComparison/jobTools.js';
import { createSnapshotSupportRankingTool, supportRankingSchema } from './features/snapshotSupportRanking/tool.js';
import { createTreePathTools, treePathSchemas } from './features/treePaths/tool.js';
import { buildIssuesSchema, createBuildIssuesTool } from './features/buildIssues/tool.js';
import { bossReadinessSchema, createBossReadinessTool } from './features/bossReadiness/tool.js';
import { masteryRankingSchema, createMasteryRankingTool, masteryDiscoverySchema, createMasteryDiscoveryTool, rankMasteryEffects } from './features/masteryRanking/tool.js';
import { masteryJobSchemas, createMasteryJobTools } from './features/masteryRanking/jobTools.js';
import { passiveRankingSchemas, createPassiveRankingTools, evaluatePassive } from './features/passiveRanking/tool.js';
import { anointmentSchema, createAnointmentTool } from './features/anointment/tool.js';
import { createModifierDataTools } from './features/modifierData/tools.js';
import { PoBModifierData } from './adapters/modifierData/pobModifierData.js';
import { createCurrencyReferenceTools, currencyReferenceSchemas } from './features/currencyReference/tools.js';
import { createCurrencySpreadTool, currencySpreadSchema } from './features/currencySpread/tool.js';
import { createTradePreviewTool, tradePreviewSchema } from './features/tradePreview/tool.js';
import { createTradeListingComparisonTool, tradeListingComparisonSchema } from './features/tradeListingComparison/tool.js';
import { createResistanceTradeTool, resistanceTradeSchema } from './features/resistanceTrade/tool.js';
import { createClusterTradeTool, clusterTradeSchema } from './features/clusterTrade/tool.js';
import { createTimelessSearchTool, timelessSearchSchema } from './features/timelessSearch/tool.js';

// Import utilities
import { ContextBuilder } from "./utils/contextBuilder.js";

// Import server modules
import { LuaClientManager } from "./server/luaClientManager.js";
import type { ToolSchema } from "./server/toolSchemas.js";
import { getToolSchemas, getLuaToolSchemas, getOptimizationToolSchemas, getConfigToolSchemas, getValidationToolSchemas, getExportToolSchemas, getSkillGemToolSchemas, getTradeToolSchemas, getPoeNinjaToolSchemas, getBuildGoalsToolSchemas } from "./server/toolSchemas.js";
import { routeToolCall, type ToolRouterDependencies } from "./server/toolRouter.js";
import { wrapWithTruncation, shouldTruncate } from "./server/responseUtils.js";

class PoBMCPServer {
  private server: Server;
  private pobDirectory: string;
  private foundation: BuildFoundation | null = null;
  private foundationFeatures: FeatureRegistry | null = null;
  private readonly modifierFeatures = new FeatureRegistry(createModifierDataTools(new PoBModifierData()));
  private marketFeatures: FeatureRegistry | null = null;
  private foundationJobs: JobRunner | null = null;
  private releaseFoundationLock: (() => Promise<void>) | null = null;
  private foundationClosing = false;
  private foundationPending = new Set<Promise<unknown>>();

  // Services
  private buildService: BuildService;
  private treeService: TreeService;
  private watchService: WatchService;
  private validationService: ValidationService;
  private exportService: BuildExportService;
  private skillGemService: SkillGemService;
  private tradeClient: TradeApiClient | null = null;
  private statMapper: StatMapper | null = null;
  private recommendationEngine: ItemRecommendationEngine | null = null;
  private ninjaClient: PoeNinjaClient;
  private buildCostPrices = new NinjaPrices();

  // Context builder
  private contextBuilder: ContextBuilder;

  // Server modules
  private luaClientManager: LuaClientManager;

  /**
   * Every tool schema across all groups, regardless of runtime availability
   * gating. Used for policy lookups (truncatable), never for advertising:
   * what clients SEE is assembled per-state in the ListTools handler.
   */
  private allToolSchemas(): ToolSchema[] {
    const legacy = [
      ...getToolSchemas(),
      ...foundationSchemas,
      snapshotCostSchema(),
      shoppingListSchema(),
      sourceComparableSchema(),
      ...tradeMetadataSchemas(),
      tradeSearchSchema(),
      tradeItemPriceSchema(),
      snapshotTreeComparisonSchema(),
      snapshotBuildComparisonSchema(),
      snapshotGemComparisonSchema(),
      ...gemSetupJobSchemas(),
      supportRankingSchema(),
      ...treePathSchemas(),
      buildIssuesSchema(),
      bossReadinessSchema(),
      masteryRankingSchema(),
      masteryDiscoverySchema(),
      ...masteryJobSchemas(),
      ...passiveRankingSchemas(),
      anointmentSchema(),
      ...this.modifierFeatures.schemas(),
      ...currencyReferenceSchemas(),
      currencySpreadSchema(),
      tradePreviewSchema(),
      tradeListingComparisonSchema(),
      resistanceTradeSchema(),
      clusterTradeSchema(),
      timelessSearchSchema(),
      ...getLuaToolSchemas(),
      ...buildCostSchemas(),
      ...getOptimizationToolSchemas(),
      ...getConfigToolSchemas(),
      ...getValidationToolSchemas(),
      ...getExportToolSchemas(),
      ...getSkillGemToolSchemas(),
      ...getTradeToolSchemas(),
      ...comparableToolSchemas(),
      ...getPoeNinjaToolSchemas(),
      ...getBuildGoalsToolSchemas(),
    ];
    featureRegistry.assertNoCollisions(legacy);
    const all = [...legacy, ...featureRegistry.schemas()];
    assertUniqueToolSchemas(all);
    return all;
  }

  constructor() {
    this.server = new Server(
      {
        name: "pob-mcp-server",
        version: "1.0.1",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Default Path of Building directory (can be customized)
    this.pobDirectory = process.env.POB_DIRECTORY || defaultBuildsDirectory();

    // Initialize services
    this.buildService = new BuildService(this.pobDirectory);
    this.treeService = new TreeService(this.buildService);
    this.watchService = new WatchService(this.pobDirectory, this.buildService);
    this.validationService = new ValidationService();
    this.exportService = new BuildExportService(this.pobDirectory);
    this.skillGemService = new SkillGemService();

    // Initialize poe.ninja client (always available)
    this.ninjaClient = new PoeNinjaClient();
    console.error('[poe.ninja API] Client initialized');

    // The legacy client is unnecessary when only the source adapter is exposed.
    const tradeEnabled = process.env.POE_TRADE_ENABLED === 'true' && this.legacyEnabled();
    if (tradeEnabled) {
      const requestsPerSecond = parseInt(process.env.POE_RATE_LIMIT_PER_SECOND || '4', 10);
      const cacheTTL = parseInt(process.env.POE_CACHE_TTL || '300', 10);
      this.tradeClient = new TradeApiClient({
        requestsPerSecond,
        cacheTTL,
      });
      this.statMapper = new StatMapper();
      this.recommendationEngine = new ItemRecommendationEngine(this.tradeClient);
      console.error('[Trade API] Enabled with rate limit:', requestsPerSecond, 'req/s');
    } else if (process.env.POE_TRADE_ENABLED !== 'true') {
      console.error('[Trade API] Disabled (set POE_TRADE_ENABLED=true to enable)');
    }

    // Initialize server modules

    const luaEnabled = process.env.POB_LUA_ENABLED === 'true';
    this.luaClientManager = new LuaClientManager(luaEnabled);

    // Initialize context builder
    this.contextBuilder = new ContextBuilder({
      buildService: this.buildService,
      treeService: this.treeService,
      watchService: this.watchService,
      validationService: this.validationService,
      exportService: this.exportService,
      skillGemService: this.skillGemService,
      pobDirectory: this.pobDirectory,
      luaEnabled: luaEnabled,
      getLuaClient: () => this.luaClientManager.getClient(),
      ensureLuaClient: () => this.luaClientManager.ensureClient(),
      stopLuaClient: () => this.luaClientManager.stopClient(),
      createIsolatedLuaClient: async () => {
        const manager = new LuaClientManager(luaEnabled);
        try {
          await manager.ensureClient();
          const client = manager.getClient();
          if (!client) throw new Error('Comparison bridge failed to start');
          return { client, close: () => manager.stopClient() };
        } catch (error) {
          await manager.stopClient();
          throw error;
        }
      },
    });

    if (luaEnabled) {
      console.error('[MCP Server] PoB Lua Bridge enabled (stdio mode)');
    }

    this.allToolSchemas(); // Validate all names, including currently disabled capability groups.
    this.setupHandlers();

    // Error handling
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    // Handle EPIPE errors (broken pipe) gracefully
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        // Client disconnected; drain work and release the snapshot lock.
        void shutdown();
      } else {
        console.error('stdout error:', err);
      }
    });

    process.stderr.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        // Client disconnected; drain work and release the snapshot lock.
        void shutdown();
      }
    });

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      this.foundationClosing = true;
      await Promise.allSettled([...this.foundationPending]);
      let jobsError: unknown;
      try { await this.foundationJobs?.close(); } catch (error) { jobsError = error; }
      const results = await Promise.allSettled([
        this.watchService.stopWatching(), this.luaClientManager.stopClient(), this.server.close(),
      ]);
      if (jobsError !== undefined) results.push({ status: 'rejected', reason: jobsError });
      if (this.releaseFoundationLock) {
        try { await this.releaseFoundationLock(); }
        catch (error) { results.push({ status: 'rejected', reason: error }); }
      }
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (errors.length) {
        for (const error of errors) console.error('[Shutdown Error]', error.reason);
        process.exit(1);
      }
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.stdin.once("end", () => { void shutdown(); });
  }

  private legacyEnabled(): boolean {
    // During migration, the existing default remains usable. Enabling the new
    // foundation opts into the new surface; legacy requires explicit opt-in.
    if (process.env.POB_LEGACY_ENABLED === 'false') return false;
    return process.env.POB_FOUNDATION_ENABLED !== 'true' || process.env.POB_LEGACY_ENABLED === 'true';
  }

  private setupHandlers() {
    // List available resources (build files)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      if (!this.legacyEnabled()) return { resources: [] };
      try {
        const builds = await this.buildService.listBuilds();
        return {
          resources: builds.map((build) => ({
            uri: `pob://build/${encodeURIComponent(build)}`,
            name: build,
            mimeType: "application/xml",
            description: `Path of Building build: ${build}`,
          })),
        };
      } catch (error) {
        console.error("Error listing resources:", error);
        return { resources: [] };
      }
    });

    // Read a specific build file
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      if (!this.legacyEnabled()) throw new Error('Legacy resources are unavailable');
      const uri = request.params.uri;
      const match = uri.match(/^pob:\/\/build\/(.+)$/);

      if (!match) {
        throw new Error(`Invalid URI: ${uri}`);
      }

      const buildName = decodeURIComponent(match[1]);

      try {
        const build = await this.buildService.readBuild(buildName);
        const summary = this.buildService.generateBuildSummary(build);

        return {
          contents: [
            {
              uri,
              mimeType: "text/plain",
              text: summary,
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to read build: ${error}`);
      }
    });

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (!this.legacyEnabled()) {
        const tools = [...(this.foundation ? [...foundationSchemas, ...featureRegistry.schemas(), ...(this.foundationFeatures?.schemas() ?? [])] : []), ...this.modifierFeatures.schemas(), ...(this.marketFeatures?.schemas() ?? [])];
        assertUniqueToolSchemas(tools);
        return { tools: tools.map(({ truncatable: _truncatable, ...wire }) => wire) };
      }
      // Get base tools
      const tools: ToolSchema[] = getToolSchemas();

      // Add Lua tools if enabled — the repo-owned stdio adapter drives a stock
      // PoB checkout and supports the full action set
      if (this.luaClientManager.isEnabled()) {
        tools.push(...getLuaToolSchemas());
        tools.push(...buildCostSchemas());
        tools.push(...getConfigToolSchemas()); // Phase 9: Config tools (require Lua)
        tools.push(...getBuildGoalsToolSchemas()); // Build diagnostics (require Lua)
      }

      // Add optimization tools
      tools.push(...getOptimizationToolSchemas());

      // Add validation tools
      tools.push(...getValidationToolSchemas());

      // Add export and persistence tools
      tools.push(...getExportToolSchemas());

      // Add skill gem analysis tools
      tools.push(...getSkillGemToolSchemas());

      // Add Trade API tools if enabled
      if (this.tradeClient) {
        // Weighted search needs the Lua bridge (query generation) and an
        // authenticated session (the Trade API rejects anonymous weighted sums)
        const weightedAvailable = Boolean(process.env.POE_SESSION_ID)
          && this.luaClientManager.isEnabled();
        tools.push(...getTradeToolSchemas().filter((tool) => tool.name !== 'find_weighted_trade_items' || weightedAvailable));
        tools.push(...comparableToolSchemas());
      }

      // Add poe.ninja API tools (always available)
      tools.push(...getPoeNinjaToolSchemas());
      featureRegistry.assertNoCollisions(tools);
      tools.push(...featureRegistry.schemas());
      tools.push(...this.modifierFeatures.schemas());
      tools.push(...(this.marketFeatures?.schemas() ?? []));
      if (this.foundation) tools.push(...foundationSchemas, ...(this.foundationFeatures?.schemas() ?? []));
      assertUniqueToolSchemas(tools);

      // The truncatable flag is server-side policy, not part of the MCP wire
      // contract - strip it from what clients see.
      return { tools: tools.map(({ truncatable: _truncatable, ...wire }) => wire) };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const modifierFeature = this.modifierFeatures.get(name);
        if (modifierFeature) return await modifierFeature.invoke(args ?? {});
        const marketFeature = this.marketFeatures?.get(name);
        if (marketFeature) {
          if (this.foundationClosing) throw new Error('Market tools are unavailable during shutdown');
          const pending = Promise.resolve().then(() => marketFeature.invoke(args ?? {}));
          this.foundationPending.add(pending);
          try { return await pending; } finally { this.foundationPending.delete(pending); }
        }
        if (foundationSchemas.some(tool => tool.name === name)) {
          if (!this.foundation || this.foundationClosing) throw new Error('Foundation tools are unavailable');
          const pending = invokeFoundation(this.foundation, name, args ?? {}, this.foundationJobs ?? undefined, this.pobDirectory);
          this.foundationPending.add(pending);
          try {
            const result = await pending;
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
          } finally { this.foundationPending.delete(pending); }
        }
        // Migrated, stateless feature modules are independent of the legacy
        // mutable build and are available through the new surface as well.
        const feature = this.foundationFeatures?.get(name) ?? featureRegistry.get(name);
        if (feature && this.foundation) {
          if (this.foundationClosing) throw new Error('Foundation tools are unavailable');
          const pending = Promise.resolve().then(() => feature.invoke(args ?? {}));
          this.foundationPending.add(pending);
          try { return await pending; }
          finally { this.foundationPending.delete(pending); }
        }
        if (!this.legacyEnabled()) throw new Error('Legacy tools are unavailable');
        // Build router dependencies
        const routerDeps: ToolRouterDependencies = {
          contextBuilder: this.contextBuilder,
          tradeClient: this.tradeClient,
          statMapper: this.statMapper,
          recommendationEngine: this.recommendationEngine,
          ninjaClient: this.ninjaClient,
          buildCostPrices: this.buildCostPrices,
          getLuaClient: () => this.luaClientManager.getClient(),
          ensureLuaClient: () => this.luaClientManager.ensureClient(),
        };

        // Route the tool call
        const result = await routeToolCall(name, args, routerDeps);

        // Apply truncation for tools that opt in via their schema flag
        // (ToolSchema.truncatable). The old hand-maintained name list here
        // rotted - five unbounded-output tools had silently fallen outside
        // it, while new tools could never learn to opt in.
        if (shouldTruncate(name, this.allToolSchemas())) {
          return wrapWithTruncation(result);
        }

        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Log full stack trace for debugging
        console.error(`[Tool Error] tool=${name} error=${errorMsg}`);
        if (error instanceof Error && error.stack) {
          console.error(`[Tool Stack] ${error.stack}`);
        }
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error: ${errorMsg}`,
            },
          ],
        };
      }
    });
  }

  /**
   * Initialize async components
   */
  private async initialize() {
    const economy = new PoeNinjaAdapter();
    const market = [...createCurrencyReferenceTools(economy), createCurrencySpreadTool(economy)];
    // Do not create a second Trade rate limiter while the legacy client is enabled.
    const tradeEnabled = process.env.POE_TRADE_ENABLED === 'true' && !this.legacyEnabled();
    const rate = Number(process.env.POE_RATE_LIMIT_PER_SECOND ?? 4);
    const minTimeMs = Number.isFinite(rate) && rate > 0 ? Math.ceil(1000 / Math.min(rate, 4)) : 250;
    const trade = tradeEnabled ? new OfficialTradeAdapter({ minTimeMs, session: () => process.env.POE_SESSION_ID || undefined }) : null;
    if (trade) market.push(createSourceComparableTool(trade), createTradeSearchTool(trade), createTradeItemPriceTool(trade), createTradeListingComparisonTool(trade), createResistanceTradeTool(trade), createClusterTradeTool(trade), ...createTradeMetadataTools(trade));
    this.marketFeatures = new FeatureRegistry(market);
    if (process.env.POB_FOUNDATION_ENABLED === 'true') {
      const directory = process.env.POB_SNAPSHOT_DIRECTORY || path.join(this.pobDirectory, '.pob-snapshots');
      this.releaseFoundationLock = await acquireStoreLock(directory);
      const jobs = new JobStore(path.join(directory, 'jobs'));
      await jobs.markInterrupted();
      const store = new SnapshotStore(directory);
      let protectedIds: Set<string> | undefined;
      try { protectedIds = await jobs.protectedSnapshotIds(); }
      catch (error) { console.error('[Snapshot retention] Collection skipped because job references are unavailable:', error); }
      if (protectedIds) await store.collectExpired(protectedIds);
      const adapterPath = process.env.POB_ADAPTER_PATH || path.join(process.env.POB_REPO_ROOT!, 'lua', 'vanilla_stdio_bridge.lua');
      this.foundation = new BuildFoundation(store, () => openPoBEngine({
        cwd: process.env.POB_PATH || process.env.POB_FORK_PATH, command: process.env.POB_CMD,
        adapterPath, timeoutMs: process.env.POB_TIMEOUT_MS ? Number(process.env.POB_TIMEOUT_MS) : undefined,
      }));
      const foundation = this.foundation;
      this.foundationJobs = new JobRunner(jobs, input => foundation.evaluate(input.snapshotId, input.fields, input.options), 2,
        input => rankMasteryEffects(foundation, { snapshot_id: input.snapshotId, node_id: input.nodeId, effect_ids: [input.effectId], metric: input.metric, direction: input.direction }),
        async input => {
          const candidate = await foundation.deriveGemSetup(input.snapshotId, input.groupIndex, input.gems, true);
          try { return await compareSnapshotGemSetups(foundation, { snapshot_id: input.snapshotId, group_index: input.groupIndex, candidate_snapshot_ids: [candidate.id] }); }
          catch (error) { return { setupError: error instanceof Error ? error.message : String(error), candidateSnapshotId: candidate.id }; }
        }, input => evaluatePassive(foundation, input));
      const migrated = [createSnapshotCostTool(foundation, economy), createShoppingListTool(foundation, economy), createSnapshotTreeComparisonTool(foundation), createSnapshotBuildComparisonTool(foundation), createSnapshotGemComparisonTool(foundation), ...createGemSetupJobTools(foundation, this.foundationJobs), createSnapshotSupportRankingTool(foundation), ...createTreePathTools(foundation), createBuildIssuesTool(foundation), createBossReadinessTool(foundation), createMasteryRankingTool(foundation), createMasteryDiscoveryTool(foundation), ...createMasteryJobTools(foundation, this.foundationJobs), ...createPassiveRankingTools(foundation, this.foundationJobs), createAnointmentTool(foundation), createTimelessSearchTool(foundation)];
      if (trade) migrated.push(createTradePreviewTool(foundation, trade));
      this.foundationFeatures = new FeatureRegistry(migrated);
    }
    // StatMapper is intentionally static-only: the trade API /stats dump keys
    // everything by hashed ID (no PoB names), so swapping it in at startup used
    // to erase the curated aliases that search_stats matches against. Official
    // stat IDs enter queries via tradeQueryBuilder's own stat-id handling, not
    // via this class.
  }

  async run() {
    const transport = new StdioServerTransport();
    try { await this.initialize(); await this.server.connect(transport); }
    catch (error) {
      if (this.releaseFoundationLock) await this.releaseFoundationLock();
      throw error;
    }
    console.error("Path of Building MCP Server running on stdio");
  }
}

// Start the server
const server = new PoBMCPServer();
server.run().catch(error => { console.error(error); process.exitCode = 1; });
