import type { ToolSchema } from '../server/toolSchemas.js';
import type { BuildFoundation, EvaluationOptions } from './buildFoundation.js';
import type { EvaluationInput, JobRunner } from './jobRunner.js';
import { snapshotMetadata } from './snapshotStore.js';
import { readLocalBuild, saveLocalBuild } from './localBuildFile.js';
import { listLegacyHistory, readLegacyHistory, readUnpairedLegacyHistory } from './legacyHistory.js';
import { createHash } from 'node:crypto';
import { inspectLocalFile, restoreLocalFile } from './restoreLocalFile.js';

/** Experimental surface; enabled only by explicit configuration. */
export const foundationSchemas: ToolSchema[] = [
  { name: 'inspect_unpaired_legacy_xml', description: 'Fingerprint an old history XML without readable metadata, selected from list_legacy_build_history issues. Does not infer its tag or purpose.', inputSchema: { type: 'object', additionalProperties: false, properties: { build_name: { type: 'string' }, origin: { type: 'string' }, file: { type: 'string' } }, required: ['build_name', 'origin', 'file'] } },
  { name: 'import_unpaired_legacy_xml', description: 'Explicitly import an unpaired old history XML after verifying its inspected content digest. Records the original filename without inventing missing metadata.', inputSchema: { type: 'object', additionalProperties: false, properties: { build_name: { type: 'string' }, origin: { type: 'string' }, file: { type: 'string' }, expected_xml_sha256: { type: 'string' } }, required: ['build_name', 'origin', 'file', 'expected_xml_sha256'] } },
  { name: 'inspect_local_build_file', description: 'Read a local build file fingerprint before an explicit restore; no PoB engine is started.', inputSchema: { type: 'object', additionalProperties: false, properties: { build_name: { type: 'string' } }, required: ['build_name'] } },
  { name: 'restore_snapshot_file', description: 'Replace an existing local build file using an explicit snapshot and expected current fingerprint. Saves a durable backup snapshot by default; external writes can still race the final replacement.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, build_name: { type: 'string' }, expected_current_sha256: { type: 'string' }, backup_current: { type: 'boolean' } }, required: ['snapshot_id', 'build_name', 'expected_current_sha256'] } },
  { name: 'save_snapshot_history', description: 'Permanently retain a snapshot and record its build name, tag and description separately from snapshot content.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, build_name: { type: 'string' }, tag: { type: 'string' }, description: { type: 'string' } }, required: ['snapshot_id', 'build_name', 'tag'] } },
  { name: 'list_snapshot_history', description: 'List saved snapshot history, optionally filtering by exact build name and tag. Restart pagination if the catalog fingerprint changes.', inputSchema: { type: 'object', additionalProperties: false, properties: { build_name: { type: 'string' }, tag: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 }, after: { type: 'integer', minimum: 0 }, catalog_fingerprint: { type: 'string' } } } },
  { name: 'list_legacy_build_history', description: 'List old local build snapshots and their original metadata without modifying them. Restart pagination if the catalog fingerprint changes.', inputSchema: { type: 'object', additionalProperties: false, properties: { build_name: { type: 'string' }, tag: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 }, after: { type: 'integer', minimum: 0 }, catalog_fingerprint: { type: 'string' } }, required: ['build_name'] } },
  { name: 'import_legacy_build_history', description: 'Import one explicitly selected old history XML as a new durable snapshot; the old XML and metadata remain unchanged.', inputSchema: { type: 'object', additionalProperties: false, properties: { build_name: { type: 'string' }, origin: { type: 'string' }, legacy_id: { type: 'string' }, metadata_digest: { type: 'string' } }, required: ['build_name', 'origin', 'legacy_id', 'metadata_digest'] } },
  { name: 'foundation_derive_items', description: 'Atomically equip 1–10 explicit items in distinct slots and create a verified snapshot. Does not establish in-game item legality.', inputSchema: { type: 'object', additionalProperties: false, properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, items: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', additionalProperties: false, properties: { slot: { type: 'string' }, item_text: { type: 'string' } }, required: ['slot', 'item_text'] } } }, required: ['snapshot_id', 'items'] } },
  { name: 'foundation_create_build', description: 'Create a new PoB build as a durable immutable snapshot after verifying the requested class, ascendancy and tree version survive reload. Special ascendancies require their matching tree version.', inputSchema: { type: 'object', additionalProperties: false, properties: { class_name: { type: 'string' }, ascendancy: { type: 'string' }, tree_version: { type: 'string' } }, required: ['class_name'] } },
  { name: 'foundation_import_build', description: 'Import a PoB XML document into an immutable snapshot.', inputSchema: { type: 'object', properties: { xml: { type: 'string' }, source: { type: 'string' } }, required: ['xml', 'source'] } },
  { name: 'foundation_import_file', description: 'Import an XML build from the configured local build directory.', inputSchema: { type: 'object', properties: { build_name: { type: 'string' } }, required: ['build_name'] } },
  { name: 'foundation_save_file', description: 'Retain the snapshot and save it to the local build directory; overwrite is false by default. Retention can succeed even if the file write fails.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, build_name: { type: 'string' }, overwrite: { type: 'boolean' } }, required: ['snapshot_id', 'build_name'] } },
  { name: 'foundation_import_code', description: 'Import a PoB share code into an immutable snapshot.', inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
  { name: 'foundation_read_snapshot', description: 'Read snapshot metadata without XML.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } },
  { name: 'foundation_retain_snapshot', description: 'Permanently retain a snapshot and its ancestors without changing its ID.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } },
  { name: 'foundation_snapshot_retention', description: 'Read snapshot trial expiry and explicit retention status.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } },
  { name: 'foundation_list_snapshots', description: 'List snapshot metadata by ID in pages.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 }, after: { type: 'string' } } } },
  { name: 'foundation_item_affix_weight', description: 'Read PoB modifier spawn weight for an item; not a crafting probability.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, mod_id: { type: 'string' }, item_text: { type: 'string' } }, required: ['snapshot_id', 'mod_id', 'item_text'] } },
  { name: 'foundation_preview_item', description: 'Compare an item against a snapshot in PoB without modifying it; item legality and availability are not verified.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, slot: { type: 'string' }, item_text: { type: 'string' } }, required: ['snapshot_id', 'slot', 'item_text'] } },
  { name: 'foundation_compatible_supports', description: 'Query PoB support compatibility for the selected skill; not a damage ranking.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, include_exceptional: { type: 'boolean' } }, required: ['snapshot_id'] } },
  { name: 'foundation_search_tree', description: 'Search nodes in the snapshot tree version; results are bounded and unordered.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, query: { type: 'string' }, node_type: { type: 'string', enum: ['normal', 'notable', 'keystone', 'jewel', 'mastery', 'ascendancy'] }, limit: { type: 'integer', minimum: 1, maximum: 30 }, include_allocated: { type: 'boolean' } }, required: ['snapshot_id', 'query'] } },
  { name: 'foundation_inspect', description: 'Read selected build, tree, item, skill or config sections from a snapshot.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, sections: { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: { type: 'string', enum: ['build', 'tree', 'items', 'skills', 'config'] } } }, required: ['snapshot_id', 'sections'] } },
  { name: 'foundation_read_notes', description: 'Read PoB notes from an immutable snapshot.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } },
  { name: 'foundation_derive_notes', description: 'Create a verified snapshot with replaced PoB notes; the source snapshot and any local build file are unchanged.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, notes: { type: 'string' }, trial: { type: 'boolean' } }, required: ['snapshot_id', 'notes'] } },
  { name: 'foundation_evaluate', description: 'Calculate specified PoB metrics for a snapshot.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } }, selection: { type: 'object', properties: { mainSocketGroup: { type: 'integer', minimum: 1 }, mainActiveSkill: { type: 'integer', minimum: 1 }, skillPart: { type: 'integer', minimum: 1 } } }, config: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } } }, required: ['snapshot_id', 'fields'] } },
  { name: 'foundation_mastery_node_options', description: 'Read PoB options for a mastery node, allocated or not; this does not prove allocatability.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' }, node_id: { type: 'integer', minimum: 1 } }, required: ['snapshot_id', 'node_id'] } },
  { name: 'foundation_mastery_options', description: 'Read PoB effect options for allocated mastery nodes in a snapshot.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } },
  { name: 'foundation_derive_masteries', description: 'Change effects on already allocated mastery nodes using PoB-valid effect IDs.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean', description: 'Create a seven-day trial snapshot; false creates a durable snapshot.' }, snapshot_id: { type: 'string' }, effects: { type: 'object', additionalProperties: { type: 'integer', minimum: 1 } } }, required: ['snapshot_id', 'effects'] } },
  { name: 'foundation_derive_tree', description: 'Create a snapshot with exact passive node additions and removals, including effects for newly added mastery nodes.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean', description: 'Create a seven-day trial snapshot; false creates a durable snapshot.' }, snapshot_id: { type: 'string' }, add_nodes: { type: 'array', items: { type: 'integer', minimum: 1 } }, remove_nodes: { type: 'array', items: { type: 'integer', minimum: 1 } }, mastery_effects: { type: 'object', additionalProperties: { type: 'integer', minimum: 1 } } }, required: ['snapshot_id'] } },
  { name: 'foundation_derive_config', description: 'Create a new snapshot with explicit PoB config changes.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean', description: 'Create a seven-day trial snapshot; false creates a durable snapshot.' }, snapshot_id: { type: 'string' }, config: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } } }, required: ['snapshot_id', 'config'] } },
  { name: 'foundation_derive_item', description: 'Equip an item in one slot and create a verified snapshot.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean', description: 'Create a seven-day trial snapshot; false creates a durable snapshot.' }, snapshot_id: { type: 'string' }, slot: { type: 'string' }, item_text: { type: 'string' } }, required: ['snapshot_id', 'slot', 'item_text'] } },
  { name: 'foundation_derive_level', description: 'Create a new snapshot with a changed character level.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean', description: 'Create a seven-day trial snapshot; false creates a durable snapshot.' }, snapshot_id: { type: 'string' }, level: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['snapshot_id', 'level'] } },
  { name: 'foundation_derive_selection', description: 'Create a verified snapshot with an explicitly selected main skill group, active skill or skill part.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, selection: { type: 'object', minProperties: 1, additionalProperties: false, properties: { mainSocketGroup: { type: 'integer', minimum: 1 }, mainActiveSkill: { type: 'integer', minimum: 1 }, skillPart: { type: 'integer', minimum: 1 } } } }, required: ['snapshot_id', 'selection'] } },
  { name: 'foundation_derive_gem', description: 'Create a verified child snapshot changing an existing gem level, quality and/or enabled state. This does not establish in-game gem availability.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, gem_index: { type: 'integer', minimum: 1 }, changes: { type: 'object', minProperties: 1, additionalProperties: false, properties: { level: { type: 'integer', minimum: 1, maximum: 40 }, quality: { type: 'integer', minimum: 0, maximum: 99 }, enabled: { type: 'boolean' } } } }, required: ['snapshot_id', 'group_index', 'gem_index', 'changes'] } },
  { name: 'foundation_replace_support', description: 'Atomically replace one enabled support in the saved main skill group and create a verified child snapshot. PoB application, sockets and gem availability still require checking.', inputSchema: { type: 'object', additionalProperties: false, properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, gem_index: { type: 'integer', minimum: 1 }, replacement: { type: 'object', additionalProperties: false, properties: { gemName: { type: 'string' }, level: { type: 'integer', minimum: 1, maximum: 40 }, quality: { type: 'integer', minimum: 0, maximum: 99 } }, required: ['gemName'] } }, required: ['snapshot_id', 'group_index', 'gem_index', 'replacement'] } },
  { name: 'foundation_derive_gem_setup', description: 'Atomically create a child snapshot with an explicit full main-group gem setup, retaining existing gem instances where possible. Socket legality and gem availability are not established.', inputSchema: { type: 'object', additionalProperties: false, properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, gems: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', additionalProperties: false, properties: { gemName: { type: 'string' }, level: { type: 'integer', minimum: 1, maximum: 40 }, quality: { type: 'integer', minimum: 0, maximum: 99 }, enabled: { type: 'boolean' } }, required: ['gemName'] } } }, required: ['snapshot_id', 'group_index', 'gems'] } },
  { name: 'foundation_derive_gem_list', description: 'Add or remove one gem in a verified child snapshot. Names must resolve uniquely in PoB; this does not verify game availability or socket legality.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, operation: { type: 'object', additionalProperties: false, properties: { type: { type: 'string', enum: ['add', 'remove'] }, gemName: { type: 'string' }, gemIndex: { type: 'integer', minimum: 1 }, level: { type: 'integer', minimum: 1, maximum: 40 }, quality: { type: 'integer', minimum: 0, maximum: 99 }, enabled: { type: 'boolean' }, count: { type: 'integer', minimum: 1, maximum: 10000 }, enableGlobal1: { type: 'boolean' }, enableGlobal2: { type: 'boolean' }, insertIndex: { type: 'integer', minimum: 1 } }, required: ['type'] } }, required: ['snapshot_id', 'group_index', 'operation'] } },
  { name: 'foundation_derive_skill_group', description: 'Atomically create a skill group with optional PoB-resolved gems in a verified child snapshot. Does not verify game availability or socket legality.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, group: { type: 'object', additionalProperties: false, properties: { label: { type: 'string' }, slot: { type: 'string' }, enabled: { type: 'boolean' }, includeInFullDPS: { type: 'boolean' } } }, gems: { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false, properties: { gemName: { type: 'string' }, level: { type: 'integer', minimum: 1, maximum: 40 }, quality: { type: 'integer', minimum: 0, maximum: 99 }, enabled: { type: 'boolean' } }, required: ['gemName'] } } }, required: ['snapshot_id', 'group', 'gems'] } },
  { name: 'foundation_derive_skill_group_enabled', description: 'Enable or disable one skill group in a verified child snapshot.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, enabled: { type: 'boolean' } }, required: ['snapshot_id', 'group_index', 'enabled'] } },
  { name: 'foundation_remove_skill_group', description: 'Remove a skill group in a verified child snapshot; provide post-removal replacements when removing a selected main or independent calculation group.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, group_index: { type: 'integer', minimum: 1 }, replacement_main_group: { type: 'integer', minimum: 1 }, replacement_calcs_group: { type: 'integer', minimum: 1 } }, required: ['snapshot_id', 'group_index'] } },
  { name: 'foundation_derive_flask_active', description: 'Set the PoB activation state of one flask slot in a verified child snapshot; activation does not establish in-game uptime.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, flask_index: { type: 'integer', minimum: 1, maximum: 5 }, active: { type: 'boolean' } }, required: ['snapshot_id', 'flask_index', 'active'] } },
  { name: 'foundation_item_sets', description: 'List the snapshot item sets using PoB IDs and identify the selected set.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } },
  { name: 'foundation_derive_item_set', description: 'Select a PoB item set in a verified child snapshot, checking equipment in every set after reload.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, item_set_id: { type: 'integer', minimum: 1 } }, required: ['snapshot_id', 'item_set_id'] } },
  { name: 'foundation_specs', description: 'List the passive tree specs of a snapshot using PoB indices.', inputSchema: { type: 'object', properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } },
  { name: 'foundation_derive_spec', description: 'Select a passive spec in a verified child snapshot, checking all specs after reload.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, spec_index: { type: 'integer', minimum: 1 } }, required: ['snapshot_id', 'spec_index'] } },
  { name: 'foundation_create_spec', description: 'Create or copy a passive spec in a verified child snapshot.', inputSchema: { type: 'object', additionalProperties: false, properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, title: { type: 'string' }, copy_from: { type: 'integer', minimum: 1 }, activate: { type: 'boolean' } }, required: ['snapshot_id'] } },
  { name: 'foundation_rename_spec', description: 'Rename a passive spec in a verified child snapshot.', inputSchema: { type: 'object', properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, spec_index: { type: 'integer', minimum: 1 }, title: { type: 'string' } }, required: ['snapshot_id', 'spec_index', 'title'] } },
  { name: 'foundation_delete_spec', description: 'Delete a passive spec in a verified child. Deleting the active spec requires an explicit replacement index after deletion.', inputSchema: { type: 'object', additionalProperties: false, properties: { trial: { type: 'boolean' }, snapshot_id: { type: 'string' }, spec_index: { type: 'integer', minimum: 1 }, replacement_spec: { type: 'integer', minimum: 1 } }, required: ['snapshot_id', 'spec_index'] } },
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
    case 'inspect_unpaired_legacy_xml': {
      if (!buildsDirectory || Object.keys(args).some(key => !['build_name', 'origin', 'file'].includes(key))) throw new Error('Invalid unpaired history selection');
      const { xml, ...selected } = await readUnpairedLegacyHistory(buildsDirectory, stringArg('build_name'), stringArg('origin'), stringArg('file'));
      return { ...selected, sizeBytes: Buffer.byteLength(xml, 'utf8'), warnings: ['Metadata is missing or unreadable; the filename does not establish the original tag, timestamp or purpose.'] };
    }
    case 'import_unpaired_legacy_xml': {
      if (!buildsDirectory || Object.keys(args).some(key => !['build_name', 'origin', 'file', 'expected_xml_sha256'].includes(key))) throw new Error('Invalid unpaired history selection');
      const expected = stringArg('expected_xml_sha256');
      if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Invalid XML fingerprint');
      const selected = await readUnpairedLegacyHistory(buildsDirectory, stringArg('build_name'), stringArg('origin'), stringArg('file'));
      if (selected.xmlDigest !== expected) throw new Error('Unpaired XML changed since inspection; no snapshot was imported');
      const snapshot = await foundation.importBuild(selected.xml, `legacy-unpaired:${selected.buildName}:${selected.origin}:${selected.file}`);
      const metadata = { status: 'unpaired', originalFileName: selected.file, identifierSource: 'sha256_of_filename', metadataDigestSource: 'synthetic_recovery_metadata' };
      const metadataDigest = createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
      const legacyId = createHash('sha256').update(selected.file).digest('hex');
      let history;
      try { history = await foundation.saveHistory(snapshot.id, { buildName: selected.buildName, tag: '', description: '', recordedAt: null, legacy: { id: legacyId, origin: selected.origin, metadataDigest, xmlDigest: selected.xmlDigest, metadata } }); }
      catch (error) { throw new Error(`Snapshot ${snapshot.id} was imported, but recovery history could not be saved; retry: ${error instanceof Error ? error.message : String(error)}`); }
      return { snapshot: snapshotMetadata(snapshot), history, warnings: ['Original XML is unchanged. Original metadata, tag, timestamp and purpose are unknown.'] };
    }
    case 'inspect_local_build_file':
      if (!buildsDirectory || Object.keys(args).some(key => key !== 'build_name')) throw new Error('Invalid local build file inspection');
      return inspectLocalFile(buildsDirectory, stringArg('build_name'));
    case 'restore_snapshot_file':
      if (!buildsDirectory || Object.keys(args).some(key => !['snapshot_id', 'build_name', 'expected_current_sha256', 'backup_current'].includes(key)) || (args.backup_current !== undefined && typeof args.backup_current !== 'boolean')) throw new Error('Invalid restore options');
      return restoreLocalFile(foundation, buildsDirectory, stringArg('snapshot_id'), stringArg('build_name'), stringArg('expected_current_sha256'), args.backup_current !== false);
    case 'save_snapshot_history': {
      if (Object.keys(args).some(key => !['snapshot_id', 'build_name', 'tag', 'description'].includes(key)) || typeof args.tag !== 'string' || (args.description !== undefined && typeof args.description !== 'string')) throw new Error('Invalid snapshot history options');
      return foundation.saveHistory(stringArg('snapshot_id'), { buildName: stringArg('build_name'), tag: args.tag, description: args.description as string ?? '', recordedAt: new Date().toISOString() });
    }
    case 'list_snapshot_history': {
      const limit = args.limit ?? 20, after = args.after ?? 0;
      if (Object.keys(args).some(key => !['build_name', 'tag', 'limit', 'after', 'catalog_fingerprint'].includes(key)) || (args.build_name !== undefined && (typeof args.build_name !== 'string' || !args.build_name.trim() || args.build_name.length > 1000)) || (args.tag !== undefined && (typeof args.tag !== 'string' || args.tag.length > 1000)) || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || typeof after !== 'number' || !Number.isSafeInteger(after) || after < 0 || (args.catalog_fingerprint !== undefined && (typeof args.catalog_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(args.catalog_fingerprint))) || (after > 0 && !args.catalog_fingerprint)) throw new Error('Invalid snapshot history pagination');
      const records = (await foundation.listHistory()).filter(record => (args.build_name === undefined || record.buildName === args.build_name) && (args.tag === undefined || record.tag === args.tag));
      const fingerprint = createHash('sha256').update(JSON.stringify({ ids: records.map(record => record.id), buildName: args.build_name ?? null, tag: args.tag ?? null })).digest('hex');
      if (args.catalog_fingerprint !== undefined && args.catalog_fingerprint !== fingerprint) throw new Error('Snapshot history changed; restart pagination');
      if (after > records.length) throw new Error('Invalid snapshot history cursor');
      const entries = records.slice(after, after + limit);
      return { entries, total: records.length, nextCursor: after + entries.length < records.length ? after + entries.length : null, catalogFingerprint: fingerprint, warnings: ['Legacy stats are historical values; evaluate the snapshot for current PoB calculations.'] };
    }
    case 'list_legacy_build_history': {
      if (!buildsDirectory) throw new Error('Local build directory is unavailable');
      const limit = args.limit ?? 20, after = args.after ?? 0;
      if (Object.keys(args).some(key => !['build_name', 'tag', 'limit', 'after', 'catalog_fingerprint'].includes(key)) || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || typeof after !== 'number' || !Number.isSafeInteger(after) || after < 0 || (args.tag !== undefined && (typeof args.tag !== 'string' || args.tag.length > 1000)) || (args.catalog_fingerprint !== undefined && (typeof args.catalog_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(args.catalog_fingerprint))) || (after > 0 && !args.catalog_fingerprint)) throw new Error('Invalid legacy history pagination');
      const result = await listLegacyHistory(buildsDirectory, stringArg('build_name'));
      const entries = result.entries.filter(entry => args.tag === undefined || entry.metadata.tag === args.tag);
      const fingerprint = createHash('sha256').update(JSON.stringify({ entries: entries.map(({ origin, id, metadataDigest, xmlName }) => ({ origin, id, metadataDigest, xmlName })), issues: result.issues, tag: args.tag ?? null })).digest('hex');
      if (args.catalog_fingerprint !== undefined && args.catalog_fingerprint !== fingerprint) throw new Error('Legacy history changed; restart pagination');
      if (after > entries.length) throw new Error('Invalid legacy history cursor');
      const page = entries.slice(after, after + limit).map(({ xmlName: _xmlName, ...entry }) => entry);
      return { source: 'legacy_build_history', complete: result.complete, issues: result.issues, entries: page, totalObserved: entries.length, nextCursor: after + page.length < entries.length ? after + page.length : null, catalogFingerprint: fingerprint, warnings: ['Cached legacy stats are historical XML values, not current PoB calculations.', 'The catalog fingerprints metadata and names, not XML content; the import reports the XML digest it actually read.', 'Original files remain unchanged; the catalog may change after this read.'] };
    }
    case 'import_legacy_build_history': {
      if (!buildsDirectory) throw new Error('Local build directory is unavailable');
      if (Object.keys(args).some(key => !['build_name', 'origin', 'legacy_id', 'metadata_digest'].includes(key))) throw new Error('Invalid legacy history selection');
      const selected = await readLegacyHistory(buildsDirectory, stringArg('build_name'), stringArg('origin'), stringArg('legacy_id'), stringArg('metadata_digest'));
      const snapshot = await foundation.importBuild(selected.xml, `legacy-history:${selected.buildName}:${selected.origin}:${selected.id}`);
      let history;
      try {
        history = await foundation.saveHistory(snapshot.id, { buildName: selected.buildName, tag: selected.metadata.tag as string,
          description: typeof selected.metadata.description === 'string' && selected.metadata.description.length <= 10000 ? selected.metadata.description : '',
          recordedAt: typeof selected.metadata.timestamp === 'string' && selected.metadata.timestamp.length <= 100 ? selected.metadata.timestamp : null,
          legacy: { id: selected.id, origin: selected.origin, metadataDigest: selected.metadataDigest, xmlDigest: selected.xmlDigest, metadata: selected.metadata } });
      } catch (error) { throw new Error(`Snapshot ${snapshot.id} was imported, but history metadata could not be saved; retry: ${error instanceof Error ? error.message : String(error)}`); }
      const { xml: _xml, ...legacy } = selected;
      return { snapshot: snapshotMetadata(snapshot), history, legacy, warnings: ['Legacy cached stats are historical and are not recalculated. Original files remain unchanged.'] };
    }
    case 'foundation_derive_items': {
      if (Object.keys(args).some(key => !['snapshot_id', 'items', 'trial'].includes(key)) || !Array.isArray(args.items) || args.items.some(item => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['slot', 'item_text'].includes(key)) || typeof item.slot !== 'string' || typeof item.item_text !== 'string')) throw new Error('Invalid item changes');
      return snapshotMetadata(await foundation.deriveItems(stringArg('snapshot_id'), args.items.map(item => ({ slot: item.slot, itemText: item.item_text })), trialArg()));
    }
    case 'foundation_create_build':
      if (Object.keys(args).some(key => !['class_name', 'ascendancy', 'tree_version'].includes(key)) || (args.ascendancy !== undefined && typeof args.ascendancy !== 'string') || (args.tree_version !== undefined && typeof args.tree_version !== 'string')) throw new Error('Invalid new build options');
      return snapshotMetadata(await foundation.createBuild(stringArg('class_name'), args.ascendancy as string | undefined, args.tree_version as string | undefined));
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
    case 'foundation_preview_item': return foundation.previewItem(stringArg('snapshot_id'), stringArg('slot'), stringArg('item_text'));
    case 'foundation_compatible_supports': return foundation.compatibleSupports(stringArg('snapshot_id'), {
      groupIndex: args.group_index as number | undefined, query: args.query as string | undefined,
      limit: args.limit as number | undefined, includeExceptional: args.include_exceptional as boolean | undefined,
    });
    case 'foundation_search_tree': return foundation.searchTree(stringArg('snapshot_id'), stringArg('query'), {
      nodeType: args.node_type as string | undefined, limit: args.limit as number | undefined,
      includeAllocated: args.include_allocated as boolean | undefined,
    });
    case 'foundation_inspect': return foundation.inspect(stringArg('snapshot_id'), args.sections as string[]);
    case 'foundation_read_notes': {
      if (Object.keys(args).some(key => key !== 'snapshot_id')) throw new Error('Invalid notes read options');
      return foundation.notes(stringArg('snapshot_id'));
    }
    case 'foundation_derive_notes': {
      if (Object.keys(args).some(key => !['snapshot_id', 'notes', 'trial'].includes(key)) || typeof args.notes !== 'string') throw new Error('Invalid notes change options');
      return snapshotMetadata(await foundation.deriveNotes(stringArg('snapshot_id'), args.notes, trialArg()));
    }
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
    case 'foundation_derive_gem': return snapshotMetadata(await foundation.deriveGem(stringArg('snapshot_id'), args.group_index as number, args.gem_index as number, args.changes as { level?: number; quality?: number; enabled?: boolean }, trialArg()));
    case 'foundation_replace_support': {
      if (Object.keys(args).some(key => !['snapshot_id', 'group_index', 'gem_index', 'replacement', 'trial'].includes(key))) throw new Error('Invalid support replacement options');
      return snapshotMetadata(await foundation.deriveSupportReplacement(stringArg('snapshot_id'), args.group_index as number, args.gem_index as number, args.replacement as { gemName: string; level?: number; quality?: number }, trialArg()));
    }
    case 'foundation_derive_gem_setup': {
      if (Object.keys(args).some(key => !['snapshot_id', 'group_index', 'gems', 'trial'].includes(key))) throw new Error('Invalid gem setup options');
      return snapshotMetadata(await foundation.deriveGemSetup(stringArg('snapshot_id'), args.group_index as number, args.gems as Parameters<BuildFoundation['deriveGemSetup']>[2], trialArg()));
    }
    case 'foundation_derive_gem_list': return snapshotMetadata(await foundation.deriveGemList(stringArg('snapshot_id'), args.group_index as number, args.operation as Parameters<BuildFoundation['deriveGemList']>[2], trialArg()));
    case 'foundation_derive_skill_group': return snapshotMetadata(await foundation.deriveSkillGroup(stringArg('snapshot_id'), args.group as Parameters<BuildFoundation['deriveSkillGroup']>[1], args.gems as Parameters<BuildFoundation['deriveSkillGroup']>[2], trialArg()));
    case 'foundation_derive_skill_group_enabled': return snapshotMetadata(await foundation.deriveSkillGroupEnabled(stringArg('snapshot_id'), args.group_index as number, args.enabled as boolean, trialArg()));
    case 'foundation_remove_skill_group': return snapshotMetadata(await foundation.deriveRemoveSkillGroup(stringArg('snapshot_id'), args.group_index as number, args.replacement_main_group as number | undefined, trialArg(), args.replacement_calcs_group as number | undefined));
    case 'foundation_derive_flask_active': return snapshotMetadata(await foundation.deriveFlaskActive(stringArg('snapshot_id'), args.flask_index as number, args.active as boolean, trialArg()));
    case 'foundation_item_sets': return foundation.itemSets(stringArg('snapshot_id'));
    case 'foundation_derive_item_set': return snapshotMetadata(await foundation.deriveItemSet(stringArg('snapshot_id'), args.item_set_id as number, trialArg()));
    case 'foundation_specs': return foundation.specs(stringArg('snapshot_id'));
    case 'foundation_derive_spec': return snapshotMetadata(await foundation.deriveSpec(stringArg('snapshot_id'), args.spec_index as number, trialArg()));
    case 'foundation_create_spec': {
      if (Object.keys(args).some(key => !['snapshot_id', 'trial', 'title', 'copy_from', 'activate'].includes(key))) throw new Error('Invalid passive spec creation option');
      return snapshotMetadata(await foundation.deriveCreateSpec(stringArg('snapshot_id'), { ...(args.title === undefined ? {} : { title: args.title as string }), ...(args.copy_from === undefined ? {} : { copyFrom: args.copy_from as number }), ...(args.activate === undefined ? {} : { activate: args.activate as boolean }) }, trialArg()));
    }
    case 'foundation_rename_spec': return snapshotMetadata(await foundation.deriveRenameSpec(stringArg('snapshot_id'), args.spec_index as number, stringArg('title'), trialArg()));
    case 'foundation_delete_spec': {
      if (Object.keys(args).some(key => !['snapshot_id', 'trial', 'spec_index', 'replacement_spec'].includes(key))) throw new Error('Invalid passive spec deletion option');
      return snapshotMetadata(await foundation.deriveDeleteSpec(stringArg('snapshot_id'), args.spec_index as number, args.replacement_spec as number | undefined, trialArg()));
    }
    case 'foundation_derive_level': {
      const id = stringArg('snapshot_id');
      if (typeof args.level !== 'number' || !Number.isInteger(args.level) || args.level < 1 || args.level > 100) throw new Error('level must be an integer between 1 and 100');
      return snapshotMetadata(await foundation.deriveLevel(id, args.level, trialArg()));
    }
    case 'foundation_export_build': return { xml: await foundation.exportBuild(stringArg('snapshot_id')) };
    default: throw new Error(`Unknown foundation tool: ${name}`);
  }
}
