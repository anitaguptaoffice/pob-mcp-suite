// Opt-in live MCP smoke test for crafting advice data sources.
// Usage: npm run build && npm run test:smoke:crafting
import { startMcpServer } from './mcpClient.mjs';

const { child, request, notify } = startMcpServer();

try {
  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'crafting-smoke', version: '1.0' } });
  notify('notifications/initialized', {});
  const listed = await request('tools/list', {});
  if (!listed.result.tools.some((tool) => tool.name === 'suggest_crafting')) throw new Error('suggest_crafting was not advertised with the Lua integration enabled');
  const response = await request('tools/call', { name: 'suggest_crafting', arguments: {
    slot: 'helmet', base: 'Hubris Circlet', desired_mods: ['+# to maximum Energy Shield'], ilvl: 84, budget: 'medium', league: 'Standard',
  } });
  if (response.error || response.result?.isError) throw new Error(`suggest_crafting failed: ${JSON.stringify(response.error ?? response.result)}`);
  const text = response.result?.content?.[0]?.text || '';
  if (!text.includes('=== 制作资料：Hubris Circlet (helmet) ===') || !text.includes('已核对底材页面标题') || !text.includes('不是经验证的可制作词缀表')) {
    throw new Error(`crafting context did not include a verified base-page reference: ${text}`);
  }
  console.log('crafting MCP passed: tool discovery and live PoEDB base-page reference succeeded');
} finally {
  child.kill();
}
