import type { ItemListing, LeagueData, SearchResult, StatData, TradeQuery } from '../types/tradeTypes.js';

/** Source responses retain their own request and actual retrieval time. */
export interface TradeSourceResult<T, R> {
  source: 'official-trade';
  fetchedAt: string;
  request: R;
  data: T;
}

export interface OfficialTradeSource {
  search(league: string, query: TradeQuery): Promise<TradeSourceResult<SearchResult, { league: string; query: TradeQuery }>>;
  fetchListings(ids: string[], queryId?: string): Promise<TradeSourceResult<{ listings: ItemListing[]; missingIds: string[] }, { ids: string[]; queryId: string | null }>>;
  stats(): Promise<TradeSourceResult<StatData, { kind: 'stats' }>>;
  leagues(): Promise<TradeSourceResult<LeagueData, { kind: 'leagues' }>>;
}
