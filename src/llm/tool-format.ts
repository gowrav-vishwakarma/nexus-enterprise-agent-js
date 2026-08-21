import type { ToolCallRequest } from "./response.js";

export function formatOpenaiTools(tools: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const tool of tools) {
    if (tool.type === "function" && tool.function) {
      result.push(tool);
    } else {
      result.push({ type: "function", function: tool });
    }
  }
  return result;
}

export function toolCallsToOpenaiMessages(toolCalls: ToolCallRequest[]): Array<Record<string, unknown>> {
  return toolCalls.map((tc) => ({
    id: tc.id,
    type: "function",
    function: {
      name: tc.toolName,
      arguments: JSON.stringify(tc.toolInput ?? {}),
    },
  }));
}
