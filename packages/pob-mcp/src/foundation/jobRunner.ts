import { JobStore, type JobRecord } from './jobStore.js';
import { validateEvaluationOptions, type BuildFoundation, type EvaluationOptions } from './buildFoundation.js';
import { isDeepStrictEqual } from 'node:util';
import { validPassiveMinimums, type PassiveMinimums } from './passiveConstraints.js';

export interface EvaluationInput { snapshotId: string; fields: string[]; options?: EvaluationOptions }
export interface MasteryEvaluationInput { kind: 'mastery'; snapshotId: string; nodeId: number; effectId: number; metric: string; direction: 'higher' | 'lower'; treeVersion: string | null; discoveryIdentity: BuildIdentity; includeCurrent: boolean; selected: boolean | null; totalDiscovered: number; totalMasteries: number }
type BuildIdentity = { engineVersion: string | null; adapterVersion: string | null; dataVersion: string | null; runtimeVersion?: string | null; executableVersion?: string | null };
export interface GemSetupEvaluationInput { kind: 'gem_setup'; snapshotId: string; groupIndex: number; setupName: string; gems: Parameters<BuildFoundation['deriveGemSetup']>[2]; discoveryIdentity: BuildIdentity }
export interface PassiveEvaluationInput { kind: 'passive'; snapshotId: string; nodeId: number; nodeName: string; pathNodes: number[]; metrics: string[]; discoveryIdentity: BuildIdentity; treeVersion: string; excludedNodeIds?: number[]; minimums?: PassiveMinimums }
export interface JewelEvaluationInput { kind: 'jewel'; snapshotId: string; socketNodeId: number; name: string; itemText: string; fields: string[]; discoveryIdentity: BuildIdentity }
type JobInput = EvaluationInput | MasteryEvaluationInput | GemSetupEvaluationInput | PassiveEvaluationInput | JewelEvaluationInput;

/** One bounded runner; cancellation is cooperative between complete items. */
export class JobRunner {
  private readonly active = new Map<string, Promise<void>>();
  private closing = false;
  private reservations = 0;
  private readonly submissions = new Set<Promise<JobRecord>>();
  constructor(private readonly store: JobStore, private readonly evaluate: (input: EvaluationInput) => Promise<unknown>, private readonly maxJobs = 2,
    private readonly evaluateMastery?: (input: MasteryEvaluationInput) => Promise<unknown>, private readonly evaluateGemSetup?: (input: GemSetupEvaluationInput) => Promise<unknown>, private readonly evaluatePassive?: (input: PassiveEvaluationInput) => Promise<unknown>, private readonly evaluateJewel?: (input: JewelEvaluationInput, onDerived: (snapshotId: string) => Promise<void>) => Promise<unknown>) {}

