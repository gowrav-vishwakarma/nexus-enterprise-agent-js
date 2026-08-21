/** Expose Nexus toolsets as an MCP server. */

import type { ToolRegistry } from "../tools/registry.js";

export function toolsetToMcpTools(
  registry: ToolRegistry,
  toolNames: string[],
): Array<Record<string, unknown>> {
  const schemas = registry.schemasFor(toolNames);
  return schemas.map((schema) => ({
    name: schema.name,
    description: schema.description ?? "",
    inputSchema: schema.parameters ?? { type: "object" },
  }));
}

export async function executeMcpToolCall(
  registry: ToolRegistry,
  name: string,
  args: Record<string, unknown>,
  ctx: unknown,
): Promise<string> {
  const result = await registry.executeTool(name, args, ctx as never);
  if (typeof result === "string") return result;
  return JSON.stringify(result);
}
