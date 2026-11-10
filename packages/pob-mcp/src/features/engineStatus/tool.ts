import type { PoBEngineStatusSource } from '../../ports/pobEngineStatus.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

export function engineStatusSchema(): FeatureTool['schema'] {
  return { name: 'inspect_pob_engine', description: 'Start an isolated PoB engine and report its actual version, identity and bridge actions without loading a build. Bridge actions are not MCP tools.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } };
}
export function createEngineStatusTool(source: PoBEngineStatusSource): FeatureTool {
  return { schema: engineStatusSchema(), invoke: async args => {
    if (Object.keys(args).length) throw new Error('No engine status options are supported');
    const { identity, capabilities } = await source.inspect();
    if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities) || (capabilities.actions !== undefined && (!Array.isArray(capabilities.actions) || capabilities.actions.some(action => typeof action !== 'string' || !action)))) throw new Error('PoB returned invalid capability data');
    const actions = capabilities.actions ?? null;
    const identityUnknown = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'].filter(key => !identity[key as keyof typeof identity]);
    return { content: [{ type: 'text', text: JSON.stringify({ identity, identityUnknown, bridge: { mode: typeof capabilities.mode === 'string' ? capabilities.mode : null, adapter: typeof capabilities.adapter === 'string' ? capabilities.adapter : null, actions, reported: capabilities.capabilitiesReported !== false && actions !== null },
      warnings: ['Bridge actions are internal adapter operations, not advertised MCP tools or proof that every game mechanic is supported.', 'This checks a disposable process at the time of the request; it does not check market access, installed clients or later source changes.', 'Fingerprints do not cover external dependencies, wrapper interpreters or transient changes between checks.', ...(identityUnknown.length ? ['Some engine identities are unknown; compatibility cannot be established.'] : [])] }) }] };
  } };
}
