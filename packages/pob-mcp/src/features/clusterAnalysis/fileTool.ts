import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { MAX_BUILD_BYTES } from '../../foundation/shareCode.js';

type Row = Record<string, any>;
const object = (x: unknown): x is Row => !!x && typeof x === 'object' && !Array.isArray(x);
const array = (x: unknown): unknown[] => x == null ? [] : Array.isArray(x) ? x : [x];
const positive = (x: unknown): number | null => { const n = typeof x === 'string' && /^\d+$/.test(x) ? Number(x) : x; return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null; };

/** The saved XML describes assignments; it does not resolve PoB's runtime graph. */
export function analyzeClusterFile(xml: string) {
  if (typeof xml !== 'string' || !xml.trim() || Buffer.byteLength(xml, 'utf8') > MAX_BUILD_BYTES || /<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid or unsupported PoB XML');
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false, parseTagValue: false }).parse(xml);
  const root = doc?.PathOfBuilding, tree = root?.Tree, itemsNode = root?.Items === '' ? {} : root?.Items;
  if (!object(root) || !object(tree) || !object(itemsNode)) throw new Error('Build is missing tree or items');
  const specs = array(tree.Spec), active = tree['@_activeSpec'] === undefined ? 1 : positive(tree['@_activeSpec']);
  if (!active || active > specs.length || (specs[active - 1] !== '' && !object(specs[active - 1]))) throw new Error('Invalid active tree spec');
  const spec = (specs[active - 1] === '' ? {} : specs[active - 1]) as Row, rawNodes = spec['@_nodes'];
  const nodeParts = typeof rawNodes === 'string' && /^(?:\d+(?:,\d+)*)?$/.test(rawNodes) ? (rawNodes ? rawNodes.split(',').map(Number) : []) : null;
  const nodeList = nodeParts && nodeParts.every(Number.isSafeInteger) ? new Set(nodeParts) : null;
  const itemMap = new Map<number, string | null>();
  for (const item of array(itemsNode.Item)) {
    if (!object(item)) throw new Error('Invalid item entry');
    const id = positive(item['@_id']);
    if (!id || itemMap.has(id)) throw new Error('Invalid or duplicate item ID');
    itemMap.set(id, typeof item['#text'] === 'string' ? item['#text'] : null);
  }
  const socketDataAvailable = Object.hasOwn(spec, 'Sockets');
  if (socketDataAvailable && spec.Sockets !== '' && !object(spec.Sockets)) throw new Error('Invalid socket collection');
  const sockets = object(spec.Sockets) ? array(spec.Sockets.Socket) : [];
  const seen = new Set<number>(), jewels: Row[] = [], unresolved: Row[] = [];
  for (const socket of sockets) {
    if (!object(socket)) throw new Error('Invalid socket entry');
    const socketNodeId = positive(socket['@_nodeId']);
    if (!socketNodeId || seen.has(socketNodeId)) throw new Error('Invalid or duplicate socket node');
    seen.add(socketNodeId);
    if (String(socket['@_itemId']) === '0') continue;
    const itemId = positive(socket['@_itemId']);
    if (!itemId || !itemMap.get(itemId)) { unresolved.push({ socketNodeId, itemId: itemId ?? null }); continue; }
    const raw = itemMap.get(itemId)!;
    const lines = raw.split(/\r?\n/).map(line => line.trim());
    const base = lines.find(line => /^(?:Large|Medium|Small) Cluster Jewel$/i.test(line));
    if (!base) continue;
    const countLine = lines.find(line => /^Cluster Jewel Node Count:\s*\d+$/i.test(line));
    const levelLine = lines.find(line => /^Item Level:\s*\d+$/i.test(line));
    const passiveDescriptions = lines.filter(line => /Added Small Passive Skills grant:|Added Passive Skills are:/i.test(line));
    const notableNames = [...new Set(lines.flatMap(line => {
      const cleaned = line.replace(/^(?:\{[^}]*\})+/, '').trim();
      const match = /^(?:\d+ Added Passive Skills? (?:is|are)|Allocates)\s+(.+)$/i.exec(cleaned);
      return match ? [match[1]] : [];
    }))];
    jewels.push({ socketNodeId, itemId, baseName: base, serializedNodePresent: nodeList ? nodeList.has(socketNodeId) : null,
      nodeCount: countLine ? positive(countLine.split(':')[1].trim()) : null, itemLevel: levelLine ? positive(levelLine.split(':')[1].trim()) : null, listedNotableNames: notableNames, passiveDescriptions,
      itemTextSha256: createHash('sha256').update(raw).digest('hex') });
  }
  jewels.sort((a, b) => a.socketNodeId - b.socketNodeId);
  return { activeSpec: active, treeVersion: typeof spec['@_treeVersion'] === 'string' ? spec['@_treeVersion'] : null, socketDataAvailable, jewels, unresolvedSockets: unresolved };
}

export function clusterFileSchema(): FeatureTool['schema'] {
  return { name: 'inspect_local_cluster_jewels', description: 'Inspect cluster jewel assignments in the active spec of a saved local PoB XML file without starting PoB. Serialized names and node IDs do not establish runtime allocation.', inputSchema: { type: 'object', additionalProperties: false, properties: { build_name: { type: 'string' } }, required: ['build_name'] } };
}
export function createClusterFileTool(read: (name: string) => Promise<string>): FeatureTool {
  return { schema: clusterFileSchema(), invoke: async args => {
    if (Object.keys(args).some(key => key !== 'build_name') || typeof args.build_name !== 'string' || !args.build_name.trim() || args.build_name.length > 4096) throw new Error('Valid local build name is required');
    const name = args.build_name, xml = await read(name), result = analyzeClusterFile(xml);
    return { content: [{ type: 'text', text: JSON.stringify({ source: 'local_saved_xml', buildName: name, sha256: createHash('sha256').update(xml).digest('hex'), ...result,
      warnings: ['This is the saved file, not an unsaved or imported snapshot; no PoB process was started.', 'Node IDs and notable names are serialized data, not proof of current allocation, generated graph, synergy, legality or damage. PoB can remap older tree IDs.', 'Unresolved socket items and missing or unrecognized data can make this report incomplete.'] }) }] };
  } };
}
