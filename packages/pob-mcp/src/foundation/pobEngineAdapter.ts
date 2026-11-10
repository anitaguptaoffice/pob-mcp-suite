import { PoBLuaApiClient } from '../pobLuaBridge.js';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { resolvePoBLayout } from '../utils/pobLayout.js';
import { digestDirectory } from './contentDigest.js';
import { digestExecutable, resolveExecutable } from './executableIdentity.js';
import type { BuildEngine } from './buildFoundation.js';

export interface PoBEngineOptions {
  cwd?: string;
  command?: string;
  adapterPath: string;
  timeoutMs?: number;
}

/** Start a disposable bridge for one foundation operation. */
export async function openPoBEngine(options: PoBEngineOptions): Promise<BuildEngine> {
  const layout = resolvePoBLayout(options.cwd || process.env.POB_PATH || process.env.POB_FORK_PATH);
  const src = layout.src;
  const runtimeDir = layout.kind === 'checkout' ? path.join(path.dirname(src), 'runtime') : null;
  const runtimeDigest = async (): Promise<string | null> => {
    if (!runtimeDir) return null;
    const exists = await fs.stat(runtimeDir).then(stat => stat.isDirectory()).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    return exists ? digestDirectory(runtimeDir) : null;
  };
  const adapterDir = path.dirname(options.adapterPath);
  const executable = await resolveExecutable(options.command || 'luajit', src);
  const executableBefore = executable ? await digestExecutable(executable) : null;
  const [sourceDigest, adapterDigest, runtimeBefore] = await Promise.all([digestDirectory(src), digestDirectory(adapterDir), runtimeDigest()]);
  const verifyIdentity = async () => {
    const [currentSource, currentAdapter, currentRuntime, currentExecutable] = await Promise.all([
      digestDirectory(src), digestDirectory(adapterDir), runtimeDigest(), executable ? digestExecutable(executable) : Promise.resolve(null),
    ]);
    if (sourceDigest !== currentSource || adapterDigest !== currentAdapter || runtimeBefore !== currentRuntime || executableBefore !== currentExecutable) {
      throw new Error('PoB source, adapter, runtime or executable changed during operation');
    }
  };
  const client = new PoBLuaApiClient({ cwd: options.cwd, cmd: executable ?? options.command,
    args: [options.adapterPath], env: { POB_API_STDIO: '0' }, timeoutMs: options.timeoutMs });
  let identity: BuildEngine['identity'];
  try {
    await client.start();
    const capabilities = await client.getCapabilities();
    if (!capabilities.actions?.includes('unchanged_items_snapshot') || !capabilities.actions?.includes('refresh_tree_progress') || !capabilities.actions?.includes('set_calcs_selection')) {
      throw new Error('PoB adapter lacks required foundation actions');
    }
    const version = await client.getVersion();
    const valid = (value: unknown): string | null => typeof value === 'string' && value.trim() && value !== '?' ? value : null;
    await verifyIdentity();
    identity = { engineVersion: valid(version.number),
      adapterVersion: `${valid(version.adapter) ?? 'unknown'}:${adapterDigest}`,
      dataVersion: `pob-src:${sourceDigest}`, runtimeVersion: runtimeBefore, executableVersion: executableBefore };
  } catch (error) {
    try { await client.stop(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'PoB engine startup and cleanup failed'); }
    throw error;
  }
  return {
    identity, verifyIdentity,
    loadBuildXml: xml => client.loadBuildXml(xml), getStats: fields => client.getStats(fields),
    setLevel: level => client.setLevel(level), setMainSelection: selection => client.setMainSelection(selection), setCalcsSelection: index => client.setCalcsSelection(index),
    setConfig: config => client.setConfig(config), getBuildInfo: () => client.getBuildInfo(),
    captureSnapshot: () => client.unchangedItemsSnapshot(), getTree: () => client.getTree(),
    refreshTreeProgress: () => client.refreshTreeProgress(), searchNodes: params => client.searchNodes(params), getMasteryOptions: () => client.getMasteryOptions(), getMasteryNodeOptions: nodeId => client.getMasteryNodeOptions(nodeId), updateTreeDelta: params => client.updateTreeDelta(params),
    getItems: () => client.getItems(), addItem: (text, slot) => client.addItem(text, slot), getItemAffixWeight: (modId, itemText) => client.getItemAffixWeight(modId, itemText), getSkills: () => client.getSkills(),
    setGemLevel: params => client.setGemLevel(params), setGemQuality: params => client.setGemQuality(params), setGemEnabled: params => client.setGemEnabled(params),
    addGem: params => client.addGem(params), removeGem: params => client.removeGem(params),
    createSocketGroup: params => client.createSocketGroup(params),
    setSocketGroupEnabled: params => client.setSocketGroupEnabled(params),
    removeSkill: params => client.removeSkill(params),
    setFlaskActive: (index, active) => client.setFlaskActive(index, active),
    listItemSets: () => client.listItemSets(), selectItemSet: id => client.selectItemSet(id),
    listSpecs: () => client.listSpecs(), selectSpec: index => client.selectSpec(index),
    getCompatibleSupports: params => client.getCompatibleSupports(params),
    getConfig: () => client.getConfig(), close: () => client.stop(),
  };
}
