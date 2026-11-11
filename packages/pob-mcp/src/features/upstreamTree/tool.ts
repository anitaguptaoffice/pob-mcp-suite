import { createHash } from 'node:crypto';
import type { FeatureTool } from '../../server/featureRegistry.js';
import type { UpstreamTreeSource } from '../../ports/upstreamTree.js';

/** Skip quoted strings and line comments while finding a Lua table's closing brace. */
function tableEnd(text: string, start: number): number {
  if (text[start] !== '{') throw new Error('Unsupported upstream tree format');
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const quote = c; let closed = false;
      while (++i < text.length) { if (text[i] === '\\') i++; else if (text[i] === quote) { closed = true; break; } }
      if (!closed) throw new Error('Unsupported upstream tree string');
    } else if (c === '-' && text[i + 1] === '-') {
      if (/^--\[(?:=*)\[/.test(text.slice(i, i + 16))) throw new Error('Unsupported upstream tree long comment');
      const newline = text.indexOf('\n', i + 2); if (newline < 0) throw new Error('Unterminated upstream tree comment'); i = newline;
    } else if (c === '[' && /^\[(?:=*)\[/.test(text.slice(i, i + 16))) throw new Error('Unsupported upstream tree long string');
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('Unterminated upstream tree table');
}

export function extractUpstreamNodes(text: string, nodeIds: number[]) {
  const roots = [...text.matchAll(/^    \["nodes"\]\s*=\s*\{/gm)];
  if (roots.length !== 1) throw new Error('Unsupported upstream tree nodes layout');
  const start = roots[0].index! + roots[0][0].lastIndexOf('{'), end = tableEnd(text, start);
  const body = text.slice(start + 1, end), requested = new Set(nodeIds), found = new Map<number, string>();
  let depth = 0, count = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'") {
      const quote = c; let closed = false;
      while (++i < body.length) { if (body[i] === '\\') i++; else if (body[i] === quote) { closed = true; break; } }
      if (!closed) throw new Error('Unsupported upstream tree string');
    } else if (c === '-' && body[i + 1] === '-') {
      if (/^--\[(?:=*)\[/.test(body.slice(i, i + 16))) throw new Error('Unsupported upstream tree long comment');
      const newline = body.indexOf('\n', i + 2); if (newline < 0) throw new Error('Unterminated upstream tree comment'); i = newline;
    } else if (c === '[' && /^\[(?:=*)\[/.test(body.slice(i, i + 16))) throw new Error('Unsupported upstream tree long string');
    else if (c === '[' && depth === 0 && /^\[\d+\]/.test(body.slice(i, i + 32))) {
      const match = /^\[(\d+)\]\s*=\s*\{/.exec(body.slice(i, i + 100));
      if (!match) throw new Error('Unsupported upstream tree node layout');
      const id = Number(match[1]), open = i + match[0].lastIndexOf('{'), close = tableEnd(body, open); count++;
      if (requested.has(id)) {
        if (found.has(id)) throw new Error('Duplicate upstream tree node');
        const raw = body.slice(i, close + 1);
        if (Buffer.byteLength(raw, 'utf8') > 65536) throw new Error('Upstream tree node exceeds the size limit');
        found.set(id, raw);
      }
      i = close;
    } else if (c === '{') depth++;
    else if (c === '}') { if (--depth < 0) throw new Error('Invalid upstream tree nodes table'); }
  }
  if (!count || depth !== 0) throw new Error('Unsupported upstream tree nodes layout');
  return nodeIds.map(nodeId => ({ nodeId, status: found.has(nodeId) ? 'found' : 'not_found', serializedLua: found.get(nodeId) ?? null }));
}

export function upstreamTreeSchema(): FeatureTool['schema'] {
  return { name: 'inspect_upstream_tree_nodes', description: 'Read explicitly selected serialized nodes from the upstream PoB GitHub tree, separately from local snapshot calculations. Does not execute or install remote data.', inputSchema: { type: 'object', additionalProperties: false, properties: { tree_version: { type: 'string' }, node_ids: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'integer', minimum: 1 } }, refresh: { type: 'boolean' } }, required: ['tree_version', 'node_ids'] } };
}
export function createUpstreamTreeTool(source: UpstreamTreeSource): FeatureTool {
  return { schema: upstreamTreeSchema(), invoke: async args => {
    const ids = args.node_ids;
    if (Object.keys(args).some(key => !['tree_version', 'node_ids', 'refresh'].includes(key)) || typeof args.tree_version !== 'string' || !/^\d{1,2}_\d{1,3}(?:_[A-Za-z0-9_]{1,40})?$/.test(args.tree_version) || !Array.isArray(ids) || ids.length < 1 || ids.length > 20 || ids.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) || new Set(ids).size !== ids.length || (args.refresh !== undefined && typeof args.refresh !== 'boolean')) throw new Error('Invalid upstream tree inspection options');
    const result = await source.read(args.tree_version, args.refresh as boolean | undefined);
    const expectedUrl = `https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding/master/src/TreeData/${args.tree_version}/tree.lua`;
    if (result.source !== 'pob-upstream-github' || result.treeVersion !== args.tree_version || result.url !== expectedUrl || !Number.isFinite(Date.parse(result.fetchedAt)) || !/^[a-f0-9]{64}$/.test(result.sha256) || !Number.isSafeInteger(result.bytes) || result.bytes < 1 || typeof result.text !== 'string' || Buffer.byteLength(result.text, 'utf8') !== result.bytes || createHash('sha256').update(result.text).digest('hex') !== result.sha256) throw new Error('Upstream tree source returned invalid provenance');
    return { content: [{ type: 'text', text: JSON.stringify({ source: result.source, treeVersion: result.treeVersion, url: result.url, fetchedAt: result.fetchedAt, sha256: result.sha256, bytes: result.bytes, nodes: extractUpstreamNodes(result.text, ids), warnings: ['Upstream master is a moving reference. The source hash and fetch time describe this response; the Git commit is not established.', 'Raw Lua is data only; no remote code is executed. This result does not modify or identify the locally installed PoB, a snapshot, allocation, or game legality.', 'Unsupported or changed source layout is rejected rather than parsed heuristically.'] }) }] };
  } };
}
