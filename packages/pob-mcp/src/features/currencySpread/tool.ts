import type { EconomySource } from '../../ports/economySource.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

type QuoteSide = { value: number; pay_currency_id: number; get_currency_id: number; sample_time_utc?: string; listing_count?: number; count?: number; includes_secondary?: boolean };
type Quote = { name: string; sellChaos: number; buyChaos: number; pay: QuoteSide | null; receive: QuoteSide | null };

export function currencySpreadSchema(): FeatureTool['schema'] {
  return { name: 'screen_currency_spreads', description: 'Screen bounded theoretical loops using poe.ninja stash-side aggregate quotes. These are not confirmed instant-buyout offers or guaranteed profits.', inputSchema: { type: 'object', additionalProperties: false, properties: { league: { type: 'string' }, min_gain_percent: { type: 'number', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['league'] } };
}

export function createCurrencySpreadTool(source: EconomySource): FeatureTool {
  return { schema: currencySpreadSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['league', 'min_gain_percent', 'limit'].includes(key)) || typeof args.league !== 'string' || !args.league.trim() || args.league.length > 100 ||
        (args.min_gain_percent !== undefined && (typeof args.min_gain_percent !== 'number' || !Number.isFinite(args.min_gain_percent) || args.min_gain_percent < 0)) ||
        (args.limit !== undefined && (typeof args.limit !== 'number' || !Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 50))) throw new Error('Exact league and valid screening options are required');
    const league = args.league.trim(), threshold = (args.min_gain_percent as number | undefined) ?? 1, limit = (args.limit as number | undefined) ?? 20;
    const snapshot = await source.read({ kind: 'currency-spread', league });
    if (snapshot.source !== 'poe.ninja' || snapshot.query.kind !== 'currency-spread' || snapshot.query.league !== league || typeof snapshot.fetchedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.fetchedAt))) throw new Error('Economy source returned mismatched provenance');
    const { lines, currencyDetails } = snapshot.payload;
    if (!Array.isArray(lines) || !Array.isArray(currencyDetails)) throw new Error('Spread response lacks currency metadata');
    const chaos = currencyDetails.filter((item: any) => item && item.name === 'Chaos Orb' && Number.isSafeInteger(item.id));
    if (chaos.length !== 1) throw new Error('Spread response lacks an unambiguous Chaos Orb ID');
    const lookup = new Map<string, number>();
    for (const item of currencyDetails) {
      if (!item || typeof item.name !== 'string' || !Number.isSafeInteger(item.id) || item.id < 1) continue;
      if (lookup.has(item.name)) throw new Error(`Ambiguous currency metadata: ${item.name}`);
      lookup.set(item.name, item.id);
    }
    const quotes: Quote[] = [], seen = new Set<string>();
    let incomplete = 0;
    for (const line of lines) {
      if (!line || typeof line.currencyTypeName !== 'string' || !line.currencyTypeName.trim()) { incomplete++; continue; }
      const name = line.currencyTypeName;
      if (seen.has(name)) throw new Error(`Ambiguous spread data: ${name}`);
      seen.add(name);
      if (name === 'Chaos Orb') continue;
      const id = lookup.get(name), pay = line.pay as QuoteSide | undefined, receive = line.receive as QuoteSide | undefined;
      const validSide = (side: QuoteSide | undefined, from: number | undefined, to: number | undefined) => !!side && typeof side.value === 'number' && Number.isFinite(side.value) && side.value > 0 &&
        side.pay_currency_id === from && side.get_currency_id === to && (side.sample_time_utc === undefined || (typeof side.sample_time_utc === 'string' && Number.isFinite(Date.parse(side.sample_time_utc)))) &&
        [side.listing_count, side.count].every(value => value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) &&
        (side.includes_secondary === undefined || typeof side.includes_secondary === 'boolean');
      if (id === undefined || !validSide(pay, id, chaos[0].id) || !validSide(receive, chaos[0].id, id) || !Number.isFinite(1 / pay!.value)) { incomplete++; continue; }
      // pay.value is currency given per chaos; receive.value is chaos given per currency.
      quotes.push({ name, sellChaos: 1 / pay!.value, buyChaos: receive!.value, pay: pay!, receive: receive! });
    }
    if (!quotes.length) throw new Error('No usable two-sided spread data; no market conclusion is available');
    quotes.sort((a, b) => a.name.localeCompare(b.name));
    if (quotes.length > 1000) throw new Error('Spread response exceeds the supported 1000-currency screening limit');
    const chaosQuote = { name: 'Chaos Orb', sellChaos: 1, buyChaos: 1, pay: null, receive: null };
    const selected = quotes.slice(0, 20), pairs = [chaosQuote, ...quotes], triples = [chaosQuote, ...selected];
    const loops: Array<{ currencies: string[]; factor: number; theoreticalGainPercent: number; legs: Array<{ from: string; to: string; multiplier: number }> }> = [];
    let totalCandidates = 0;
    const add = (sequence: Quote[]) => {
      let factor = 1;
      for (const quote of sequence) factor *= quote.sellChaos / quote.buyChaos;
      const gain = (factor - 1) * 100;
      if (!Number.isFinite(factor) || !Number.isFinite(gain) || gain < threshold) return;
      totalCandidates++;
      if (loops.length === limit && gain <= loops[loops.length - 1].theoreticalGainPercent) return;
      loops.push({ currencies: [...sequence.map(quote => quote.name), sequence[0].name], factor, theoreticalGainPercent: gain,
        legs: sequence.flatMap((quote, index) => [{ from: quote.name, to: 'Chaos Orb', multiplier: quote.sellChaos }, { from: 'Chaos Orb', to: sequence[(index + 1) % sequence.length].name, multiplier: 1 / sequence[(index + 1) % sequence.length].buyChaos }]).filter(leg => leg.from !== leg.to) });
      loops.sort((a, b) => b.theoreticalGainPercent - a.theoreticalGainPercent);
      if (loops.length > limit) loops.pop();
    };
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) add([pairs[i], pairs[j]]);
    for (let i = 0; i < triples.length; i++) for (let j = i + 1; j < triples.length; j++) for (let k = j + 1; k < triples.length; k++) add([triples[i], triples[j], triples[k]]);
    return { content: [{ type: 'text', text: JSON.stringify({ source: snapshot.source, league, fetchedAt: snapshot.fetchedAt, listingScope: 'stash_aggregate_unverified',
      availableCurrencies: quotes.length, selectedCurrencies: selected.map(quote => quote.name), omittedCurrencies: Math.max(0, quotes.length - selected.length), incompleteLines: incomplete,
      minGainPercent: threshold, totalCandidates, returnedCount: loops.length, quotes, candidates: loops,
      warnings: ['Stash-side aggregate quotes are not verified instant-buyout offers; they may include secondary estimates and stale or unavailable listings.', 'Two-currency loops cover all usable currencies; three-currency loops are limited to the first 20 in alphabetical order. Fees and execution constraints are excluded.'] }) }] };
  } };
}
