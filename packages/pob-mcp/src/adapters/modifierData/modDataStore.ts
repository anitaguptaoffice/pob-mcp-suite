/**
 * Reader for Path of Building's generated affix tables.
 *
 * `Data/ModExplicit.lua` and `Data/ModMaster.lua` provide PoB's affix data, not a
 * complete determination of crafting eligibility. They are
 * plain Lua literals with no runtime dependencies, so we read them here rather than in
 * the Lua bridge: the bridge serves one request at a time, and a two-megabyte parse
 * there would stall every other call for data that never depends on the loaded build.
 */

import fs from "fs";
import path from "path";
import { createHash } from 'node:crypto';
import { resolvePoBLayout } from "../../utils/pobLayout.js";
import type { ModEntry } from '../../ports/modifierData.js';
export type { AffixSlot, ModEntry } from '../../ports/modifierData.js';

type LuaValue = string | number | boolean | LuaTable;

interface LuaTable {
  array: LuaValue[];
  fields: Map<string, LuaValue>;
}

class LuaLiteralParser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parseTable(): LuaTable {
    this.skipSpace();
    this.expect("{");
    const table: LuaTable = { array: [], fields: new Map() };

    while (true) {
      this.skipSpace();
      if (this.peek() === "}") {
        this.pos += 1;
        return table;
      }
      const key = this.tryReadKey();
      const value = this.parseValue();
      if (key === null) table.array.push(value);
      else table.fields.set(key, value);
      this.skipSpace();
      if (this.peek() === ",") this.pos += 1;
    }
  }

  /** A key is only a key if an `=` follows it, so anything else rewinds to a value. */
  private tryReadKey(): string | null {
    const start = this.pos;
    const key = this.peek() === "[" ? this.readBracketKey() : this.readIdentifier();
    if (key === null) return null;
    this.skipSpace();
    if (this.peek() === "=") {
      this.pos += 1;
      return key;
    }
    this.pos = start;
    return null;
  }

  private readBracketKey(): string | null {
    const match = /^\[\s*(?:"((?:[^"\\]|\\.)*)"|(-?\d+))\s*\]/.exec(this.text.slice(this.pos));
    if (!match) return null;
    this.pos += match[0].length;
    return match[1] === undefined ? match[2] : unescapeLua(match[1]);
  }

  private readIdentifier(): string | null {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.text.slice(this.pos));
    if (!match) return null;
    this.pos += match[0].length;
    return match[0];
  }

  private parseValue(): LuaValue {
    this.skipSpace();
    const char = this.peek();
    if (char === "{") return this.parseTable();
    if (char === '"') return this.readString();

    const literal = /^(true|false|nil|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(this.text.slice(this.pos));
    if (!literal) throw new Error(`unparsable Lua value at offset ${this.pos}: ${this.text.slice(this.pos, this.pos + 40)}`);
    this.pos += literal[0].length;
    if (literal[0] === "true") return true;
    if (literal[0] === "false" || literal[0] === "nil") return false;
    return Number(literal[0]);
  }

  private readString(): string {
    const match = /^"((?:[^"\\]|\\.)*)"/.exec(this.text.slice(this.pos));
    if (!match) throw new Error(`unterminated Lua string at offset ${this.pos}`);
    this.pos += match[0].length;
    return unescapeLua(match[1]);
  }

  private skipSpace(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos += 1;
  }

  private peek(): string {
    return this.text[this.pos] ?? "";
  }

  private expect(char: string): void {
    if (this.peek() !== char) throw new Error(`expected ${char} at offset ${this.pos}`);
    this.pos += 1;
  }
}

const unescapeLua = (raw: string): string => raw.replace(/\\(.)/g, "$1");

const strings = (value: LuaValue | undefined): string[] =>
  value && typeof value === "object" ? value.array.filter((item): item is string => typeof item === "string") : [];

const numbers = (value: LuaValue | undefined): number[] =>
  value && typeof value === "object" ? value.array.filter((item): item is number => typeof item === "number") : [];

const keysOf = (value: LuaValue | undefined): string[] =>
  value && typeof value === "object" ? [...value.fields.keys()] : [];

const readString = (table: LuaTable, key: string): string => {
  const value = table.fields.get(key);
  return typeof value === "string" ? value : "";
};

const readNumber = (table: LuaTable, key: string): number => {
  const value = table.fields.get(key);
  return typeof value === "number" ? value : 0;
};

/** Only tags that can actually spawn the mod; a zero weight means "never here". */
const positiveTags = (tags: string[], weights: number[]): string[] =>
  tags.filter((_tag, index) => (weights[index] ?? 0) > 0);

