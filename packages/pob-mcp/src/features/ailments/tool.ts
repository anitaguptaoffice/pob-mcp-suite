import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import type { AilmentReport } from '../../ports/pobEngine.js';

export function snapshotAilmentsSchema(): FeatureTool['schema'] {
  return { name: 'inspect_snapshot_ailments', description: 'Inspect non-damaging ailments for the saved skill and enemy configuration, distinguishing effects credited by PoB from estimated effects on the configured enemy.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } };
}

export function createSnapshotAilmentsTool(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>): FeatureTool {
  return { schema: snapshotAilmentsSchema(), invoke: async args => {
    if (Object.keys(args).some(key => key !== 'snapshot_id') || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id)) throw new Error('Invalid snapshot ailment options');
    const { result, ...context } = await foundation.runReadOnlySnapshot(args.snapshot_id, async engine => ({ ailments: await engine.getAilments(), config: await engine.getConfig(), skills: await engine.getSkills() }));
    if (!result.ailments || !Array.isArray(result.ailments.ailments)) throw new Error('PoB returned invalid ailments');
    const matched = result.ailments.calculationSelectionMatchesMain === true;
    const ailments: AilmentReport[] = result.ailments.ailments.map(a => {
      if (matched) return a;
      const { calculatedEffect: _effect, landsOnConfiguredEnemy: _lands, thresholdTable: _threshold, ...safe } = a;
      return safe;
    });
    const uncredited = ailments.filter(a => !a.creditedInCalc && a.landsOnConfiguredEnemy === true).map(a => a.name);
    const unknown = ailments.filter(a => !a.creditedInCalc && a.calculatedEffect == null && a.chanceOnHit + a.chanceOnCrit > 0).map(a => a.name);
    return { content: [{ type: 'text', text: JSON.stringify({ ...context, ailments, calculationSelectionMatchesMain: matched, config: result.config, skills: result.skills, uncredited, unknown,
      warnings: [...context.warnings, 'Effects credited by PoB and estimated effects on the configured enemy are different; a missing estimate is unknown, not zero.', 'This report uses the selected main skill and covers non-damaging ailments with a magnitude, not minion ailments, damaging ailments, freeze duration, or an in-game uptime guarantee.', ...(!matched ? ['The calculation-tab skill differs from or cannot be matched to the main skill; estimated effects and thresholds are withheld.'] : []), ...(uncredited.length ? ['Some estimated effects can land on the configured enemy but are not credited by PoB; review the returned config variables and actual uptime before changing conditions.'] : []), ...(unknown.length ? ['Some possible effects could not be estimated; do not infer that they fail to land.'] : [])] }) }] };
  } };
}
