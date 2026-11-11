import { createSnapshotDefensesTool, defenseFields } from '../../src/features/defenses/tool.js';
import type { BuildFoundation } from '../../src/foundation/buildFoundation.js';
import { defenseReference } from '../../src/domain/defenseReference.js';

const available = (value: number) => ({ status: 'available', value });
it('keeps incomplete defense references unknown while reporting confirmed threshold signals', () => {
  const missing = defenseReference({}).layers;
  expect(Object.values(missing).map(layer => layer.status)).toEqual(['unknown', 'unknown', 'unknown']);
  const low = defenseReference(Object.fromEntries(['Evasion', 'EffectiveSpellSuppressionChance', 'AttackDodgeChance', 'BlockChance', 'Armour', 'PhysicalDamageReduction', 'LifeRegen', 'EnergyShieldRecharge', 'LifeLeechGainRate'].map(field => [field, available(0)]).concat([['Life', available(5000)]]))).layers;
  expect(Object.values(low).map(layer => layer.status)).toEqual(['below_threshold', 'below_threshold', 'below_threshold']);
  const partial = defenseReference({ BlockChance: available(20), Armour: available(10000), Life: available(5000), LifeRegen: available(50) }).layers;
  expect(Object.values(partial).map(layer => layer.status)).toEqual(['threshold_met', 'threshold_met', 'threshold_met']);
  expect(partial.recovery.checks[0]).toMatchObject({ metric: 'LifeRegenPercentOfLife', value: 1, meets: true });
});

it('uses effective suppression when available and never treats one-life regen or invalid percentages as confirmed', () => {
  const result = defenseReference({ Life: available(1), LifeRegen: available(5), EnergyShieldRecharge: available(0), LifeLeechGainRate: available(0), EffectiveSpellSuppressionChance: available(40), SpellSuppressionChance: available(100), AttackDodgeChance: available(101), BlockChance: available(-1), Evasion: available(0) });
  expect(result.layers.recovery.status).toBe('unknown');
  expect(result.layers.recovery.checks[0]).toMatchObject({ value: null, meets: null });
  expect(result.layers.avoidance.status).toBe('unknown');
  expect(result.layers.avoidance.checks[1]).toMatchObject({ metric: 'EffectiveSpellSuppressionChance', value: 40, meets: false });
  expect(result.layers.avoidance.checks[2].meets).toBeNull();
  expect(result.warnings.join(' ')).toContain('not proof');
});

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
  expect(result.layerReference.layers.recovery.status).toBe('unknown');
  expect(result.warnings.join(' ')).toContain('not proof of permanent immunity');
  await expect(tool.invoke({ snapshot_id: 'bad' })).rejects.toThrow('Invalid'); expect(evaluate).toHaveBeenCalledTimes(1);
});