function projectEntry(table: LuaTable, id: string, source: ModEntry["source"]): ModEntry {
  const type = readString(table, "type");
  if (type !== "Prefix" && type !== "Suffix") throw new Error(`${id}: unexpected affix type "${type}"`);

  const statLines = table.array.filter((item): item is string => typeof item === "string");
  const statOrder = numbers(table.fields.get("statOrder"));
  // statOrder is emitted one entry per printed line, so a mismatch means the positional
  // strings were mis-split and every downstream affix count would be wrong.
  if (statOrder.length !== statLines.length) {
    throw new Error(`${id}: ${statLines.length} stat lines but ${statOrder.length} statOrder entries`);
  }

  const allSlotTags = strings(table.fields.get("weightKey"));
  const weights = numbers(table.fields.get("weightVal"));
  if (allSlotTags.length !== weights.length) throw new Error(`${id}: mismatched spawn weight tags and values`);
  const slotTags = positiveTags(allSlotTags, weights);

  return {
    id,
    source,
    type,
    affix: readString(table, "affix"),
    statLines,
    level: readNumber(table, "level"),
    group: readString(table, "group"),
    modTags: strings(table.fields.get("modTags")),
    slotTags,
    allSlotTags,
    weightRules: allSlotTags.map((tag, index) => ({ tag, weight: weights[index] })),
    itemClasses: keysOf(table.fields.get("types")),
    obtainable: source === "master" || slotTags.length > 0,
  };
}

/**
 * Both files emit exactly one entry per line, so we parse line by line and keep only the
 * projection. Parsing the file as one literal would hold every tradeHash in memory at once.
 */
export function parseModFile(text: string, source: ModEntry["source"]): ModEntry[] {
  return text.split("\n").reduce<ModEntry[]>((entries, line) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("--") || trimmed === "return {" || trimmed === "}") return entries;

    const keyed = /^\["((?:[^"\\]|\\.)*)"\]\s*=\s*/.exec(trimmed);
    const id = keyed ? unescapeLua(keyed[1]) : `master:${entries.length}`;
    const body = keyed ? trimmed.slice(keyed[0].length) : trimmed;
    const table = new LuaLiteralParser(body.replace(/,$/, "")).parseTable();
    return [...entries, projectEntry(table, id, source)];
  }, []);
}

interface CachedFile {
  sha256: string;
  entries: ModEntry[];
}

const cache = new Map<string, CachedFile>();

export class ModDataUnavailableError extends Error {}

/**
 * Fingerprint bytes on every read and cache only the parsed projection. This keeps
 * the reported data identity tied to the bytes used even if timestamps are reused.
 * Nothing is read until a tool actually asks for it.
 */
export function loadModData(fileName: 'ModExplicit.lua' | 'ModMaster.lua', source: ModEntry["source"]): { entries: ModEntry[]; fileName: string; sha256: string } {
  const layout = resolvePoBLayout(process.env.POB_PATH);
  const filePath = path.join(layout.src, "Data", fileName);

  const content = ((): Buffer => {
    try {
      return fs.readFileSync(filePath);
    } catch {
      throw new ModDataUnavailableError(
        `Path of Building's ${fileName} was not found at ${filePath}. Affix data needs a PoB src/ checkout; point POB_PATH at one.`
      );
    }
  })();

  const sha256 = createHash('sha256').update(content).digest('hex'), cached = cache.get(filePath);
  if (cached && cached.sha256 === sha256) return { entries: cached.entries, fileName: path.basename(filePath), sha256 };
  const entries = parseModFile(content.toString('utf8'), source);
  cache.set(filePath, { sha256, entries });
  return { entries, fileName: path.basename(filePath), sha256 };
}

export const loadExplicitMods = (): ModEntry[] => loadModData("ModExplicit.lua", "explicit").entries;

/** Project the generated Watcher's Eye source without applying variant-specific entries. */
export function parseWatchersEyeFile(text: string): Array<{ id: string; lines: string[] }> {
  const entries: Array<{ id: string; lines: string[] }> = [], ids = new Set<string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--') || trimmed === 'return {' || trimmed === '}') continue;
    const key = /^\["((?:[^"\\]|\\.)*)"\]\s*=\s*/.exec(trimmed);
    if (!key) throw new Error('Unexpected Watcher\'s Eye data format');
    const id = unescapeLua(key[1]);
    if (ids.has(id)) throw new Error('Duplicate Watcher\'s Eye modifier ID');
    ids.add(id);
    const table = new LuaLiteralParser(trimmed.slice(key[0].length).replace(/,$/, '')).parseTable();
    const lines = table.array.filter((item): item is string => typeof item === 'string');
    const statOrder = numbers(table.fields.get('statOrder'));
    if (!lines.length || lines.length !== statOrder.length) throw new Error(`Invalid Watcher's Eye data for ${id}`);
    if (!id.startsWith('SublimeVision') && !id.startsWith('SummonArbalist')) entries.push({ id, lines });
  }
  if (!entries.length) throw new Error('Watcher\'s Eye data contains no modifiers');
  return entries;
}

export const loadMasterMods = (): ModEntry[] => loadModData("ModMaster.lua", "master").entries;

let combined: { explicit: ModEntry[]; master: ModEntry[]; all: ModEntry[] } | null = null;

/**
 * Rolled and bench-crafted mods in one list, with a stable array identity so callers that
 * index it can memoise on that identity. A reparse of either file yields a fresh array.
 */
export function loadAllMods(): ModEntry[] {
  const explicit = loadExplicitMods();
  const master = loadMasterMods();
  if (combined && combined.explicit === explicit && combined.master === master) return combined.all;

  combined = { explicit, master, all: [...explicit, ...master] };
  return combined.all;
}
