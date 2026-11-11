import type { OfficialTreeCode } from '../../ports/officialTreeCode.js';

/** Decode the official passive-tree binary format used by PoB's PassiveSpec. */
export function decodeOfficialTreeCode(input: string): OfficialTreeCode {
  if (typeof input !== 'string' || !input.trim() || input.length > 8192) throw new Error('Invalid official passive tree input');
  let code = input.trim();
  if (code.includes('://')) {
    let url: URL;
    try { url = new URL(code); } catch { throw new Error('Invalid official passive tree URL'); }
    if (url.protocol !== 'https:' || !['www.pathofexile.com', 'pathofexile.com'].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash) throw new Error('Unsupported official passive tree URL');
    const match = /^\/(?:fullscreen-)?passive-skill-tree\/([A-Za-z0-9_=-]+)$/.exec(url.pathname);
    if (!match) throw new Error('Unsupported official passive tree URL');
    code = match[1];
  }
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(code)) throw new Error('Invalid official passive tree code');
  const bytes = Buffer.from(code, 'base64url');
  const canonical = bytes.toString('base64url');
  const expectedPadding = (4 - canonical.length % 4) % 4;
  if (code.replace(/=+$/, '') !== canonical || (code.includes('=') && code.length - code.replace(/=+$/, '').length !== expectedPadding)) throw new Error('Invalid official passive tree code encoding');
  if (bytes.length < 6) throw new Error('Truncated official passive tree header');
  const formatVersion = bytes.readUInt32BE(0);
  if (formatVersion < 1 || formatVersion > 6) throw new Error('Unsupported official passive tree format version');
  const classId = bytes[4], ascendancy = formatVersion >= 4 ? bytes[5] : 0;
  const ascendClassId = ascendancy & 3, secondaryAscendClassId = (ascendancy >> 2) & 3;
  let offset = formatVersion >= 4 ? 7 : 6;
  if (offset > bytes.length) throw new Error('Truncated official passive tree header');
  const readNodes = (count: number, cluster: boolean) => {
    if (offset + count * 2 > bytes.length) throw new Error('Truncated official passive tree nodes');
    const values: number[] = [];
    for (let i = 0; i < count; i++) { const id = bytes.readUInt16BE(offset); offset += 2; values.push(id + (cluster ? 65536 : 0)); }
    return values;
  };
  let nodes: number[];
  if (formatVersion < 5) {
    if ((bytes.length - offset) % 2) throw new Error('Truncated official passive tree nodes');
    nodes = readNodes((bytes.length - offset) / 2, false);
  } else {
    nodes = readNodes(bytes[6], false);
    if (offset >= bytes.length) throw new Error('Truncated official passive tree cluster count');
    nodes.push(...readNodes(bytes[offset++], true));
  }
  const masteryEffects: Record<string, number> = {};
  if (formatVersion >= 6) {
    if (offset >= bytes.length) throw new Error('Truncated official passive tree mastery count');
    const count = bytes[offset++];
    if (offset + count * 4 > bytes.length) throw new Error('Truncated official passive tree mastery effects');
    for (let i = 0; i < count; i++) {
      const effect = bytes.readUInt16BE(offset), node = bytes.readUInt16BE(offset + 2); offset += 4;
      if (!effect || !node || !nodes.includes(node) || Object.hasOwn(masteryEffects, String(node))) throw new Error('Invalid official passive tree mastery effects');
      masteryEffects[String(node)] = effect;
    }
  }
  if (offset !== bytes.length || nodes.some(node => node === 0) || new Set(nodes).size !== nodes.length) throw new Error('Invalid official passive tree nodes or trailing data');
  return { formatVersion, classId, ascendClassId, secondaryAscendClassId, nodes, masteryEffects, treeVersion: null, startNodesInferred: false };
}
