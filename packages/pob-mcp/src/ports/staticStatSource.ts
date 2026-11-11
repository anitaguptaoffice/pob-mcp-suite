export interface StaticStatMapping {
  pobName: string;
  tradeId: string;
  category: 'pseudo' | 'explicit' | 'implicit' | 'enchant' | 'crafted' | 'fractured';
  aliases: string[];
  description?: string;
}

export interface StaticStatSource {
  catalog(): StaticStatMapping[];
  fuzzySearch(query: string, limit?: number): StaticStatMapping[];
}
