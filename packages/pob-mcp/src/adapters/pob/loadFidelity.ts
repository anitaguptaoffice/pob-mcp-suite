import { XMLParser } from 'fast-xml-parser';

/** Check explicit saved tree state; XML is input, never a replacement save. */
export async function verifyLoadedTree(xml: string, readTree: () => Promise<unknown>): Promise<void> {
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false,
    isArray: name => name === 'Spec' }).parse(xml);
  const tree = parsed?.PathOfBuilding?.Tree;
  if (!tree || !Array.isArray(tree.Spec)) return;
  const spec = tree.Spec[Number(tree.activeSpec ?? 1) - 1];
  if (!spec) throw new Error('PoB source has no selected passive spec');
  const saved = typeof spec.nodes === 'string' ? spec.nodes.split(',').map((id: string) => id.trim()).filter(Boolean) : [];
  if (saved.some((id: string) => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new Error('PoB source contains invalid passive node IDs');
  const actual = await readTree() as { treeVersion?: string; nodes?: number[]; masteryEffects?: Record<string, number> };
  if (!actual || !Array.isArray(actual.nodes)) throw new Error('PoB did not report the loaded passive tree');
  if (spec.treeVersion && actual.treeVersion !== spec.treeVersion) throw new Error(`PoB changed the saved tree version: ${spec.treeVersion} -> ${actual.treeVersion ?? 'unknown'}. Original XML is unchanged.`);
  const nodes = new Set(actual.nodes);
  const missing = saved.map(Number).filter((id: number) => !nodes.has(id));
  if (missing.length) throw new Error(`PoB dropped ${missing.length} saved passive nodes on load: ${missing.slice(0, 20).join(', ')}. Original XML is unchanged.`);
  if (typeof spec.masteryEffects === 'string') {
    for (const match of spec.masteryEffects.matchAll(/\{(\d+),(\d+)\}/g)) {
      if (actual.masteryEffects?.[match[1]] !== Number(match[2])) throw new Error(`PoB changed the saved mastery on node ${match[1]}. Original XML is unchanged.`);
    }
  }
}
