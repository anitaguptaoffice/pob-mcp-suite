import { createSnapshotDefensesTool, defenseFields } from '../../src/features/defenses/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';

it('keeps one-life energy-shield builds and unavailable metrics distinct from zero', async () => {
  const id = 'a'.repeat(64);
  const evaluate = jest.fn().mockResolvedValue({ snapshotId: id, identity: {}, context: { config: { enemyLevel: 84 } }, warnings: [], metrics: { Life: { status: 'available', value: 1 }, EnergyShield: { status: 'available', value: 5251 }, Ward: { status: 'available', value: 0 }, TotalEHP: { status: 'unknown', value: null }, FreezeAvoidChance: { status: 'available', value: 100 }, BleedAvoidChance: { status: 'available', value: 0 } } });
  const tool = createSnapshotDefensesTool({ evaluate } as unknown as Pick<BuildFoundation, 'evaluate'>);
  const result = JSON.parse((await tool.invoke({ snapshot_id: id })).content[0].text);
  expect(evaluate).toHaveBeenCalledWith(id, defenseFields);
  expect(result.groups.pools.Life.value).toBe(1); expect(result.groups.pools.EnergyShield.value).toBe(5251);
  expect(result.groups.pools.Ward).toEqual({ status: 'available', value: 0 });
  expect(result.groups.pools.TotalEHP.status).toBe('unknown'); expect(result.groups.pools.Mana.status).toBe('unknown');
  expect(result.groups.ailmentAvoidance.FreezeAvoidChance.value).toBe(100);
  expect(result.groups.ailmentAvoidance.BleedAvoidChance.value).toBe(0);
  expect(result.groups.ailmentAvoidance.PoisonAvoidChance.status).toBe('unknown');
  expect(result.warnings.join(' ')).toContain('not proof of permanent immunity');
  await expect(tool.invoke({ snapshot_id: 'bad' })).rejects.toThrow('Invalid'); expect(evaluate).toHaveBeenCalledTimes(1);
});
