import type { EconomySource, EconomySnapshot } from '../../ports/economySource.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

type Rate = { name: string; id: string | null; chaosValue: number };

/** Interpret source-native quotes without inventing a price for a missing currency. */
export function readCurrencyRates(snapshot: EconomySnapshot, league: string): { rates: Rate[]; skipped: number } {
  if (snapshot.source !== 'poe.ninja' || snapshot.query.kind !== 'currency' || snapshot.query.league !== league || typeof snapshot.fetchedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.fetchedAt))) throw new Error('Economy source returned mismatched provenance');
  const payload = snapshot.payload;
  if (!payload || !Array.isArray(payload.lines)) throw new Error('Currency response has an unsupported shape');
  const lines = payload.lines as Array<Record<string, unknown>>;
  const rates: Rate[] = [];
  let skipped = 0;
  if (lines.length && lines[0] && typeof lines[0].currencyTypeName === 'string') {
    for (const line of lines) {
      if (!line || typeof line.currencyTypeName !== 'string' || !line.currencyTypeName.trim() || typeof line.chaosEquivalent !== 'number' || !Number.isFinite(line.chaosEquivalent) || line.chaosEquivalent <= 0) { skipped++; continue; }
      rates.push({ name: line.currencyTypeName, id: typeof line.detailsId === 'string' ? line.detailsId : null, chaosValue: line.chaosEquivalent });
    }
    if (rates.length && !rates.some(rate => rate.name === 'Chaos Orb')) rates.push({ name: 'Chaos Orb', id: 'chaos', chaosValue: 1 });
  } else {
    if (!Array.isArray(payload.items)) throw new Error('Currency response is missing item metadata');
    const items = payload.items as Array<Record<string, unknown>>;
    const byId = new Map<string, Record<string, unknown>>();
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || !item.id || byId.has(item.id)) throw new Error('Currency response has invalid or duplicate item IDs');
      byId.set(item.id, item);
    }
    const seen = new Set<string>();
    const chaosItem = items.find(item => item.name === 'Chaos Orb');
    const chaosLine = chaosItem ? lines.find(line => line?.id === chaosItem.id) : undefined;
    const core = payload.core as { primary?: unknown } | undefined;
    const anchor = chaosLine?.primaryValue ?? (core?.primary === 'chaos' ? 1 : undefined);
    if (typeof anchor !== 'number' || !Number.isFinite(anchor) || anchor <= 0) throw new Error('Currency response has no usable Chaos Orb reference');
    for (const line of lines) {
      if (!line || typeof line.id !== 'string' || !line.id || seen.has(line.id)) throw new Error('Currency response has invalid or duplicate quote IDs');
      seen.add(line.id);
      const item = byId.get(line.id), value = typeof line.primaryValue === 'number' ? line.primaryValue / anchor : NaN;
      if (!item || typeof item.name !== 'string' || !item.name.trim() || !Number.isFinite(value) || value <= 0) { skipped++; continue; }
      rates.push({ name: item.name, id: typeof item.detailsId === 'string' ? item.detailsId : line.id, chaosValue: value });
    }
    if (!rates.length) throw new Error('Currency response contains no usable market rates');
    if (!rates.some(rate => rate.name === 'Chaos Orb') && core?.primary === 'chaos') rates.push({ name: 'Chaos Orb', id: 'chaos', chaosValue: 1 });
  }
  const names = new Set<string>();
  for (const rate of rates) { if (names.has(rate.name)) throw new Error(`Currency response has an ambiguous name: ${rate.name}`); names.add(rate.name); }
  if (!rates.length) throw new Error('Currency response contains no usable rates');
  return { rates, skipped };
}

export function currencyReferenceSchemas(): FeatureTool['schema'][] {
  return [
    { name: 'reference_currency_rates', description: 'Read poe.ninja currency reference values in Chaos Orbs for the exact international league; these are not buyable trade listings.', inputSchema: { type: 'object', additionalProperties: false, properties: { league: { type: 'string' } }, required: ['league'] } },
    { name: 'simulate_reference_currency_chain', description: 'Convert a currency chain using one poe.ninja reference snapshot. This is not an executable trade or arbitrage profit calculation.', inputSchema: { type: 'object', additionalProperties: false, properties: { league: { type: 'string' }, currency_chain: { type: 'array', minItems: 2, maxItems: 50, items: { type: 'string' } }, start_amount: { type: 'number', exclusiveMinimum: 0 } }, required: ['league', 'currency_chain'] } },
  ];
}

export function createCurrencyReferenceTools(source: EconomySource): FeatureTool[] {
  return currencyReferenceSchemas().map(schema => ({ schema, invoke: async args => {
    const allowed = schema.name === 'reference_currency_rates' ? ['league'] : ['league', 'currency_chain', 'start_amount'];
    if (Object.keys(args).some(key => !allowed.includes(key)) || typeof args.league !== 'string' || !args.league.trim() || args.league.length > 100) throw new Error('Exact international league and valid options are required');
    const league = args.league.trim();
    let chain: string[] = [], amount = 1;
    if (schema.name !== 'reference_currency_rates') {
      if (!Array.isArray(args.currency_chain) || args.currency_chain.length < 2 || args.currency_chain.length > 50 || args.currency_chain.some(name => typeof name !== 'string' || !name.trim() || name.length > 200)) throw new Error('currency_chain must contain 2 to 50 exact currency names');
      chain = args.currency_chain as string[];
      if (args.start_amount !== undefined && (typeof args.start_amount !== 'number' || !Number.isFinite(args.start_amount) || args.start_amount <= 0)) throw new Error('start_amount must be a positive finite number');
      amount = (args.start_amount as number | undefined) ?? 1;
    }
    const snapshot = await source.read({ kind: 'currency', league });
    const { rates, skipped } = readCurrencyRates(snapshot, league);
    const common = { source: snapshot.source, league, fetchedAt: snapshot.fetchedAt, skippedLines: skipped,
      warnings: ['Reference values are not executable quotes; spreads, fees, availability and price changes are not included.'] };
    if (schema.name === 'reference_currency_rates') return { content: [{ type: 'text' as const, text: JSON.stringify({ ...common, rates }) }] };
    const map = new Map(rates.map(rate => [rate.name, rate.chaosValue]));
    const steps: Array<{ from: string; to: string; input: number; output: number; fromChaos: number; toChaos: number }> = [];
    let current = amount, missing: string[] = [], reason: string | null = null;
    for (let i = 1; i < chain.length; i++) {
      const from = chain[i - 1], to = chain[i], fromChaos = map.get(from), toChaos = map.get(to);
      if (fromChaos === undefined || toChaos === undefined) { missing = [...new Set([...(fromChaos === undefined ? [from] : []), ...(toChaos === undefined ? [to] : [])])]; reason = 'missing_rate'; break; }
      const output = current * (fromChaos / toChaos);
      if (!Number.isFinite(output) || output <= 0) { reason = 'numeric_overflow_or_underflow'; break; }
      steps.push({ from, to, input: current, output, fromChaos, toChaos }); current = output;
    }
    const complete = reason === null;
    return { content: [{ type: 'text' as const, text: JSON.stringify({ ...common, chain, startAmount: amount, steps, complete, reason, missingRates: missing,
      lastKnown: { currency: chain[steps.length], amount: current }, result: complete ? { currency: chain.at(-1), amount: current } : null }) }] };
  } }));
}
