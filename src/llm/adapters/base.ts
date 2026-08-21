import type { LLMProviderConfig } from "../../config/llm.js";
import type { LLMResponse, LLMStreamChunk } from "../response.js";
import { TokenCounter } from "../token-counter.js";

export interface LLMAdapter {
  readonly config: LLMProviderConfig;

  chat(
    messages: Array<Record<string, unknown>>,
    options?: {
      tools?: Array<Record<string, unknown>> | null;
      temperature?: number | null;
      maxTokens?: number | null;
      stopSequences?: string[] | null;
      [key: string]: unknown;
    },
  ): Promise<LLMResponse>;

  chatStream(
    messages: Array<Record<string, unknown>>,
    options?: {
      tools?: Array<Record<string, unknown>> | null;
      temperature?: number | null;
      maxTokens?: number | null;
      stopSequences?: string[] | null;
      [key: string]: unknown;
    },
  ): AsyncIterable<LLMStreamChunk>;

  countTokens(
    messages: Array<Record<string, unknown>>,
    tools?: Array<Record<string, unknown>> | null,
  ): number;
}

export abstract class BaseLLMAdapter implements LLMAdapter {
  constructor(readonly config: LLMProviderConfig) {}

  abstract chat(
    messages: Array<Record<string, unknown>>,
    options?: {
      tools?: Array<Record<string, unknown>> | null;
      temperature?: number | null;
      maxTokens?: number | null;
      stopSequences?: string[] | null;
      [key: string]: unknown;
    },
  ): Promise<LLMResponse>;

  abstract chatStream(
    messages: Array<Record<string, unknown>>,
    options?: {
      tools?: Array<Record<string, unknown>> | null;
      temperature?: number | null;
      maxTokens?: number | null;
      stopSequences?: string[] | null;
      [key: string]: unknown;
    },
  ): AsyncIterable<LLMStreamChunk>;

  countTokens(
    messages: Array<Record<string, unknown>>,
    tools?: Array<Record<string, unknown>> | null,
  ): number {
    let total = TokenCounter.countMessages(messages, this.config.model);
    if (tools?.length) {
      total += TokenCounter.estimateToolSchemaOverhead(tools, this.config.model);
    }
    return total;
  }
}
