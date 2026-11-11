/** One MCP tool advertisement; nested JSON Schema values pass through unchanged. */
export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, Record<string, unknown>> & { type?: string };
    required?: string[];
    additionalProperties?: boolean | Record<string, unknown>;
  };
}
