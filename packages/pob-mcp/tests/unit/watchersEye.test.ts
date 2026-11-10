import { parseWatchersEyeFile } from '../../src/services/modDataStore.js';
import { createWatchersEyeTool } from '../../src/features/watchersEye/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import type { WatchersEyeSource } from '../../src/ports/watchersEyeSource.js';

it('reads generated data, preserving actual lines and excluding other unique items', () => {
  const text = `return {\n["GraceChanceToDodge"] = { "12% chance to Suppress Spell Damage while affected by Grace", statOrder = { 1 } },\n["SublimeVisionGrace"] = { "Other", statOrder = { 1 } },\n}`;
  expect(parseWatchersEyeFile(text)).toEqual([{ id: 'GraceChanceToDodge', lines: ['12% chance to Suppress Spell Damage while affected by Grace'] }]);
  expect(() => parseWatchersEyeFile('return {\n["X"] = { "text", statOrder = {} },\n}')).toThrow('Invalid');
  expect(() => parseWatchersEyeFile('return {\n}')).toThrow('contains no modifiers');
});
it('separates enabled, disabled, unknown and Vaal candidates using data-backed modifier lines', async () => {
  const source = { read: jest.fn().mockReturnValue({ source: 'pob_watchers_eye', sha256: 'a'.repeat(64), entries: [
    { id: 'GraceChanceToDodge', lines: ['12% chance to Suppress Spell Damage while affected by Grace'] },
    { id: 'HatredCold', lines: ['Cold Damage while affected by Hatred'] },
  ] }) };
  const gem = (index: number, name: string, enabled: unknown) => ({ index, name, enabled, isSupport: false, supportClassificationKnown: true });
  const inspect = jest.fn().mockResolvedValue({ snapshotId: 'b'.repeat(64), identity: {}, warnings: [], data: { skills: { groups: [
    { index: 1, enabled: true, slotEnabled: true, gems: [gem(1, 'Grace', true), gem(2, 'Hatred', false), gem(3, 'Vaal Grace', true)] },
    { index: 2, enabled: true, slotEnabled: null, gems: [gem(1, 'Grace', true)] },
  ] } } });
  const tool = createWatchersEyeTool({ inspect } as unknown as Pick<BuildFoundation, 'inspect'>, source as WatchersEyeSource);
  const result = JSON.parse((await tool.invoke({ snapshot_id: 'b'.repeat(64) })).content[0].text);
  expect(result.candidates.map((c: any) => [c.gemName, c.enabledState, c.matchKind])).toEqual([
    ['Grace', 'enabled_in_pob', 'exact_name'], ['Hatred', 'disabled', 'exact_name'], ['Vaal Grace', 'enabled_in_pob', 'vaal_name_candidate'], ['Grace', 'unknown', 'exact_name'],
  ]);
  expect(result.candidates[0].modifiers[0].lines[0]).toContain('Suppress Spell Damage');
  expect(result.warnings.join(' ')).toContain('not proof'); expect(source.read).toHaveBeenCalledTimes(2);
});
it('rejects data changes and invalid snapshot IDs', async () => {
  const source = { read: jest.fn().mockReturnValueOnce({ source: 'pob_watchers_eye', sha256: 'a', entries: [] }).mockReturnValueOnce({ source: 'pob_watchers_eye', sha256: 'b', entries: [] }) };
  const inspect = jest.fn().mockResolvedValue({ data: { skills: { groups: [] } } });
  const tool = createWatchersEyeTool({ inspect } as unknown as Pick<BuildFoundation, 'inspect'>, source as WatchersEyeSource);
  await expect(tool.invoke({ snapshot_id: 'b'.repeat(64) })).rejects.toThrow('changed');
  await expect(tool.invoke({ snapshot_id: 'bad' })).rejects.toThrow('Valid snapshot');
});