  async submit(inputs: EvaluationInput[]): Promise<JobRecord> {
    if (this.closing) throw new Error('Job runner is closing');
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100) throw new Error('Provide 1 to 100 evaluation items');
    for (const input of inputs) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || 'kind' in input || !/^[a-f0-9]{64}$/.test(input.snapshotId) || !Array.isArray(input.fields) || input.fields.length < 1 || input.fields.length > 100 || input.fields.some(field => typeof field !== 'string' || !field.trim())) throw new Error('Invalid evaluation item');
      if (input.options !== undefined) validateEvaluationOptions(input.options);
    }
    return this.submitValidated(inputs);
  }

  async submitMasteries(inputs: MasteryEvaluationInput[]): Promise<JobRecord> {
    if (this.closing) throw new Error('Job runner is closing');
    if (!this.evaluateMastery || !Array.isArray(inputs) || inputs.length < 1 || inputs.length > 1000) throw new Error('Provide 1 to 1000 mastery evaluations');
    const positive = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
    const validIdentity = (value: unknown): value is BuildIdentity => !!value && typeof value === 'object' && !Array.isArray(value) && ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'].every(key => {
      const field = (value as Record<string, unknown>)[key]; return field === undefined || field === null || typeof field === 'string' && field.length > 0;
    });
    const first = inputs[0];
    if (inputs.some(input => !input || input.kind !== 'mastery' || !/^[a-f0-9]{64}$/.test(input.snapshotId) || !positive(input.nodeId) || !positive(input.effectId) || typeof input.metric !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(input.metric) || !['higher', 'lower'].includes(input.direction) || (input.treeVersion !== null && (typeof input.treeVersion !== 'string' || !input.treeVersion)) || !validIdentity(input.discoveryIdentity) || typeof input.includeCurrent !== 'boolean' || ![true, false, null].includes(input.selected) || (input.selected === true && !input.includeCurrent) || !Number.isSafeInteger(input.totalDiscovered) || input.totalDiscovered < inputs.length || !Number.isSafeInteger(input.totalMasteries) || input.totalMasteries < 1 || input.snapshotId !== first.snapshotId || input.metric !== first.metric || input.direction !== first.direction || input.treeVersion !== first.treeVersion || input.includeCurrent !== first.includeCurrent || input.totalDiscovered !== first.totalDiscovered || input.totalMasteries !== first.totalMasteries || JSON.stringify(input.discoveryIdentity) !== JSON.stringify(first.discoveryIdentity)) || new Set(inputs.map(input => `${input.nodeId}:${input.effectId}`)).size !== inputs.length) throw new Error('Invalid mastery evaluations');
    return this.submitValidated(inputs);
  }

  async submitGemSetups(inputs: GemSetupEvaluationInput[]): Promise<JobRecord> {
    if (this.closing) throw new Error('Job runner is closing');
    if (!this.evaluateGemSetup || !Array.isArray(inputs) || inputs.length < 2 || inputs.length > 5) throw new Error('Provide 2 to 5 gem setups');
    const first = inputs[0], validInt = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= lo && v <= hi;
    const normalize = (name: string) => name.trim().toLowerCase().replace(/ support$/, '');
    const validGem = (gem: GemSetupEvaluationInput['gems'][number]) => gem && typeof gem === 'object' && !Array.isArray(gem) && Object.keys(gem).every(key => ['gemName', 'level', 'quality', 'enabled'].includes(key)) && Object.values(gem).every(value => value !== undefined) && typeof gem.gemName === 'string' && !!gem.gemName.trim() && gem.gemName.length <= 200 && (gem.level === undefined || validInt(gem.level, 1, 40)) && (gem.quality === undefined || validInt(gem.quality, 0, 99)) && (gem.enabled === undefined || typeof gem.enabled === 'boolean');
    if (inputs.some(input => !input || input.kind !== 'gem_setup' || !/^[a-f0-9]{64}$/.test(input.snapshotId) || !validInt(input.groupIndex, 1, 10000) || typeof input.setupName !== 'string' || !input.setupName.trim() || input.setupName.length > 100 || !Array.isArray(input.gems) || input.gems.length < 1 || input.gems.length > 6 || input.gems.some(gem => !validGem(gem)) || new Set(input.gems.map(gem => normalize(gem.gemName))).size !== input.gems.length || !input.discoveryIdentity || typeof input.discoveryIdentity !== 'object' || Array.isArray(input.discoveryIdentity) || input.snapshotId !== first.snapshotId || input.groupIndex !== first.groupIndex || JSON.stringify(input.discoveryIdentity) !== JSON.stringify(first.discoveryIdentity)) || new Set(inputs.map(input => input.setupName.trim().toLowerCase())).size !== inputs.length) throw new Error('Invalid gem setup evaluations');
    return this.submitValidated(inputs);
  }

  async submitPassives(inputs: PassiveEvaluationInput[]): Promise<JobRecord> {
    if (this.closing) throw new Error('Job runner is closing');
    if (!this.evaluatePassive || !Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100) throw new Error('Provide 1 to 100 passive evaluations');
    const first = inputs[0], positive = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
    if (inputs.some(input => (input?.minimums !== undefined && !validPassiveMinimums(input.minimums)) || !isDeepStrictEqual(input?.minimums ?? {}, first?.minimums ?? {}))) throw new Error('Invalid passive minimum constraints');
    if (inputs.some(input => input?.excludedNodeIds !== undefined && (!Array.isArray(input.excludedNodeIds) || input.excludedNodeIds.length > 100 || input.excludedNodeIds.some(node => !positive(node)) || new Set(input.excludedNodeIds).size !== input.excludedNodeIds.length || !Array.isArray(input.pathNodes) || input.pathNodes.some(node => input.excludedNodeIds!.includes(node))) || JSON.stringify(input?.excludedNodeIds ?? []) !== JSON.stringify(first?.excludedNodeIds ?? []))) throw new Error('Invalid passive node exclusions');
    if (inputs.some(input => !input || input.kind !== 'passive' || typeof input.snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(input.snapshotId) || !positive(input.nodeId) || typeof input.nodeName !== 'string' || !input.nodeName.trim() || input.nodeName.length > 200 || !Array.isArray(input.pathNodes) || input.pathNodes.length < 1 || input.pathNodes.length > 100 || input.pathNodes.some(node => !positive(node)) || new Set(input.pathNodes).size !== input.pathNodes.length || input.pathNodes.at(-1) !== input.nodeId || !Array.isArray(input.metrics) || input.metrics.length < 1 || input.metrics.length > 2 || input.metrics.some(metric => typeof metric !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(metric)) || new Set(input.metrics).size !== input.metrics.length || typeof input.treeVersion !== 'string' || !input.treeVersion || !input.discoveryIdentity || typeof input.discoveryIdentity !== 'object' || Array.isArray(input.discoveryIdentity) || input.snapshotId !== first.snapshotId || input.treeVersion !== first.treeVersion || JSON.stringify(input.metrics) !== JSON.stringify(first.metrics) || JSON.stringify(input.discoveryIdentity) !== JSON.stringify(first.discoveryIdentity)) || new Set(inputs.map(input => input.nodeId)).size !== inputs.length) throw new Error('Invalid passive evaluations');
    return this.submitValidated(inputs);
  }

  async submitJewels(inputs: JewelEvaluationInput[]): Promise<JobRecord> {
    if (this.closing) throw new Error('Job runner is closing');
    if (!this.evaluateJewel || !Array.isArray(inputs) || inputs.length < 1 || inputs.length > 10) throw new Error('Provide 1 to 10 jewel evaluations');
    const first = inputs[0];
    const validIdentity = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value) && ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'].every(key => { const field = (value as Record<string, unknown>)[key]; return field === undefined || field === null || typeof field === 'string' && !!field; });
    if (inputs.some(input => !input || input.kind !== 'jewel' || typeof input.snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(input.snapshotId) || !Number.isSafeInteger(input.socketNodeId) || input.socketNodeId < 1 || input.socketNodeId > 2147483647 || typeof input.name !== 'string' || !input.name.trim() || input.name !== input.name.trim() || input.name.length > 100 || typeof input.itemText !== 'string' || !input.itemText.trim() || Buffer.byteLength(input.itemText, 'utf8') > 10240 || !Array.isArray(input.fields) || input.fields.length < 1 || input.fields.length > 20 || input.fields.some(field => typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(field)) || new Set(input.fields).size !== input.fields.length || !validIdentity(input.discoveryIdentity) || input.snapshotId !== first.snapshotId || input.socketNodeId !== first.socketNodeId || !isDeepStrictEqual(input.fields, first.fields) || !isDeepStrictEqual(input.discoveryIdentity, first.discoveryIdentity)) || new Set(inputs.map(input => input.name)).size !== inputs.length) throw new Error('Invalid jewel evaluations');
    return this.submitValidated(inputs);
  }

  private async submitValidated(inputs: JobInput[]): Promise<JobRecord> {
    if (this.reservations >= this.maxJobs) throw new Error('Job runner is full');
    const frozenInputs = structuredClone(inputs);
    this.reservations++;
    const submission = this.createAndStart(frozenInputs);
    this.submissions.add(submission);
    try { return await submission; }
    finally { this.submissions.delete(submission); }
  }

  private async createAndStart(inputs: JobInput[]): Promise<JobRecord> {
    try {
      const job = await this.store.create(inputs.length, inputs);
      if (this.closing) { const cancelled = await this.store.requestCancel(job.id); this.reservations--; return cancelled; }
      const execution = this.run(job.id, inputs).catch(error => { console.error('[Job Runner]', error); });
      this.active.set(job.id, execution);
      void execution.finally(() => { this.active.delete(job.id); this.reservations--; });
      return job;
    } catch (error) { this.reservations--; throw error; }
  }

  private async run(id: string, inputs: JobInput[]): Promise<void> {
    try {
      if ((await this.store.get(id)).status !== 'queued') return;
      try { await this.store.start(id); }
      catch (error) { if ((await this.store.get(id)).status === 'cancelled') return; throw error; }
      for (let index = 0; index < inputs.length; index++) {
        const started = await this.store.startItem(id, index);
        if (started.status === 'cancel_requested') break;
        try {
          const input = inputs[index];
          const result = 'kind' in input && input.kind === 'mastery' ? await this.evaluateMastery!(input) : 'kind' in input && input.kind === 'gem_setup' ? await this.evaluateGemSetup!(input) : 'kind' in input && input.kind === 'passive' ? await this.evaluatePassive!(input) : 'kind' in input && input.kind === 'jewel' ? await this.evaluateJewel!(input, async snapshotId => { await this.store.recordDerivedSnapshot(id, index, snapshotId); }) : await this.evaluate(input as EvaluationInput);
          await this.store.recordItem(id, index, { status: 'completed', result });
        } catch (error) {
          await this.store.recordItem(id, index, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
        }
      }
      await this.store.finish(id);
    } catch (error) {
      const job = await this.store.get(id);
      if (job.status === 'running' || job.status === 'cancel_requested') await this.store.finish(id, error instanceof Error ? error.message : String(error));
      else if (job.status !== 'cancelled') throw error;
    }
  }
  get(id: string): Promise<JobRecord> { return this.store.get(id); }
  cancel(id: string): Promise<JobRecord> { return this.store.requestCancel(id); }
  async close(): Promise<void> {
    this.closing = true;
    await Promise.allSettled([...this.submissions]);
    const cancellations = await Promise.allSettled([...this.active.keys()].map(id => this.store.requestCancel(id)));
    const executions = await Promise.allSettled([...this.active.values()]);
    const failures = [...cancellations, ...executions].filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(failure => failure.reason), 'Job runner shutdown failed');
  }
}
