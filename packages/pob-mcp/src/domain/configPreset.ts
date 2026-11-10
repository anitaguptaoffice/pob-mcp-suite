import type { ConfigValues } from '../ports/configPresets.js';
export const MAX_PRESET_FILE_BYTES = 1024 * 1024;
export function validPresetName(name: unknown): name is string {
  return typeof name === 'string' && !!name.trim() && Buffer.byteLength(name, 'utf8') <= 250 && name !== '.' && name !== '..' && !/[\\/\u0000-\u001f]/.test(name);
}
export function validatePresetConfig(value: unknown): asserts value is ConfigValues {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).length > 10000 || Object.entries(value).some(([key, item]) => !key || key.length > 200 || !['string', 'number', 'boolean'].includes(typeof item) || typeof item === 'number' && !Number.isFinite(item)) || Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PRESET_FILE_BYTES / 2) throw new Error('Invalid preset config');
}
