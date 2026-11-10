export function formatBaseSlug(base: string): string {
  return base.replace(/ /g, '_');
}

/** The base page is not a verified affix table. Never inject scraped page text into a prompt. */
export function parsePoedbText(html: string, base: string): string {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  if (!title || !title.toLowerCase().startsWith(`${base.toLowerCase()} - poedb`)) {
    throw new Error(`poedb page title did not identify the requested base "${base}"`);
  }
  return `已核对底材页面标题：${base}。此页面不是经验证的可制作词缀表，不能据此确认词缀、权重或成功率。`;
}

interface CraftingBaseData {
  base: string;
  poedbUrl: string;
  modText: string;
}

export async function fetchBaseModData(base: string): Promise<CraftingBaseData> {
  const slug = formatBaseSlug(base);
  const url = `https://poedb.tw/us/${encodeURIComponent(slug)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'pob-mcp-server/1.0 (crafting advisor)',
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`poedb network error for "${base}": ${cause}`);
  }

  if (!response.ok) {
    throw new Error(`poedb fetch failed for "${base}": ${response.status}`);
  }

  const html = await response.text();
  const modText = `${parsePoedbText(html, base)}\n英文页面：${url}\n中文页面：https://poedb.tw/cn/${encodeURIComponent(slug)}`;

  return { base, poedbUrl: url, modText };
}
