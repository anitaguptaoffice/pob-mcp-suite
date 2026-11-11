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
import { openPoBEngine } from './adapters/pob/engine.js';
import { acquireStoreLock } from './foundation/storeLock.js';
import { JobStore } from './foundation/jobStore.js';
import { JobRunner } from './foundation/jobRunner.js';
import { foundationSchemas, invokeFoundation } from './foundation/mcpTools.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { defaultBuildsDirectory } from "./utils/pobLayout.js";
import { featureRegistry } from "./server/featureModules.js";
import { assertUniqueToolSchemas, FeatureRegistry } from "./server/featureRegistry.js";
import { PoeNinjaAdapter } from './adapters/poeNinja/poeNinjaAdapter.js';
import { createSnapshotCostTool, snapshotCostSchema } from './features/buildCost/snapshotTool.js';
import { createShoppingListTool, shoppingListSchema } from './features/shoppingList/tool.js';
import { OfficialTradeAdapter } from './adapters/officialTrade/officialTradeAdapter.js';
import { createSourceComparableTool, sourceComparableSchema } from './features/tradeComparable/sourceTool.js';
import { createTradeMetadataTools, tradeMetadataSchemas } from './features/tradeMetadata/tools.js';
import { createStaticStatMappingTool, staticStatMappingSchema } from './features/tradeMetadata/staticMappings.js';
import { createWeightedTradeTools, weightedTradeSchemas } from './features/weightedTrade/tool.js';
import { createStatCategoriesTool, statCategoriesSchema } from './features/statCategories/tool.js';
import { createEquipmentAnalysisTool, equipmentAnalysisSchema } from './features/equipmentAnalysis/tool.js';
import { createLevelingTool, levelingSchema } from './features/leveling/tool.js';
import { createBudgetCandidatesTool, budgetCandidatesSchema } from './features/budgetCandidates/tool.js';
import { createBudgetBundleTool, budgetBundleSchema } from './features/budgetCandidates/bundle.js';
import { StatMapper as StaticStatCatalog } from './adapters/staticStats/catalog.js';
import { createTradeSearchTool, tradeSearchSchema } from './features/tradeSearch/tool.js';
import { createTradeItemPriceTool, tradeItemPriceSchema } from './features/tradePrice/tool.js';
import { createSnapshotTreeComparisonTool, snapshotTreeComparisonSchema } from './features/treeComparison/tool.js';
import { createSnapshotTreeTransplantTool, snapshotTreeTransplantSchema } from './features/treeTransplant/tool.js';
import { createSnapshotBuildComparisonTool, snapshotBuildComparisonSchema } from './features/buildComparison/tool.js';
import { createSnapshotGemComparisonTool, snapshotGemComparisonSchema, compareSnapshotGemSetups } from './features/snapshotGemComparison/tool.js';
import { createSupportContributionsTool, supportContributionsSchema } from './features/snapshotGemComparison/contributions.js';
import { createGemSetupJobTools, gemSetupJobSchemas } from './features/snapshotGemComparison/jobTools.js';
import { createSnapshotSupportRankingTool, supportRankingSchema } from './features/snapshotSupportRanking/tool.js';
import { createDiscoveredSupportRankingTool, discoveredSupportRankingSchema } from './features/snapshotSupportRanking/discovered.js';
import { createTreePathTools, treePathSchemas } from './features/treePaths/tool.js';
import { createPassiveSuggestionsTool, passiveSuggestionsSchema } from './features/passiveSuggestions/tool.js';
import { createGemUpgradeTool, gemUpgradeSchema } from './features/gemUpgrade/tool.js';
import { buildIssuesSchema, createBuildIssuesTool } from './features/buildIssues/tool.js';
import { bossReadinessSchema, createBossReadinessTool } from './features/bossReadiness/tool.js';
import { masteryRankingSchema, createMasteryRankingTool, masteryDiscoverySchema, createMasteryDiscoveryTool, rankMasteryEffects } from './features/masteryRanking/tool.js';
import { masteryJobSchemas, createMasteryJobTools } from './features/masteryRanking/jobTools.js';
import { passiveRankingSchemas, createPassiveRankingTools, evaluatePassive } from './features/passiveRanking/tool.js';
import { anointmentSchema, createAnointmentTool } from './features/anointment/tool.js';
import { snapshotSummarySchema, createSnapshotSummaryTool } from './features/buildSummary/tool.js';
import { skillInspectionSchema, createSkillInspectionTool } from './features/skillInspection/tool.js';
import { enemyConfigSchema, createEnemyConfigTool } from './features/enemyConfig/tool.js';
import { snapshotAilmentsSchema, createSnapshotAilmentsTool } from './features/ailments/tool.js';
import { snapshotDefensesSchema, createSnapshotDefensesTool } from './features/defenses/tool.js';
import { craftingContextSchema, createCraftingContextTool } from './features/craftingContext/tool.js';
import { PoedbBaseReference } from './adapters/baseReference/poedb.js';
import { PoBItemDataAdapter } from './adapters/pobItemData/source.js';
import { itemAffixWeightSchema, createItemAffixWeightTool } from './features/affixWeight/sourceTool.js';
import { EngineLimiter } from './foundation/engineLimiter.js';
import { PoBEngineStatusAdapter } from './adapters/pobEngineStatus/source.js';
import { engineStatusSchema, createEngineStatusTool } from './features/engineStatus/tool.js';
import { clusterAnalysisSchema, createClusterAnalysisTool } from './features/clusterAnalysis/tool.js';
import { officialTreeSchema, createOfficialTreeTool } from './features/officialTree/tool.js';
import { decodeOfficialTreeCode } from './adapters/pob/officialTreeCode.js';
import { createClusterFileTool } from './features/clusterAnalysis/fileTool.js';
import { readLocalBuild } from './foundation/localBuildFile.js';
import { PoBWatchersEyeSource } from './adapters/watchersEye/pobSource.js';
import { watchersEyeSchema, createWatchersEyeTool } from './features/watchersEye/tool.js';
import { jewelComparisonSchema, createJewelComparisonTool } from './features/jewelComparison/tool.js';
import { jewelJobSchemas, createJewelJobTools } from './features/jewelComparison/jobTools.js';
import { createModifierDataTools } from './features/modifierData/tools.js';
import { PoBModifierData } from './adapters/modifierData/pobModifierData.js';
import { LocalBuildFileCatalog } from './adapters/localBuild/fileCatalog.js';
import { createBuildFileCatalogTool } from './features/localBuildCatalog/tool.js';
import { LocalBuildFileWatcher } from './adapters/localBuild/fileWatcher.js';
import { createBuildWatchTools } from './features/localBuildWatch/tools.js';
import { LocalConfigPresetStore } from './adapters/localBuild/configPresetStore.js';
import { configPresetSchemas, createConfigPresetCatalogTools, createSnapshotConfigPresetTools } from './features/configPresets/tools.js';
import { createCurrencyReferenceTools, currencyReferenceSchemas } from './features/currencyReference/tools.js';
import { createCurrencySpreadTool, currencySpreadSchema } from './features/currencySpread/tool.js';
import { createTradePreviewTool, tradePreviewSchema } from './features/tradePreview/tool.js';
import { createTradeListingComparisonTool, tradeListingComparisonSchema } from './features/tradeListingComparison/tool.js';
import { createResistanceTradeTool, resistanceTradeSchema } from './features/resistanceTrade/tool.js';
import { createClusterTradeTool, clusterTradeSchema } from './features/clusterTrade/tool.js';
import { createTimelessSearchTool, timelessSearchSchema } from './features/timelessSearch/tool.js';
import { createCachedStatsTool, cachedStatsSchema } from './features/cachedStats/tool.js';
import { createUpstreamTreeTool } from './features/upstreamTree/tool.js';
import { GitHubUpstreamTree } from './adapters/upstreamTree/github.js';

