/** Mock LLM adapter for tests and eval. */

import type { LLMProviderConfig } from "../config/llm.js";
import { parseLLMProviderConfig } from "../config/llm.js";
import { BaseLLMAdapter } from "../llm/adapters/base.js";
import {
  createLLMResponse,
  createLLMStreamChunk,
  emptyTokenUsage,
  type LLMResponse,
  type LLMStreamChunk,
} from "../llm/response.js";

export interface MockStreamChunk {
  content?: string | null;
  reasoning?: string | null;
  toolCalls?: Array<Record<string, unknown>>;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  finishReason?: string;
  delayMs?: number;
}

export interface MockLLMResponse {
  content?: string | null;
  reasoning?: string | null;
  toolCalls?: Array<Record<string, unknown>>;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  finishReason?: string;
  /** When set, chatStream yields these chunks instead of synthesizing one blob. */
  streamChunks?: MockStreamChunk[];
}

export class MockLLMAdapter extends BaseLLMAdapter {
  responses: MockLLMResponse[];
  private index = 0;
  calls: Array<Array<Record<string, unknown>>> = [];

  constructor(
    configOrResponses?: LLMProviderConfig | MockLLMResponse[],
    responses: MockLLMResponse[] = [{ content: "mock response" }],
  ) {
    const isConfig =
      configOrResponses != null &&
      !Array.isArray(configOrResponses) &&
      typeof configOrResponses === "object" &&
      "provider" in configOrResponses;
    const config = isConfig
      ? (configOrResponses as LLMProviderConfig)
      : parseLLMProviderConfig({ provider: "openai", model: "mock", api_key: "mock-key" });
    super(config);
    const scripted = isConfig
      ? responses
      : ((configOrResponses as MockLLMResponse[] | undefined) ?? responses);
    this.responses = scripted.length ? scripted : [{ content: "mock response" }];
  }

  private next(): MockLLMResponse {
    if (this.index >= this.responses.length) {
      return this.responses[this.responses.length - 1]!;
    }
    return this.responses[this.index++]!;
  }

  async chat(
    messages: Array<Record<string, unknown>>,
    _options?: {
      tools?: Array<Record<string, unknown>> | null;
      [key: string]: unknown;
    },
  ): Promise<LLMResponse> {
    this.calls.push(messages);
    const scripted = this.next();
    const usage = scripted.usage
      ? {
          promptTokens: scripted.usage.promptTokens ?? 0,
          completionTokens: scripted.usage.completionTokens ?? 0,
          totalTokens:
            scripted.usage.totalTokens ??
            (scripted.usage.promptTokens ?? 0) + (scripted.usage.completionTokens ?? 0),
          cachedTokens: 0,
        }
      : emptyTokenUsage();
    return createLLMResponse({
      content: scripted.content ?? null,
      reasoning: scripted.reasoning ?? null,
      toolCalls: (scripted.toolCalls ?? []).map((tc, i) => ({
        id: String(tc.id ?? `call_${i}`),
        toolName: String(tc.name ?? tc.toolName ?? tc.tool_name ?? "tool"),
        toolInput:
          (tc.arguments as Record<string, unknown>) ??
          (tc.toolInput as Record<string, unknown>) ??
          (tc.tool_input as Record<string, unknown>) ??
          {},
      })),
      usage,
      finishReason: scripted.finishReason ?? (scripted.toolCalls?.length ? "tool_calls" : "stop"),
    });
  }

  async *chatStream(
    messages: Array<Record<string, unknown>>,
    _options?: {
      tools?: Array<Record<string, unknown>> | null;
      [key: string]: unknown;
    },
  ): AsyncIterable<LLMStreamChunk> {
    this.calls.push(messages);
    const scripted = this.next();
    if (scripted.streamChunks?.length) {
      for (const chunk of scripted.streamChunks) {
        if (chunk.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, chunk.delayMs));
        }
        yield createLLMStreamChunk({
          content: chunk.content ?? null,
          reasoning: chunk.reasoning ?? null,
          toolCalls: chunk.toolCalls ?? [],
          usage: chunk.usage
            ? {
                promptTokens: chunk.usage.promptTokens ?? 0,
                completionTokens: chunk.usage.completionTokens ?? 0,
                totalTokens:
                  chunk.usage.totalTokens ??
                  (chunk.usage.promptTokens ?? 0) + (chunk.usage.completionTokens ?? 0),
                cachedTokens: 0,
              }
            : null,
          finishReason: chunk.finishReason ?? null,
        });
      }
      return;
    }

    const usage = scripted.usage
      ? {
          promptTokens: scripted.usage.promptTokens ?? 0,
          completionTokens: scripted.usage.completionTokens ?? 0,
          totalTokens:
            scripted.usage.totalTokens ??
            (scripted.usage.promptTokens ?? 0) + (scripted.usage.completionTokens ?? 0),
          cachedTokens: 0,
        }
      : emptyTokenUsage();
    const finishReason =
      scripted.finishReason ?? (scripted.toolCalls?.length ? "tool_calls" : "stop");

    if (scripted.reasoning) {
      yield createLLMStreamChunk({ reasoning: scripted.reasoning });
    }
    if (scripted.content) {
      yield createLLMStreamChunk({ content: scripted.content });
    }
    if (scripted.toolCalls?.length) {
      yield createLLMStreamChunk({
        toolCalls: scripted.toolCalls.map((tc, i) => ({
          index: i,
          id: String(tc.id ?? `call_${i}`),
          name: String(tc.name ?? tc.toolName ?? tc.tool_name ?? "tool"),
          arguments: JSON.stringify(
            (tc.arguments as Record<string, unknown>) ??
              (tc.toolInput as Record<string, unknown>) ??
              (tc.tool_input as Record<string, unknown>) ??
              {},
          ),
        })),
        usage,
        finishReason,
      });
      return;
    }
    yield createLLMStreamChunk({ usage, finishReason });
  }
}
