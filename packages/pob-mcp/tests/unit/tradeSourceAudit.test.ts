import { describe, expect, it } from '@jest/globals';
import { auditStatSourceCoverage } from '../../src/services/tradeSourceAudit.js';
import type { TradeApiClient } from '../../src/services/tradeClient.js';

const client = { getStats: async () => ({ result: [{ entries: [
  { id: 'explicit.life', text: '+# Life', type: 'explicit' },
  { id: 'fractured.life', text: '+# Life', type: 'fractured' },
  { id: 'crafted.life', text: '+# Life', type: 'crafted' },
] }] }) } as unknown as Pick<TradeApiClient, 'getStats'>;

describe('trade stat source audit', () => {
  it('reports missing alternatives for fractured and crafted filters as well as explicit ones', async () => {
    for (const source of ['explicit', 'fractured', 'crafted']) {
      const warnings = await auditStatSourceCoverage(client, [{ type: 'and', filters: [{ id: `${source}.life` }] }]);
      const alternatives = ['explicit', 'fractured', 'crafted'].filter(other => other !== source).sort();
      expect(warnings.join(' ')).toContain(alternatives.join(', '));
    }
  });

  it('does not report missing sources when all alternatives are in the same group', async () => {
    const warnings = await auditStatSourceCoverage(client, [{ type: 'count', value: { min: 1 }, filters: [
      { id: 'explicit.life' }, { id: 'fractured.life' }, { id: 'crafted.life' },
    ] }]);
    expect(warnings).toEqual([]);
  });
  it('distinguishes excluded and weighted sources from required alternatives', async () => {
    const excluded = (await auditStatSourceCoverage(client, [{ type: 'not', filters: [{ id: 'explicit.life' }] }])).join(' ');
    expect(excluded).toContain('excludes selected sources only');
    expect(excluded).not.toContain('count/or');
    const weighted = (await auditStatSourceCoverage(client, [{ type: 'weight', filters: [{ id: 'explicit.life', value: { weight: 1 } }] }])).join(' ');
    expect(weighted).toContain('weights selected sources only');
    expect(weighted).not.toContain('count/or');
  });
});
