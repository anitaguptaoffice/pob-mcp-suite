import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { ConfigPreset, ConfigPresetStore } from '../../ports/configPresets.js';
import { atomicWriteFile } from '../../utils/atomicWrite.js';
import { MAX_PRESET_FILE_BYTES, validPresetName, validatePresetConfig, validEnemyLevelSetting } from '../../domain/configPreset.js';

const presetDirectory = '.pob-mcp-presets';
const presetFormat = 'pob-config-preset/v1';
const validIdentity = (value: unknown): value is Record<string, string | null> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 && Object.values(value).every(item => item === null || typeof item === 'string' && !!item);
export class LocalConfigPresetStore implements ConfigPresetStore {
  constructor(private readonly directory: string) {}
  private async root(): Promise<string> {
    const root = await fs.realpath(this.directory);
    if (!(await fs.stat(root)).isDirectory()) throw new Error('Configured build directory is not a directory');
    return root;
  }
  private async presetDir(root: string): Promise<string | null> {
    const directory = path.join(root, presetDirectory);
    let info;
    try { info = await fs.lstat(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    if (!info.isDirectory()) throw new Error('Preset directory is not a regular directory');
    const real = await fs.realpath(directory);
    if (!real.startsWith(root + path.sep)) throw new Error('Preset directory resolves outside the build directory');
    return real;
  }
  async list() {
    const directory = await this.presetDir(await this.root());
    if (!directory) return [];
    return (await fs.readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.json') && validPresetName(entry.name.slice(0, -5))).map(entry => ({ name: entry.name.slice(0, -5) })).sort((a, b) => a.name.localeCompare(b.name));
  }
  async read(name: string): Promise<ConfigPreset> {
    if (!validPresetName(name)) throw new Error('Invalid preset name');
    if (!(await this.list()).some(item => item.name === name)) throw new Error('Preset not found');
    const directory = await this.presetDir(await this.root());
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
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== presetFormat || typeof value.sourceSnapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceSnapshotId) || !validIdentity(value.sourceIdentity) || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)) || !validEnemyLevelSetting(value.enemyLevelSetting)) throw new Error('Invalid preset metadata');
    validatePresetConfig(value.config);
    if (typeof value.config.enemyLevel !== 'number' || !Number.isFinite(value.config.enemyLevel) || value.config.enemyLevel < 1) throw new Error('Invalid preset enemy level');
    return { name, config: value.config, sourceSnapshotId: value.sourceSnapshotId, sourceIdentity: value.sourceIdentity, savedAt: value.savedAt, enemyLevelSetting: value.enemyLevelSetting };
  }
  async save(preset: ConfigPreset, overwrite: boolean): Promise<void> {
    if (!validPresetName(preset.name) || typeof overwrite !== 'boolean' || !preset.sourceSnapshotId || !/^[a-f0-9]{64}$/.test(preset.sourceSnapshotId) || !validIdentity(preset.sourceIdentity) || !preset.savedAt || !Number.isFinite(Date.parse(preset.savedAt)) || !validEnemyLevelSetting(preset.enemyLevelSetting)) throw new Error('Invalid preset');
    validatePresetConfig(preset.config);
    if (typeof preset.config.enemyLevel !== 'number' || !Number.isFinite(preset.config.enemyLevel) || preset.config.enemyLevel < 1) throw new Error('Invalid preset enemy level');
    const root = await this.root();
    try { await fs.mkdir(path.join(root, presetDirectory), { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const directory = await this.presetDir(root);
    if (!directory) throw new Error('Preset directory disappeared');
    const destination = path.join(directory, `${preset.name}.json`);
    try { if (!(await fs.lstat(destination)).isFile()) throw new Error('Preset destination is not a regular file'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await atomicWriteFile(destination, JSON.stringify({ format: presetFormat, sourceSnapshotId: preset.sourceSnapshotId, sourceIdentity: preset.sourceIdentity, savedAt: preset.savedAt, enemyLevelSetting: preset.enemyLevelSetting, config: preset.config }), overwrite);
  }
}
