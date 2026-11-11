import type { ConfigValues, EnemyLevelSetting } from '../ports/configPresets.js';
export const MAX_PRESET_FILE_BYTES = 1024 * 1024;
export function validPresetName(name: unknown): name is string {
  return typeof name === 'string' && !!name.trim() && Buffer.byteLength(name, 'utf8') <= 250 && name !== '.' && name !== '..' && !/[\\/\u0000-\u001f]/.test(name);
}
export function validatePresetConfig(value: unknown): asserts value is ConfigValues {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).length > 10000 || Object.entries(value).some(([key, item]) => !key || key.length > 200 || !['string', 'number', 'boolean'].includes(typeof item) || typeof item === 'number' && !Number.isFinite(item)) || Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PRESET_FILE_BYTES / 2) throw new Error('Invalid preset config');
}
export function validEnemyLevelSetting(value: unknown): value is EnemyLevelSetting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const setting = value as Record<string, unknown>;
  if (setting.mode === 'automatic') return Object.keys(setting).length === 1;
  return setting.mode === 'explicit' && Object.keys(setting).length === 2 && typeof setting.value === 'number' && Number.isSafeInteger(setting.value) && setting.value > 0;
}
