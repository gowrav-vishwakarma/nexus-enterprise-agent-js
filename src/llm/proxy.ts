import type { LLMProviderConfig } from "../config/llm.js";
import { VercelAdapter } from "./adapters/vercel.js";
import type { LLMAdapter } from "./adapters/base.js";
import type { LLMResponse, LLMStreamChunk } from "./response.js";

export class LLMProxy {
  private readonly adapter: LLMAdapter;

  constructor(config: LLMProviderConfig, adapter?: LLMAdapter) {
    this.adapter = adapter ?? this.initAdapter(config);
  }

  private initAdapter(config: LLMProviderConfig): LLMAdapter {
    return new VercelAdapter(config);
  }

  async chat(
    messages: Array<Record<string, unknown>>,
    options: {
      tools?: Array<Record<string, unknown>> | null;
      temperature?: number | null;
      maxTokens?: number | null;
      stopSequences?: string[] | null;
      [key: string]: unknown;
    } = {},
  ): Promise<LLMResponse> {
    return this.adapter.chat(messages, options);
  }

  async *chatStream(
    messages: Array<Record<string, unknown>>,
    options: {
      tools?: Array<Record<string, unknown>> | null;
      temperature?: number | null;
      maxTokens?: number | null;
      stopSequences?: string[] | null;
      [key: string]: unknown;
    } = {},
  ): AsyncIterable<LLMStreamChunk> {
    const stream = this.adapter.chatStream(messages, options);
    for await (const chunk of stream) {
      yield chunk;
    }
  }

  countTokens(
    messages: Array<Record<string, unknown>>,
    tools?: Array<Record<string, unknown>> | null,
  ): number {
    return this.adapter.countTokens(messages, tools);
  }
}
