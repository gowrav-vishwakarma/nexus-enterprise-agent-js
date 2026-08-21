export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
}

export interface ToolCallRequest {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface LLMResponse {
  content?: string | null;
  reasoning?: string | null;
  toolCalls: ToolCallRequest[];
  usage: TokenUsage;
  finishReason: string;
  rawResponse: Record<string, unknown>;
}

export interface LLMStreamChunk {
  content?: string | null;
  reasoning?: string | null;
  toolCalls: Array<Record<string, unknown>>;
  usage?: TokenUsage | null;
  finishReason?: string | null;
}

export function emptyTokenUsage(): TokenUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
  };
}

export function createLLMResponse(partial: Partial<LLMResponse> = {}): LLMResponse {
  return {
    content: partial.content ?? null,
    reasoning: partial.reasoning ?? null,
    toolCalls: partial.toolCalls ?? [],
    usage: partial.usage ?? emptyTokenUsage(),
    finishReason: partial.finishReason ?? "stop",
    rawResponse: partial.rawResponse ?? {},
  };
}

export function createLLMStreamChunk(partial: Partial<LLMStreamChunk> = {}): LLMStreamChunk {
  return {
    content: partial.content ?? null,
    reasoning: partial.reasoning ?? null,
    toolCalls: partial.toolCalls ?? [],
    usage: partial.usage ?? null,
    finishReason: partial.finishReason ?? null,
  };
}