// Import server modules
import type { ToolSchema } from "./server/toolSchema.js";

class PoBMCPServer {
  private server: Server;
  private pobDirectory: string;
  private foundation: BuildFoundation | null = null;
  private foundationFeatures: FeatureRegistry | null = null;
  private readonly modifierFeatures = new FeatureRegistry(createModifierDataTools(new PoBModifierData()));
  private readonly upstreamTreeFeatures = new FeatureRegistry([createUpstreamTreeTool(new GitHubUpstreamTree())]);
  private buildFileCatalog!: FeatureRegistry;
  private localBuildWatcher!: LocalBuildFileWatcher;
  private localConfigPresets!: LocalConfigPresetStore;
  private configPresetCatalog!: FeatureRegistry;
  private marketFeatures: FeatureRegistry | null = null;
  private foundationJobs: JobRunner | null = null;
  private releaseFoundationLock: (() => Promise<void>) | null = null;
  private foundationClosing = false;
  private foundationPending = new Set<Promise<unknown>>();

  private officialTrade: OfficialTradeAdapter | null = null;

  /**
   * Every registered schema across all capability groups, including groups a
   * given runtime disables. Used only to validate unique names at startup;
   * clients see the per-runtime subset assembled in the ListTools handler.
   */
  private registeredSchemas(): ToolSchema[] {
    const registered = [
      ...foundationSchemas,
      snapshotCostSchema(),
      shoppingListSchema(),
      sourceComparableSchema(),
      ...tradeMetadataSchemas(),
      staticStatMappingSchema(),
      ...weightedTradeSchemas(),
      statCategoriesSchema(),
      equipmentAnalysisSchema(),
      levelingSchema(),
      budgetCandidatesSchema(),
      budgetBundleSchema(),
      tradeSearchSchema(),
      tradeItemPriceSchema(),
      snapshotTreeComparisonSchema(),
      snapshotTreeTransplantSchema(),
      snapshotBuildComparisonSchema(),
      snapshotGemComparisonSchema(),
      supportContributionsSchema(),
      ...gemSetupJobSchemas(),
      supportRankingSchema(),
      discoveredSupportRankingSchema(),
      ...treePathSchemas(),
      passiveSuggestionsSchema(),
      gemUpgradeSchema(),
      buildIssuesSchema(),
      bossReadinessSchema(),
      masteryRankingSchema(),
      masteryDiscoverySchema(),
      ...masteryJobSchemas(),
      ...passiveRankingSchemas(),
      anointmentSchema(),
      snapshotSummarySchema(),
      skillInspectionSchema(),
      enemyConfigSchema(),
      snapshotAilmentsSchema(),
      snapshotDefensesSchema(),
      craftingContextSchema(),
      itemAffixWeightSchema(),
      engineStatusSchema(),
      clusterAnalysisSchema(),
      officialTreeSchema(),
      watchersEyeSchema(),
      jewelComparisonSchema(),
      ...jewelJobSchemas(),
      ...this.modifierFeatures.schemas(),
      ...this.upstreamTreeFeatures.schemas(),
      ...this.buildFileCatalog.schemas(),
      ...this.configPresetCatalog.schemas(),
      ...configPresetSchemas().slice(2),
      ...currencyReferenceSchemas(),
      currencySpreadSchema(),
      tradePreviewSchema(),
      tradeListingComparisonSchema(),
      resistanceTradeSchema(),
      clusterTradeSchema(),
      timelessSearchSchema(),
      cachedStatsSchema('snapshot'),
    ];
    const all = [...featureRegistry.schemas(), ...registered];
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
          tools: {},
        },
      }
    );

    // Default Path of Building directory (can be customized)
    this.pobDirectory = process.env.POB_DIRECTORY || defaultBuildsDirectory();
    this.localBuildWatcher = new LocalBuildFileWatcher(this.pobDirectory);
    this.buildFileCatalog = new FeatureRegistry([createBuildFileCatalogTool(new LocalBuildFileCatalog(this.pobDirectory)), createClusterFileTool(name => readLocalBuild(this.pobDirectory, name)), createCachedStatsTool('local', name => readLocalBuild(this.pobDirectory, name)), ...createBuildWatchTools(this.localBuildWatcher)]);
    this.localConfigPresets = new LocalConfigPresetStore(this.pobDirectory);
    this.configPresetCatalog = new FeatureRegistry(createConfigPresetCatalogTools(this.localConfigPresets));

    // Trade features share one source, queue and cache.
    if (process.env.POE_TRADE_ENABLED === 'true') {
      const rate = Number(process.env.POE_RATE_LIMIT_PER_SECOND ?? 4);
      const minTimeMs = Number.isFinite(rate) && rate > 0 ? Math.ceil(1000 / Math.min(rate, 4)) : 250;
      this.officialTrade = new OfficialTradeAdapter({ minTimeMs, session: () => process.env.POE_SESSION_ID || undefined });
    }
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
        this.localBuildWatcher.stop(), this.server.close(),
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

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = [...foundationSchemas, ...featureRegistry.schemas(), ...(this.foundationFeatures?.schemas() ?? []),
        ...this.modifierFeatures.schemas(), ...this.upstreamTreeFeatures.schemas(), ...this.buildFileCatalog.schemas(),
        ...this.configPresetCatalog.schemas(), ...(this.marketFeatures?.schemas() ?? [])];
      assertUniqueToolSchemas(tools);
      return { tools };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const modifierFeature = this.modifierFeatures.get(name);
        if (modifierFeature) return await modifierFeature.invoke(args ?? {}) as any;
        const upstreamTreeFeature = this.upstreamTreeFeatures.get(name);
        if (upstreamTreeFeature) {
          if (this.foundationClosing) throw new Error('Upstream tree source is unavailable during shutdown');
          const pending = Promise.resolve().then(() => upstreamTreeFeature.invoke(args ?? {})) as Promise<any>;
          this.foundationPending.add(pending);
          try { return await pending; } finally { this.foundationPending.delete(pending); }
        }
        const catalogFeature = this.buildFileCatalog.get(name) ?? this.configPresetCatalog.get(name);
        if (catalogFeature) {
          if (this.foundationClosing) throw new Error('Build catalog is unavailable during shutdown');
          const pending = Promise.resolve().then(() => catalogFeature.invoke(args ?? {})) as Promise<any>;
          this.foundationPending.add(pending);
          try { return await pending; } finally { this.foundationPending.delete(pending); }
        }
        const marketFeature = this.marketFeatures?.get(name);
        if (marketFeature) {
          if (this.foundationClosing) throw new Error('Market tools are unavailable during shutdown');
          const pending = Promise.resolve().then(() => marketFeature.invoke(args ?? {})) as Promise<any>;
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
        // Stateless feature modules read a snapshot or the official Trade API.
        const feature = this.foundationFeatures?.get(name) ?? featureRegistry.get(name);
        if (feature && this.foundation) {
          if (this.foundationClosing) throw new Error('Foundation tools are unavailable');
          const pending = Promise.resolve().then(() => feature.invoke(args ?? {})) as Promise<any>;
          this.foundationPending.add(pending);
          try { return await pending; }
          finally { this.foundationPending.delete(pending); }
        }
        throw new Error(`Unknown tool: ${name}`);
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
    this.registeredSchemas(); // Validate every registered name, including disabled capability groups.
    const economy = new PoeNinjaAdapter();
    const market = [...createCurrencyReferenceTools(economy), createCurrencySpreadTool(economy), createStaticStatMappingTool(new StaticStatCatalog())];
    const trade = this.officialTrade;
    if (trade) market.push(createSourceComparableTool(trade), createTradeSearchTool(trade), createTradeItemPriceTool(trade), createTradeListingComparisonTool(trade), createResistanceTradeTool(trade), createClusterTradeTool(trade), ...createTradeMetadataTools(trade));
    this.marketFeatures = new FeatureRegistry(market);
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
    const openEngine = () => openPoBEngine({
      cwd: process.env.POB_PATH, command: process.env.POB_CMD,
      adapterPath, timeoutMs: process.env.POB_TIMEOUT_MS ? Number(process.env.POB_TIMEOUT_MS) : undefined,
    });
    const probe = await openEngine();
    try {
      console.error(`[PoB] engine verified: ${probe.identity.engineVersion ?? 'unknown engine version'}`);
    } finally {
      await probe.close();
    }
    const engineLimiter = new EngineLimiter(openEngine);
    this.foundation = new BuildFoundation(store, openEngine, engineLimiter);
    const foundation = this.foundation;
    this.foundationJobs = new JobRunner(jobs, input => foundation.evaluate(input.snapshotId, input.fields, input.options), 2,
      input => rankMasteryEffects(foundation, { snapshot_id: input.snapshotId, node_id: input.nodeId, effect_ids: [input.effectId], metric: input.metric, direction: input.direction }),
      async input => {
        const candidate = await foundation.deriveGemSetup(input.snapshotId, input.groupIndex, input.gems, true);
        try { return await compareSnapshotGemSetups(foundation, { snapshot_id: input.snapshotId, group_index: input.groupIndex, candidate_snapshot_ids: [candidate.id] }); }
        catch (error) { return { setupError: error instanceof Error ? error.message : String(error), candidateSnapshotId: candidate.id }; }
      }, input => evaluatePassive(foundation, input), async (input, onDerived) => {
        const response = await createJewelComparisonTool(foundation, onDerived).invoke({ snapshot_id: input.snapshotId, socket_node_id: input.socketNodeId, fields: input.fields, candidates: [{ name: input.name, item_text: input.itemText }] });
        return JSON.parse(response.content[0].text);
      });
    const buildTools = [createSnapshotCostTool(foundation, economy), createShoppingListTool(foundation, economy), createSnapshotTreeComparisonTool(foundation), createSnapshotBuildComparisonTool(foundation), createSnapshotGemComparisonTool(foundation), ...createGemSetupJobTools(foundation, this.foundationJobs), createSnapshotSupportRankingTool(foundation), createDiscoveredSupportRankingTool(foundation), ...createTreePathTools(foundation), createBuildIssuesTool(foundation), createBossReadinessTool(foundation), createMasteryRankingTool(foundation), createMasteryDiscoveryTool(foundation), ...createMasteryJobTools(foundation, this.foundationJobs), ...createPassiveRankingTools(foundation, this.foundationJobs), createAnointmentTool(foundation), createSnapshotSummaryTool(foundation), createSkillInspectionTool(foundation), createEnemyConfigTool(foundation), ...createSnapshotConfigPresetTools(foundation, this.localConfigPresets), createTimelessSearchTool(foundation)];
    buildTools.push(createSnapshotTreeTransplantTool(foundation));
    buildTools.push(createSupportContributionsTool(foundation));
    buildTools.push(createCachedStatsTool('snapshot', id => foundation.exportBuild(id)));
    buildTools.push(createPassiveSuggestionsTool(foundation));
    buildTools.push(createGemUpgradeTool(foundation));
    buildTools.push(createSnapshotAilmentsTool(foundation));
    buildTools.push(createSnapshotDefensesTool(foundation));
    buildTools.push(createCraftingContextTool(foundation, new PoedbBaseReference()));
    buildTools.push(createItemAffixWeightTool(new PoBItemDataAdapter(engineLimiter)));
    buildTools.push(createEngineStatusTool(new PoBEngineStatusAdapter(engineLimiter)));
    buildTools.push(createClusterAnalysisTool(foundation));
    buildTools.push(createOfficialTreeTool(foundation, decodeOfficialTreeCode));
    buildTools.push(createWatchersEyeTool(foundation, new PoBWatchersEyeSource()));
    buildTools.push(createJewelComparisonTool(foundation));
    buildTools.push(...createJewelJobTools(foundation, this.foundationJobs));
    buildTools.push(...createWeightedTradeTools(foundation, trade ?? undefined, () => Boolean(process.env.POE_SESSION_ID)));
    buildTools.push(createStatCategoriesTool(foundation));
    buildTools.push(createEquipmentAnalysisTool(foundation));
    buildTools.push(createLevelingTool(foundation));
    if (trade) buildTools.push(createTradePreviewTool(foundation, trade));
    if (trade) buildTools.push(createBudgetCandidatesTool(foundation, trade), createBudgetBundleTool(foundation, trade));
    this.foundationFeatures = new FeatureRegistry(buildTools);
    // Static aliases and official stat metadata have different keys and roles.
    // Keep alias lookup independent of the official API's hashed stat IDs.
  }

  async run() {
    const transport = new StdioServerTransport();
    try { await this.initialize(); await this.server.connect(transport); }
    catch (error) {
      const cleanup = await Promise.allSettled([this.releaseFoundationLock?.()]);
      for (const result of cleanup) if (result.status === 'rejected') console.error('[Startup Cleanup Error]', result.reason);
      throw error;
    }
    console.error("Path of Building MCP Server running on stdio");
  }
}

// Start the server
const server = new PoBMCPServer();
server.run().catch(error => { console.error(error); process.exitCode = 1; });
