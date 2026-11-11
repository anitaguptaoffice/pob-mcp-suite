import type { ToolSchema } from '../../server/toolSchema.js';

export function comparableQuerySchema(name: string, description: string): ToolSchema {
  return { name, description, inputSchema: { type: 'object', additionalProperties: false, properties: {
    league: { type: 'string', description: 'Exact international league name.' },
    base_type: { type: 'string', description: 'Exact item base type, e.g. Hubris Circlet.' },
    stat_groups: { type: 'array', description: 'Explicit official trade stat requirements; use count/or for alternative sources and separate groups for separate requirements.', items: { type: 'object', additionalProperties: false, properties: {
      type: { type: 'string', enum: ['and', 'or', 'count'] },
      filters: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { stat_id: { type: 'string' }, min: { type: 'number' }, max: { type: 'number' } }, required: ['stat_id'] } },
      min: { type: 'number' }, max: { type: 'number' },
    }, required: ['type', 'filters'] } },
    limit: { type: 'number', description: 'Maximum listings to sample, 1–10 (default 10).' },
  }, required: ['league', 'base_type', 'stat_groups'] } };
}
