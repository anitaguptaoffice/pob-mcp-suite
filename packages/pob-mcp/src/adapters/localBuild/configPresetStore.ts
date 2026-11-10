import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { ConfigPreset, ConfigPresetStore, PresetOrigin } from '../../ports/configPresets.js';
import { atomicWriteFile } from '../../utils/atomicWrite.js';
import { MAX_PRESET_FILE_BYTES, validPresetName, validatePresetConfig, validEnemyLevelSetting } from '../../domain/configPreset.js';

const dirs: Record<PresetOrigin, string> = { versioned: '.pob-mcp-presets-v2', legacy: '.pob-mcp-presets' };
const validIdentity = (value: unknown): value is Record<string, string | null> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 && Object.values(value).every(item => item === null || typeof item === 'string' && !!item);
export class LocalConfigPresetStore implements ConfigPresetStore {
  constructor(private readonly directory: string) {}
  private async root(): Promise<string> {
    const root = await fs.realpath(this.directory);
    if (!(await fs.stat(root)).isDirectory()) throw new Error('Configured build directory is not a directory');
    return root;
  }
  private async presetDir(root: string, origin: PresetOrigin): Promise<string | null> {
    const directory = path.join(root, dirs[origin]);
    let info;
    try { info = await fs.lstat(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    if (!info.isDirectory()) throw new Error('Preset directory is not a regular directory');
    const real = await fs.realpath(directory);
    if (!real.startsWith(root + path.sep)) throw new Error('Preset directory resolves outside the build directory');
    return real;
  }
  private async listOrigin(root: string, origin: PresetOrigin): Promise<string[]> {
    const directory = await this.presetDir(root, origin);
    if (!directory) return [];
    return (await fs.readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.json') && validPresetName(entry.name.slice(0, -5))).map(entry => entry.name.slice(0, -5)).sort();
  }
  async list() {
    const root = await this.root(), legacy = new Set(await this.listOrigin(root, 'legacy')), versioned = new Set(await this.listOrigin(root, 'versioned'));
    const names = [...new Set([...legacy, ...versioned])].sort();
    return names.map(name => ({ name, origins: [...(versioned.has(name) ? ['versioned' as const] : []), ...(legacy.has(name) ? ['legacy' as const] : [])] }));
  }
  async read(name: string, origin?: PresetOrigin): Promise<ConfigPreset> {
    if (!validPresetName(name) || (origin !== undefined && !['legacy', 'versioned'].includes(origin))) throw new Error('Invalid preset name or origin');
    const available = (await this.list()).find(item => item.name === name)?.origins ?? [];
    if (!available.length || origin && !available.includes(origin)) throw new Error('Preset not found');
    if (!origin && available.length > 1) throw new Error('Preset name exists in both stores; specify origin');
    const chosen = origin ?? available[0], root = await this.root(), directory = await this.presetDir(root, chosen);
    if (!directory) throw new Error('Preset directory disappeared');
    const file = await fs.open(path.join(directory, `${name}.json`), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let raw: string;
    try {
      if (!(await file.stat()).isFile()) throw new Error('Preset path is not a regular file');
      const buffer = Buffer.alloc(MAX_PRESET_FILE_BYTES + 1); let used = 0;
      while (used < buffer.length) { const { bytesRead } = await file.read(buffer, used, buffer.length - used, null); if (!bytesRead) break; used += bytesRead; }
      if (used > MAX_PRESET_FILE_BYTES) throw new Error('Preset file exceeds the size limit');
      try { raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used)); } catch { throw new Error('Preset file contains invalid UTF-8'); }
    } finally { await file.close(); }
    let value: any;
    try { value = JSON.parse(raw); } catch { throw new Error('Preset contains invalid JSON'); }
    if (chosen === 'legacy') { validatePresetConfig(value); return { name, origin: chosen, config: value, sourceSnapshotId: null, sourceIdentity: null, savedAt: null, enemyLevelSetting: null }; }
    if (!value || typeof value !== 'object' || Array.isArray(value) || !['pob-config-preset/v1', 'pob-config-preset/v2'].includes(value.format) || typeof value.sourceSnapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceSnapshotId) || !validIdentity(value.sourceIdentity) || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)) || (value.format === 'pob-config-preset/v2' && !validEnemyLevelSetting(value.enemyLevelSetting))) throw new Error('Invalid versioned preset metadata');
    validatePresetConfig(value.config);
    if (value.format === 'pob-config-preset/v2' && (typeof value.config.enemyLevel !== 'number' || !Number.isFinite(value.config.enemyLevel) || value.config.enemyLevel < 1)) throw new Error('Invalid preset enemy level');
    return { name, origin: chosen, config: value.config, sourceSnapshotId: value.sourceSnapshotId, sourceIdentity: value.sourceIdentity, savedAt: value.savedAt, enemyLevelSetting: value.format === 'pob-config-preset/v2' ? value.enemyLevelSetting : null };
  }
  async save(preset: ConfigPreset, overwrite: boolean): Promise<void> {
    if (!validPresetName(preset.name) || preset.origin !== 'versioned' || typeof overwrite !== 'boolean' || !preset.sourceSnapshotId || !/^[a-f0-9]{64}$/.test(preset.sourceSnapshotId) || !validIdentity(preset.sourceIdentity) || !preset.savedAt || !Number.isFinite(Date.parse(preset.savedAt)) || !validEnemyLevelSetting(preset.enemyLevelSetting)) throw new Error('Invalid versioned preset');
    validatePresetConfig(preset.config);
    if (typeof preset.config.enemyLevel !== 'number' || !Number.isFinite(preset.config.enemyLevel) || preset.config.enemyLevel < 1) throw new Error('Invalid preset enemy level');
    const root = await this.root();
    try { await fs.mkdir(path.join(root, dirs.versioned), { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const directory = await this.presetDir(root, 'versioned');
    if (!directory) throw new Error('Preset directory disappeared');
    const destination = path.join(directory, `${preset.name}.json`);
    try { if (!(await fs.lstat(destination)).isFile()) throw new Error('Preset destination is not a regular file'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await atomicWriteFile(destination, JSON.stringify({ format: 'pob-config-preset/v2', sourceSnapshotId: preset.sourceSnapshotId, sourceIdentity: preset.sourceIdentity, savedAt: preset.savedAt, enemyLevelSetting: preset.enemyLevelSetting, config: preset.config }), overwrite);
  }
}
