import { analyzeBuildIssues, createBuildIssuesTool } from '../../src/features/buildIssues/tool.js';
import type { BuildFoundation, BuildEngine } from '../../src/foundation/buildFoundation.js';

const fixture = { stats: {}, build: {}, tree: {}, items: undefined, skills: {} };
const codes = (result: ReturnType<typeof analyzeBuildIssues>) => result.issues.map(issue => issue.code);
describe('snapshot issue scan', () => {
  it('reports missing or malformed inputs as unknown without inventing zeroes', () => {
    const result = analyzeBuildIssues({ ...fixture, stats: { Life: false, EnergyShield: ' ', ChaosResist: null, FireResist: 60 }, items: [{ slot: 'Helmet' }] });
    expect(result.checks).toMatchObject({ healthPool: 'unknown', chaosResistance: 'unknown', fireResistance: 'unknown', items: 'unknown', zeroDamage: 'unknown' });
    expect(codes(result)).not.toContain('zero_damage');
    expect(codes(result)).not.toContain('low_health_pool');
    expect(codes(result)).not.toContain('chaos_resist_negative');
    expect(analyzeBuildIssues({ ...fixture, skills: { groups: [{ enabled: true, gems: [{ name: 'Brutality' }] }] } }).checks.gemCoherence).toBe('unknown');
  });
  it('uses PoB missing resistance instead of assuming the cap is 75, and labels surplus correctly', () => {
    const result = analyzeBuildIssues({ ...fixture, stats: { FireResist: 75, MissingFireResist: 5, FireResistOverCap: 10, ColdResist: 70, MissingColdResist: 0, LightningResist: -5, MissingLightningResist: 80 } });
    expect(codes(result)).toContain('fire_resist_below_max');
    expect(codes(result)).not.toContain('cold_resist_below_max');
    expect(codes(result)).toContain('lightning_resist_negative');
    expect(result.issues.find(issue => issue.code === 'fire_resist_over_cap')?.message).toContain('protect');
  });
  it('recognizes CI health pools, poison-inclusive damage and unknown metrics', () => {
    const result = analyzeBuildIssues({ ...fixture, stats: { Life: 1, EnergyShield: 5000, TotalDPS: 0, CombinedDPS: 0, FullDPS: 200, MinionTotalDPS: 0, MinionCombinedDPS: 0 } });
    expect(codes(result)).not.toContain('low_health_pool');
    expect(codes(result)).not.toContain('zero_damage');
    const zero = analyzeBuildIssues({ ...fixture, stats: { TotalDPS: 0, CombinedDPS: 0, FullDPS: 0, MinionTotalDPS: 0, MinionCombinedDPS: 0 } });
    expect(codes(zero)).toContain('zero_damage');
    expect(analyzeBuildIssues({ ...fixture, stats: { TotalDPS: 0, CombinedDPS: 0, MinionTotalDPS: 0, MinionCombinedDPS: 0 } }).checks.zeroDamage).toBe('unknown');
  });
  it('reports observed player hit chance without asserting minion accuracy or mana sustainability', () => {
    const result = analyzeBuildIssues({ ...fixture, stats: { HitChance: 85, Accuracy: 1400, ManaRegen: 0, ManaRegenRecovery: 25 } });
    expect(result.checks).toMatchObject({ playerHitChanceObservation: 'checked', manaRecoveryObservation: 'checked' });
    expect(result.issues.find(issue => issue.code === 'low_player_hit_chance')).toMatchObject({ severity: 'info', heuristic: true, evidence: { hitChance: 85, accuracy: 1400 } });
    expect(result.issues.find(issue => issue.code === 'low_player_hit_chance')?.message).toContain('verify');
    expect(analyzeBuildIssues({ ...fixture, stats: { HitChance: 100 } }).issues.map(issue => issue.code)).not.toContain('low_player_hit_chance');
    for (const value of [undefined, null, -1, 101, false]) {
      const unknown = analyzeBuildIssues({ ...fixture, stats: { HitChance: value } });
      expect(unknown.checks.playerHitChanceObservation).toBe('unknown');
      expect(codes(unknown)).not.toContain('low_player_hit_chance');
    }
    expect(analyzeBuildIssues(fixture).checks.manaRecoveryObservation).toBe('unknown');
  });
  it('preserves slot visibility, passive estimate and clearly labels gem heuristics', () => {
    const result = analyzeBuildIssues({ stats: { ChaosResist: -40, EffectiveSpellSuppressionChance: 50 }, build: { level: 90 }, tree: { nodes: [1], treeVersion: '3_29', ascendancyPointsUsed: 0 }, items: [
      { slot: 'Ring 3', id: 0, shown: false }, { slot: 'Helmet', id: 0, shown: true }, { slot: 'Flask 1', id: 0, shown: true }, { slot: 'Jewel 1', id: 0, shown: false },
    ], skills: { groups: [{ index: 1, enabled: true, gems: [{ enabled: true, isSupport: true, name: 'Brutality' }, { enabled: true, isSupport: true, name: 'Added Fire Damage' }] }] } });
    expect(result.issues.filter(issue => issue.code === 'empty_gear_slot').map(issue => issue.evidence.slot)).toEqual(['Helmet']);
    expect(codes(result)).not.toContain('empty_jewel_sockets');
    expect(result.issues.find(issue => issue.code === 'estimated_unspent_passives')?.heuristic).toBe(true);
    expect(result.issues.find(issue => issue.code === 'brutality_mixed_supports')?.severity).toBe('warning');
    expect(codes(result)).toContain('suppression_below_100');
    expect(codes(result)).toContain('chaos_resist_negative');
  });
  it('scans one explicit snapshot and retains its calculation context', async () => {
    const engine = { getStats: async () => ({ Life: 400, EnergyShield: 200 }), getBuildInfo: async () => ({ level: 90 }), getTree: async () => ({ treeVersion: '3_29' }), getItems: async () => [], getSkills: async () => ({ groups: [] }), getConfig: async () => ({ enemyIsBoss: 'Pinnacle' }) } as unknown as BuildEngine;
    const runReadOnlySnapshot = jest.fn(async (id: string, fn: (engine: BuildEngine) => Promise<unknown>) => ({ snapshotId: id, identity: {}, warnings: [], result: await fn(engine) }));
    const tool = createBuildIssuesTool({ runReadOnlySnapshot } as unknown as Pick<BuildFoundation, 'runReadOnlySnapshot'>);
    const id = 'a'.repeat(64);
    const result = JSON.parse((await tool.invoke({ snapshot_id: id })).content[0].text);
    expect(result.context.config.enemyIsBoss).toBe('Pinnacle'); expect(result.context.treeVersion).toBe('3_29');
    expect(result.issues.map((issue: { code: string }) => issue.code)).toContain('low_health_pool');
    await expect(tool.invoke({ snapshot_id: 'invalid' })).rejects.toThrow();
    expect(runReadOnlySnapshot).toHaveBeenCalledTimes(1);
  });
});
