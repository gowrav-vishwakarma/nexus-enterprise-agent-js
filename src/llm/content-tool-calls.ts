import { randomUUID } from "node:crypto";
import type { LLMResponse, ToolCallRequest } from "./response.js";
import { toolCallsToOpenaiMessages } from "./tool-format.js";

const TOOL_CALL_BLOCK = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
const FUNCTION_TAG = /<function=([\w_.]+)>([\s\S]*?)<\/function>/i;
const PARAMETER_TAG = /<parameter=([\w_]+)>([\s\S]*?)<\/parameter>/gi;
const GEMMA_TOOL_CALL =
  /<\|tool_call>\s*call:\s*([\w_]+)\s*(\{[\s\S]*?\})\s*<tool_call\|>/gi;

export const EMPTY_ASSISTANT_PLACEHOLDER = "(prior step omitted)";
export const REASONING_ONLY_PLACEHOLDER = "(no response)";

function coerceParameterValue(raw: string): unknown {
  const paramValue = raw.trim();
  if (paramValue.toLowerCase() === "true") {
    return true;
  }
  if (paramValue.toLowerCase() === "false") {
    return false;
  }
  if (paramValue.toLowerCase() === "null" || paramValue === "") {
    return null;
  }
  try {
    return JSON.parse(paramValue);
  } catch {
    // fall through
  }
  try {
    if (paramValue.includes(".") || paramValue.toLowerCase().includes("e")) {
      return Number.parseFloat(paramValue);
    }
    return Number.parseInt(paramValue, 10);
  } catch {
    return paramValue;
  }
}

function parseOneNemotronBlock(body: string, idSuffix: string): ToolCallRequest | null {
  FUNCTION_TAG.lastIndex = 0;
  const functionMatch = FUNCTION_TAG.exec(body);
  if (!functionMatch) {
    return null;
  }
  const toolName = functionMatch[1]?.trim();
  if (!toolName) {
    return null;
  }
  const functionBody = functionMatch[2] ?? "";
  const args: Record<string, unknown> = {};
  for (const paramMatch of functionBody.matchAll(PARAMETER_TAG)) {
    args[String(paramMatch[1]).trim()] = coerceParameterValue(String(paramMatch[2]));
  }
  return {
    id: `call_${idSuffix}`,
    toolName,
    toolInput: args,
  };
}

export function parseNemotronToolCalls(text: string): [ToolCallRequest[], string] {
  if (!text) {
    return [[], text];
  }
  const toolCalls: ToolCallRequest[] = [];
  let idx = 0;
  for (const match of text.matchAll(TOOL_CALL_BLOCK)) {
    const parsed = parseOneNemotronBlock(match[1] ?? "", `xml_${idx}_${randomUUID().slice(0, 8)}`);
    if (parsed) {
      toolCalls.push(parsed);
    }
    idx += 1;
  }
  const cleaned = text.replace(TOOL_CALL_BLOCK, "").trim();
  return [toolCalls, cleaned];
}

export function parseGemmaToolCalls(text: string): [ToolCallRequest[], string] {
  if (!text) {
    return [[], text];
  }
  const toolCalls: ToolCallRequest[] = [];
  let idx = 0;
  for (const match of text.matchAll(GEMMA_TOOL_CALL)) {
    const toolName = String(match[1]).trim();
    let argsStr = String(match[2]).trim();
    argsStr = argsStr.replace(/<\|"\|>([\s\S]*?)<\|"\|>/g, (_m, inner: string) => JSON.stringify(inner));
    argsStr = argsStr.replace(/<\|"\|>/g, '"');
    argsStr = argsStr.replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3');
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(argsStr);
      args = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
    } catch {
      args = {};
    }
    toolCalls.push({
      id: `call_gemma_${idx}_${randomUUID().slice(0, 8)}`,
      toolName,
      toolInput: args,
    });
    idx += 1;
  }
  const cleaned = text.replace(GEMMA_TOOL_CALL, "").trim();
  return [toolCalls, cleaned];
}

export function extractToolCallsFromText(text?: string | null): [ToolCallRequest[], string | null | undefined] {
  if (!text?.trim()) {
    return [[], text];
  }
  const [nemotronCalls, afterNemotron] = parseNemotronToolCalls(text);
  if (nemotronCalls.length > 0) {
    return [nemotronCalls, afterNemotron || null];
  }
  const [gemmaCalls, afterGemma] = parseGemmaToolCalls(text);
  if (gemmaCalls.length > 0) {
    return [gemmaCalls, afterGemma || null];
  }
  return [[], text];
}

export function promoteContentToolCalls(response: LLMResponse): LLMResponse {
  if (response.toolCalls.length > 0) {
    return response;
  }
  const [contentCalls, cleanedContent] = extractToolCallsFromText(response.content);
  if (contentCalls.length > 0) {
    return {
      ...response,
      toolCalls: contentCalls,
      content: cleanedContent,
    };
  }
  const [reasoningCalls, cleanedReasoning] = extractToolCallsFromText(response.reasoning);
  if (reasoningCalls.length > 0) {
    return {
      ...response,
      toolCalls: reasoningCalls,
      reasoning: cleanedReasoning ?? null,
    };
  }
  return response;
}

function hasAssistantSubstance(content: unknown, toolCalls: unknown): boolean {
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    return true;
  }
  if (content == null) {
    return false;
  }
  if (typeof content === "string") {
    return content.trim().length > 0;
  }
  return Boolean(content);
}

export function sanitizeAssistantLlmMessage(
  msg: Record<string, unknown>,
  options: { placeholder?: string } = {},
): Record<string, unknown> {
  const placeholder = options.placeholder ?? REASONING_ONLY_PLACEHOLDER;
  const out = { ...msg };
  let toolCalls = out.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length === 0) {
    delete out.tool_calls;
    toolCalls = undefined;
  }
  if (out.role !== "assistant") {
    return out;
  }
  if (hasAssistantSubstance(out.content, toolCalls)) {
    if (toolCalls == null && "tool_calls" in out) {
      delete out.tool_calls;
    }
    return out;
  }
  delete out.tool_calls;
  out.content = placeholder;
  return out;
}

export function buildAssistantLlmMessage(options: {
  content?: string | null;
  toolCalls: ToolCallRequest[];
  placeholder?: string;
}): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    role: "assistant",
    content: options.content ?? null,
  };
  if (options.toolCalls.length > 0) {
    msg.tool_calls = toolCallsToOpenaiMessages(options.toolCalls);
  }
  return sanitizeAssistantLlmMessage(msg, { placeholder: options.placeholder });
}
