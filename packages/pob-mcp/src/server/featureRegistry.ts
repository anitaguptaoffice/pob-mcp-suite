import type { ToolSchema } from './toolSchemas.js';

export interface FeatureResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** A registration owns one public schema and its handler as a single contract. */
export interface FeatureTool {
  schema: ToolSchema;
  invoke: (args: Record<string, unknown>) => FeatureResponse | Promise<FeatureResponse>;
}

export class FeatureRegistry {
  private readonly tools = new Map<string, FeatureTool>();

  constructor(tools: readonly FeatureTool[]) {
    for (const tool of tools) {
      if (!tool.schema.name || this.tools.has(tool.schema.name)) throw new Error(`duplicate or empty feature tool name: ${tool.schema.name}`);
      this.tools.set(tool.schema.name, tool);
    }
  }

  schemas(): ToolSchema[] { return [...this.tools.values()].map(tool => tool.schema); }

  assertNoCollisions(legacy: readonly ToolSchema[]): void {
    for (const schema of legacy) if (this.tools.has(schema.name)) throw new Error(`feature tool collides with legacy tool: ${schema.name}`);
  }

  get(name: string): FeatureTool | undefined { return this.tools.get(name); }
}
