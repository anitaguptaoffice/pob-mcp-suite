import type { BuildEngine, BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { toFiniteNumber } from '../../pobLuaBridge.js';

const defaultFields = ['Life', 'EnergyShield', 'Mana', 'ManaUnreserved', 'TotalDPS', 'CombinedDPS', 'FullDPS', 'MinionTotalDPS', 'MinionCombinedDPS', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'Armour', 'Evasion', 'TotalEHP', 'LifeRegen', 'SpellSuppressionChance', 'BlockChance'];
type Section = { status: 'available'; value: unknown } | { status: 'unavailable'; reason: string };
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
export function snapshotSummarySchema(): FeatureTool['schema'] {
  return { name: 'summarize_snapshot_build', description: 'Read one snapshot in one PoB engine and return build, selected skills, tree nodes, equipment, config and requested metrics, preserving missing sections and values.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, fields: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'string' } }, include_item_text: { type: 'boolean' } }, required: ['snapshot_id'] } };
}
export function createSnapshotSummaryTool(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>): FeatureTool {
  return { schema: snapshotSummarySchema(), invoke: async args => {
    const fields = args.fields ?? defaultFields;
    if (Object.keys(args).some(key => !['snapshot_id', 'fields', 'include_item_text'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || !Array.isArray(fields) || fields.length < 1 || fields.length > 100 || fields.some(field => typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(field)) || new Set(fields).size !== fields.length || (args.include_item_text !== undefined && typeof args.include_item_text !== 'boolean')) throw new Error('Invalid snapshot summary options');
    const { result, ...context } = await foundation.runReadOnlySnapshot(args.snapshot_id, async (engine: BuildEngine) => {
      const read = async (action: () => Promise<unknown>, valid: (value: unknown) => boolean): Promise<Section> => {
        try { const value = await action(); if (!valid(value)) throw new Error('PoB returned an invalid section'); return { status: 'available', value }; }
        catch (error) { return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) }; }
      };
      const build = await read(() => engine.getBuildInfo(), object);
      const stats = await read(() => engine.getStats(fields as string[]), object);
      const skills = await read(() => engine.getSkills(), value => object(value) && Array.isArray(value.groups));
      const tree = await read(() => engine.getTree(), value => object(value) && typeof value.treeVersion === 'string' && Array.isArray(value.nodes) && value.nodes.every((node: unknown) => typeof node === 'number' && Number.isSafeInteger(node) && node > 0) && new Set(value.nodes).size === value.nodes.length);
      const items = await read(() => engine.getItems(), value => Array.isArray(value) && value.every(item => object(item) && typeof item.slot === 'string' && Number.isSafeInteger(item.id) && item.id >= 0));
      const config = await read(() => engine.getConfig(), value => object(value) || Array.isArray(value) && value.length === 0);
      const nodeDetails = await read(() => engine.queryTreePaths({ allocatedOnly: true }), value => {
        if (!object(value) || value.mode !== 'allocated' || typeof value.treeVersion !== 'string' || !Array.isArray(value.nodes) || !Array.isArray(value.missingIds) || value.nodes.some((node: unknown) => !object(node) || !Number.isSafeInteger(node.id) || node.id < 1 || node.allocated !== true || typeof node.name !== 'string' || !node.name || typeof node.nameKnown !== 'boolean' || typeof node.type !== 'string' || !Array.isArray(node.stats) || node.stats.some((stat: unknown) => typeof stat !== 'string')) || value.missingIds.some((id: unknown) => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)) return false;
        const ids = [...value.nodes.map((node: Record<string, any>) => node.id), ...value.missingIds];
        if (new Set(ids).size !== ids.length) return false;
        if (tree.status !== 'available') return true;
        const observedTree = tree.value;
        return object(observedTree) && value.treeVersion === observedTree.treeVersion && ids.length === observedTree.nodes.length && ids.every(id => observedTree.nodes.includes(id));
      });
      return { build, stats, skills, tree, items, config, nodeDetails };
    });
    const sections = { ...result };
    let metrics: Record<string, unknown> | null = null;
    if (result.stats.status === 'available' && object(result.stats.value)) {
      metrics = Object.fromEntries((fields as string[]).map(field => { const raw = (result.stats as { value: Record<string, unknown> }).value[field]; const numeric = typeof raw === 'number' || typeof raw === 'string' && raw.trim() ? toFiniteNumber(raw) : undefined; return [field, numeric === undefined ? { status: 'unknown', value: null } : { status: 'available', value: numeric }]; }));
    }
    if (result.items.status === 'available' && Array.isArray(result.items.value)) sections.items = { status: 'available', value: result.items.value.filter(item => item.id > 0).map(item => { if (args.include_item_text === true) return item; const { raw: _raw, ...compact } = item; return compact; }) };
    if (result.config.status === 'available' && Array.isArray(result.config.value) && result.config.value.length === 0) sections.config = { status: 'available', value: {} };
    const missingMetrics = metrics ? Object.entries(metrics).filter(([, value]) => (value as { status: string }).status !== 'available').map(([name]) => name) : fields;
    const unresolvedNodes = result.nodeDetails.status === 'available' && object(result.nodeDetails.value) ? [...result.nodeDetails.value.missingIds, ...result.nodeDetails.value.nodes.filter((node: { nameKnown: boolean }) => !node.nameKnown).map((node: { id: number }) => node.id)] : null;
    const unavailable = Object.entries(sections).filter(([, value]) => value.status !== 'available').map(([name]) => name === 'nodeDetails' ? 'allocatedNodeDetails' : name);
    return { content: [{ type: 'text', text: JSON.stringify({ ...context, status: unavailable.length || missingMetrics.length || unresolvedNodes === null || unresolvedNodes.length ? 'partial' : 'complete', sections: { build: sections.build, skills: sections.skills, tree: sections.tree, allocatedNodeDetails: sections.nodeDetails, items: sections.items, config: sections.config }, metrics, missingMetrics, unavailableSections: unavailable, unresolvedNodeIds: unresolvedNodes, includeItemText: args.include_item_text === true, warnings: [...context.warnings, 'These are PoB observations in the saved skill and configuration, not validation of game legality or actual combat performance.', 'Player, minion and full DPS may overlap; do not add them blindly. Missing metrics and sections are unknown.', 'Items include all occupied slots, including hidden or inactive slots; item text is omitted unless explicitly requested.', ...(result.tree.status !== 'available' ? ['Allocated node details could not be cross-checked against the tree section.'] : []), ...(Array.isArray(unresolvedNodes) && unresolvedNodes.length ? ['Some allocated node IDs or names were not resolved by PoB.'] : [])] }) }] };
  } };
}
