import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildFileName, sanitizeBuildName } from '../utils/pathSanitizer.js';
import { MAX_BUILD_BYTES } from './shareCode.js';

const digest = (content: string) => createHash('sha256').update(content).digest('hex');
const safeId = /^[A-Za-z0-9-]{1,100}$/;
const tagFile = (tag: string) => tag.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').toLowerCase();

async function readBounded(root: string, file: string, max: number): Promise<string> {
  const resolved = await fs.realpath(file);
  if (!resolved.startsWith(root + path.sep)) throw new Error('Legacy history file resolves outside the build directory');
  const handle = await fs.open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Legacy history entry is not a regular file');
    const buffer = Buffer.allocUnsafe(max + 1); let used = 0;
    while (used < buffer.length) { const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null); if (!bytesRead) break; used += bytesRead; }
    if (used > max) throw new Error('Legacy history file exceeds the size limit');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used));
  } finally { await handle.close(); }
}

/** Read the old file-based history without changing or claiming ownership of it. */
export async function listLegacyHistory(directory: string, buildName: string) {
  if (typeof buildName !== 'string' || !buildName.trim() || buildName !== buildName.trim() || buildName.length > 1000) throw new Error('Valid build name required');
  const root = await fs.realpath(directory);
  const history = path.join(root, '.pob-mcp', 'snapshots');
  const fullName = buildFileName(buildName);
  const candidates = [...new Set([fullName, fullName.replace(/\.xml$/i, '')])];
  const entries: Array<{ id: string; origin: string; metadata: Record<string, unknown>; metadataDigest: string; xmlName: string }> = [];
  const issues: Array<{ origin: string; file: string; reason: string }> = [];
  let inspected = 0;
  for (const origin of candidates) {
    const folder = sanitizeBuildName(origin, history);
    let names: string[];
    try {
      const resolved = await fs.realpath(folder);
      if (!resolved.startsWith(root + path.sep)) throw new Error('Legacy history directory resolves outside the build directory');
      names = await fs.readdir(resolved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      issues.push({ origin, file: '', reason: error instanceof Error ? error.message : String(error) }); continue;
    }
    names.sort();
    const matchedXml = new Set<string>();
    for (const name of names.filter(name => name.endsWith('_metadata.json'))) {
      if (++inspected > 2000) { issues.push({ origin, file: '', reason: 'ENTRY_LIMIT' }); break; }
      const id = name.slice(0, -'_metadata.json'.length);
      try {
        if (!safeId.test(id)) throw new Error('Invalid legacy snapshot ID');
        const text = await readBounded(root, path.join(folder, name), 65536);
        const metadata: unknown = JSON.parse(text);
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || typeof (metadata as Record<string, unknown>).tag !== 'string' || ((metadata as Record<string, unknown>).tag as string).length > 1000) throw new Error('Invalid legacy metadata');
        const xmlName = `${id}_${tagFile((metadata as Record<string, string>).tag)}.xml`;
        const xmlPath = await fs.realpath(path.join(folder, xmlName));
        if (!xmlPath.startsWith(root + path.sep) || !(await fs.stat(xmlPath)).isFile()) throw new Error('Legacy XML is unavailable or outside the build directory');
        matchedXml.add(xmlName);
        entries.push({ id, origin, metadata: metadata as Record<string, unknown>, metadataDigest: digest(text), xmlName });
      } catch (error) { issues.push({ origin, file: name, reason: error instanceof Error ? error.message : String(error) }); }
    }
    for (const name of names) if (name.toLowerCase().endsWith('.xml') && !matchedXml.has(name)) issues.push({ origin, file: name, reason: 'XML_WITHOUT_READABLE_METADATA' });
    if (inspected > 2000) break;
  }
  return { root, entries, issues, complete: issues.length === 0 };
}

export async function readLegacyHistory(directory: string, buildName: string, origin: string, id: string, metadataDigest: string) {
  if (typeof origin !== 'string' || !safeId.test(id) || !/^[a-f0-9]{64}$/.test(metadataDigest)) throw new Error('Invalid legacy snapshot selection');
  const catalog = await listLegacyHistory(directory, buildName);
  const entry = catalog.entries.find(item => item.id === id && item.origin === origin);
  if (!entry || entry.metadataDigest !== metadataDigest) throw new Error('Legacy snapshot is missing or metadata changed; refresh the catalog');
  const folder = sanitizeBuildName(origin, path.join(catalog.root, '.pob-mcp', 'snapshots'));
  const xml = await readBounded(catalog.root, path.join(folder, entry.xmlName), MAX_BUILD_BYTES);
  return { xml, xmlDigest: digest(xml), metadata: entry.metadata, metadataDigest: entry.metadataDigest, id, origin, buildName };
}

/** Explicit recovery of an unpaired old XML; its name is data, not a trusted tag. */
export async function readUnpairedLegacyHistory(directory: string, buildName: string, origin: string, file: string) {
  if (typeof origin !== 'string' || typeof file !== 'string' || file.length > 255 || file === '.' || file === '..' || file.includes('/') || file.includes('\\') || file.includes('\0') || !file.toLowerCase().endsWith('.xml')) throw new Error('Invalid unpaired history selection');
  const catalog = await listLegacyHistory(directory, buildName);
  if (catalog.issues.some(issue => issue.reason === 'ENTRY_LIMIT')) throw new Error('Legacy history scan exceeded its limit; unpaired status is unknown');
  if (!catalog.issues.some(issue => issue.origin === origin && issue.file === file && issue.reason === 'XML_WITHOUT_READABLE_METADATA')) throw new Error('Unpaired XML not found; refresh the legacy history catalog');
  const folder = sanitizeBuildName(origin, path.join(catalog.root, '.pob-mcp', 'snapshots'));
  const xml = await readBounded(catalog.root, path.join(folder, file), MAX_BUILD_BYTES);
  return { buildName, origin, file, xml, xmlDigest: digest(xml) };
}
