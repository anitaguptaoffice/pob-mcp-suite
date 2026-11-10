import { JobStore, type JobRecord } from './jobStore.js';
import { validateEvaluationOptions, type EvaluationOptions } from './buildFoundation.js';

export interface EvaluationInput { snapshotId: string; fields: string[]; options?: EvaluationOptions }

/** One bounded runner; cancellation is cooperative between complete items. */
export class JobRunner {
  private readonly active = new Map<string, Promise<void>>();
  private closing = false;
  private reservations = 0;
  private readonly submissions = new Set<Promise<JobRecord>>();
  constructor(private readonly store: JobStore, private readonly evaluate: (input: EvaluationInput) => Promise<unknown>, private readonly maxJobs = 2) {}

  async submit(inputs: EvaluationInput[]): Promise<JobRecord> {
    if (this.closing) throw new Error('Job runner is closing');
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100) throw new Error('Provide 1 to 100 evaluation items');
    for (const input of inputs) {
      if (!input || !/^[a-f0-9]{64}$/.test(input.snapshotId) || !Array.isArray(input.fields) || input.fields.length < 1 || input.fields.length > 100 || input.fields.some(field => typeof field !== 'string' || !field.trim())) throw new Error('Invalid evaluation item');
      if (input.options !== undefined) validateEvaluationOptions(input.options);
    }
    if (this.reservations >= this.maxJobs) throw new Error('Job runner is full');
    const frozenInputs = structuredClone(inputs);
    this.reservations++;
    const submission = this.createAndStart(frozenInputs);
    this.submissions.add(submission);
    try { return await submission; }
    finally { this.submissions.delete(submission); }
  }

  private async createAndStart(inputs: EvaluationInput[]): Promise<JobRecord> {
    try {
      const job = await this.store.create(inputs.length, inputs);
      if (this.closing) { const cancelled = await this.store.requestCancel(job.id); this.reservations--; return cancelled; }
      const execution = this.run(job.id, inputs).catch(error => { console.error('[Job Runner]', error); });
      this.active.set(job.id, execution);
      void execution.finally(() => { this.active.delete(job.id); this.reservations--; });
      return job;
    } catch (error) { this.reservations--; throw error; }
  }

  private async run(id: string, inputs: EvaluationInput[]): Promise<void> {
    try {
      if ((await this.store.get(id)).status !== 'queued') return;
      try { await this.store.start(id); }
      catch (error) { if ((await this.store.get(id)).status === 'cancelled') return; throw error; }
      for (let index = 0; index < inputs.length; index++) {
        const started = await this.store.startItem(id, index);
        if (started.status === 'cancel_requested') break;
        try {
          const result = await this.evaluate(inputs[index]);
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
