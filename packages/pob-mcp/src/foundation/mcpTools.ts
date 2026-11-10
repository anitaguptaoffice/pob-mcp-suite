import type { ToolSchema } from '../server/toolSchemas.js';
import type { BuildFoundation, EvaluationOptions } from './buildFoundation.js';
import type { EvaluationInput, JobRunner } from './jobRunner.js';
import { snapshotMetadata } from './snapshotStore.js';
import { readLocalBuild, saveLocalBuild } from './localBuildFile.js';

/** Experimental surface; enabled only by explicit configuration. */
export const foundationSchemas: ToolSchema[] = [
  { name: 'foundation_import_build', description: 'Import a PoB XML document into an immutable snapshot.', inputSchema: { type: 'object', properties: { xml: { type: 'string' }, source: { type: 'string' } }, required: ['xml', 'source'] } },
  { name: 'foundation_import_file', description: 'Import an XML build from the configured local build directory.', inputSchema: { type: 'object', properties: { build_name: { type: 'string' } }, required: ['build_name'] } },
  { name: 'foundation_save_file', description: 'Retain the snapshot and save it to the local build directory; overwrite is false by default. Retention can succeed even if the file write fails.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, build_name: { type: 'string' }, overwrite: { type: 'boolean' } }, required: ['snapshot_id', 'build_name'] } },
  { name: 'foundation_import_code', description: 'Import a PoB share code into an immutable snapshot.', inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
  { name: 'foundation_read_snapshot', description: 'Read snapshot metadata without XML.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } },
  { name: 'foundation_retain_snapshot', description: 'Permanently retain a snapshot and its ancestors without changing its ID.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } },
  { name: 'foundation_snapshot_retention', description: 'Read snapshot trial expiry and explicit retention status.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } },
  { name: 'foundation_list_snapshots', description: 'List snapshot metadata by ID in pages.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 }, after: { type: 'string' } } } },
  { name: 'foundation_item_affix_weight', description: 'Read PoB modifier spawn weight for an item; not a crafting probability.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, mod_id: { type: 'string' }, item_text: { type: 'string' } }, required: ['snapshot_id', 'mod_id', 'item_text'] } },
  { name: 'foundation_compatible_supports', description: 'Query PoB support compatibility for the selected skill; not a damage ranking.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, include_exceptional: { type: 'boolean' } }, required: ['snapshot_id'] } },
  { name: 'foundation_search_tree', description: 'Search nodes in the snapshot tree version; results are bounded and unordered.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, query: { type: 'string' }, node_type: { type: 'string', enum: ['normal', 'notable', 'keystone', 'jewel', 'mastery', 'ascendancy'] }, limit: { type: 'integer', minimum: 1, maximum: 30 }, include_allocated: { type: 'boolean' } }, required: ['snapshot_id', 'query'] } },
  { name: 'foundation_inspect', description: 'Read selected build, tree, item, skill or config sections from a snapshot.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, sections: { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: { type: 'string', enum: ['build', 'tree', 'items', 'skills', 'config'] } } }, required: ['snapshot_id', 'sections'] } },
  { name: 'foundation_evaluate', description: 'Calculate specified PoB metrics for a snapshot.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } }, selection: { type: 'object', properties: { mainSocketGroup: { type: 'integer', minimum: 1 }, mainActiveSkill: { type: 'integer', minimum: 1 }, skillPart: { type: 'integer', minimum: 1 } } }, config: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } } }, required: ['snapshot_id', 'fields'] } },
  { name: 'foundation_mastery_node_options', description: 'Read PoB options for a mastery node, allocated or not; this does not prove allocatability.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, node_id: { type: 'integer', minimum: 1 } }, required: ['snapshot_id', 'node_id'] } },
  { name: 'foundation_mastery_options', description: 'Read PoB effect options for allocated mastery nodes in a snapshot.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } },
  { name: 'foundation_derive_masteries', description: 'Change effects on already allocated mastery nodes using PoB-valid effect IDs.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean', description: 'Create a seven-day trial snapshot; false creates a durable snapshot.' }, snapshot_id: { type: 'string' }, effects: { type: 'object', additionalProperties: { type: 'integer', minimum: 1 } } }, required: ['snapshot_id', 'effects'] } },
  { name: 'foundation_derive_tree', description: 'Create a snapshot with exact passive node additions and removals, including effects for newly added mastery nodes.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean', description: 'Create a seven-day trial snapshot; false creates a durable snapshot.' }, snapshot_id: { type: 'string' }, add_nodes: { type: 'array', items: { type: 'integer', minimum: 1 } }, remove_nodes: { type: 'array', items: { type: 'integer', minimum: 1 } }, mastery_effects: { type: 'object', additionalProperties: { type: 'integer', minimum: 1 } } }, required: ['snapshot_id'] } },
  { name: 'foundation_derive_config', description: 'Create a new snapshot with explicit PoB config changes.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean', description: 'Create a seven-day trial snapshot; false creates a durable snapshot.' }, snapshot_id: { type: 'string' }, config: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } } }, required: ['snapshot_id', 'config'] } },
  { name: 'foundation_derive_item', description: 'Equip an item in one slot and create a verified snapshot.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean', description: 'Create a seven-day trial snapshot; false creates a durable snapshot.' }, snapshot_id: { type: 'string' }, slot: { type: 'string' }, item_text: { type: 'string' } }, required: ['snapshot_id', 'slot', 'item_text'] } },
  { name: 'foundation_derive_level', description: 'Create a new snapshot with a changed character level.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean', description: 'Create a seven-day trial snapshot; false creates a durable snapshot.' }, snapshot_id: { type: 'string' }, level: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['snapshot_id', 'level'] } },
  { name: 'foundation_derive_selection', description: 'Create a verified snapshot with an explicitly selected main skill group, active skill or skill part.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, selection: { type: 'object', minProperties: 1, additionalProperties: false, properties: { mainSocketGroup: { type: 'integer', minimum: 1 }, mainActiveSkill: { type: 'integer', minimum: 1 }, skillPart: { type: 'integer', minimum: 1 } } } }, required: ['snapshot_id', 'selection'] } },
  { name: 'foundation_export_build', description: 'Export a snapshot as PoB XML.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } },
  { name: 'foundation_submit_evaluations', description: 'Start a bounded batch of snapshot evaluations.', inputSchema: { type: 'object', properties: { items: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', properties: { snapshotId: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } }, options: { type: 'object', properties: { selection: { type: 'object' }, config: { type: 'object' } } } }, required: ['snapshotId', 'fields'] } } }, required: ['items'] } },
  { name: 'foundation_get_job', description: 'Read job status and per-item results.', inputSchema: { type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'] } },
  { name: 'foundation_cancel_job', description: 'Request cancellation; the active item finishes before cancellation is complete.', inputSchema: { type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'] } },
];

export async function invokeFoundation(foundation: BuildFoundation, name: string, args: Record<string, unknown>, jobs?: JobRunner, buildsDirectory?: string): Promise<unknown> {
  const stringArg = (key: string): string => {
    const value = args[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a non-empty string`);
    return value;
  };
  const trialArg = (): boolean => {
    if (args.trial !== undefined && typeof args.trial !== 'boolean') throw new Error('trial must be a boolean');
    return args.trial === true;
  };
  switch (name) {
    case 'foundation_submit_evaluations':
      if (!jobs) throw new Error('Job runner is unavailable');
      return jobs.submit(args.items as EvaluationInput[]);
    case 'foundation_get_job':
      if (!jobs) throw new Error('Job runner is unavailable');
      return jobs.get(stringArg('job_id'));
    case 'foundation_cancel_job':
      if (!jobs) throw new Error('Job runner is unavailable');
      return jobs.cancel(stringArg('job_id'));
    case 'foundation_read_snapshot': return foundation.readSnapshot(stringArg('snapshot_id'));
    case 'foundation_retain_snapshot': return foundation.retainSnapshot(stringArg('snapshot_id'));
    case 'foundation_snapshot_retention': return foundation.snapshotRetention(stringArg('snapshot_id'));
    case 'foundation_list_snapshots': {
      if (args.limit !== undefined && (typeof args.limit !== 'number' || !Number.isInteger(args.limit))) throw new Error('Invalid snapshot limit');
      if (args.after !== undefined && typeof args.after !== 'string') throw new Error('Invalid snapshot cursor');
      return foundation.listSnapshots(args.limit as number | undefined, args.after as string | undefined);
    }
    case 'foundation_save_file': {
      if (!buildsDirectory) throw new Error('Local build directory is unavailable');
      if (args.overwrite !== undefined && typeof args.overwrite !== 'boolean') throw new Error('overwrite must be a boolean');
      const id = stringArg('snapshot_id');
      const name = stringArg('build_name');
      const xml = await foundation.exportBuild(id);
      await foundation.retainSnapshot(id);
      await saveLocalBuild(buildsDirectory, name, xml, args.overwrite === true);
      return { snapshotId: id, buildName: name, overwriteAllowed: args.overwrite === true, retained: true };
    }
    case 'foundation_import_file': {
      if (!buildsDirectory) throw new Error('Local build directory is unavailable');
      const name = stringArg('build_name');
      return snapshotMetadata(await foundation.importBuild(await readLocalBuild(buildsDirectory, name), `file:${name}`));
    }
    case 'foundation_import_build': return snapshotMetadata(await foundation.importBuild(stringArg('xml'), stringArg('source')));
    case 'foundation_import_code': return snapshotMetadata(await foundation.importCode(stringArg('code')));
    case 'foundation_item_affix_weight': return foundation.itemAffixWeight(stringArg('snapshot_id'), stringArg('mod_id'), stringArg('item_text'));
    case 'foundation_compatible_supports': return foundation.compatibleSupports(stringArg('snapshot_id'), {
      groupIndex: args.group_index as number | undefined, query: args.query as string | undefined,
      limit: args.limit as number | undefined, includeExceptional: args.include_exceptional as boolean | undefined,
    });
    case 'foundation_search_tree': return foundation.searchTree(stringArg('snapshot_id'), stringArg('query'), {
      nodeType: args.node_type as string | undefined, limit: args.limit as number | undefined,
      includeAllocated: args.include_allocated as boolean | undefined,
    });
    case 'foundation_inspect': return foundation.inspect(stringArg('snapshot_id'), args.sections as string[]);
    case 'foundation_evaluate': {
      const id = stringArg('snapshot_id');
      const fields = args.fields;
      if (!Array.isArray(fields) || !fields.length || fields.length > 100 || fields.some(x => typeof x !== 'string' || !x.trim())) throw new Error('fields must contain 1 to 100 non-empty metric names');
      return foundation.evaluate(id, fields as string[], { selection: args.selection as EvaluationOptions['selection'], config: args.config as EvaluationOptions['config'] });
    }
    case 'foundation_mastery_node_options': return foundation.masteryNodeOptions(stringArg('snapshot_id'), args.node_id as number);
    case 'foundation_mastery_options': return foundation.masteryOptions(stringArg('snapshot_id'));
    case 'foundation_derive_masteries': return snapshotMetadata(await foundation.deriveMasteries(stringArg('snapshot_id'), args.effects as Record<string, number>, trialArg()));
    case 'foundation_derive_tree': return snapshotMetadata(await foundation.deriveTree(stringArg('snapshot_id'), (args.add_nodes ?? []) as number[], (args.remove_nodes ?? []) as number[], (args.mastery_effects ?? {}) as Record<string, number>, trialArg()));
    case 'foundation_derive_config': return snapshotMetadata(await foundation.deriveConfig(stringArg('snapshot_id'), args.config as Record<string, string | number | boolean>, trialArg()));
    case 'foundation_derive_item': return snapshotMetadata(await foundation.deriveItem(stringArg('snapshot_id'), stringArg('slot'), stringArg('item_text'), trialArg()));
    case 'foundation_derive_selection': return snapshotMetadata(await foundation.deriveSelection(stringArg('snapshot_id'), args.selection as NonNullable<EvaluationOptions['selection']>, trialArg()));
    case 'foundation_derive_level': {
      const id = stringArg('snapshot_id');
      if (typeof args.level !== 'number' || !Number.isInteger(args.level) || args.level < 1 || args.level > 100) throw new Error('level must be an integer between 1 and 100');
      return snapshotMetadata(await foundation.deriveLevel(id, args.level, trialArg()));
    }
    case 'foundation_export_build': return { xml: await foundation.exportBuild(stringArg('snapshot_id')) };
    default: throw new Error(`Unknown foundation tool: ${name}`);
  }
}
