import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  generateText,
  jsonSchema,
  streamText,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import type { LLMProviderConfig, ProviderType } from "../../config/llm.js";
import { getApiKey } from "../../config/llm.js";
import { BaseLLMAdapter } from "./base.js";
import {
  createLLMResponse,
  createLLMStreamChunk,
  emptyTokenUsage,
  type LLMResponse,
  type LLMStreamChunk,
  type TokenUsage,
  type ToolCallRequest,
} from "../response.js";
import { formatOpenaiTools } from "../tool-format.js";

type ChatOptions = {
  tools?: Array<Record<string, unknown>> | null;
  temperature?: number | null;
  maxTokens?: number | null;
  stopSequences?: string[] | null;
  [key: string]: unknown;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readReasoning(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return null;
}

function toTokenUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
} | undefined): TokenUsage {
  if (!usage) {
    return emptyTokenUsage();
  }
  const promptTokens = usage.inputTokens ?? 0;
  const completionTokens = usage.outputTokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage.totalTokens ?? promptTokens + completionTokens,
    cachedTokens: usage.cachedInputTokens ?? 0,
  };
}

function convertOpenAiMessages(messages: Array<Record<string, unknown>>): ModelMessage[] {
  const converted: ModelMessage[] = [];
  for (const msg of messages) {
    const role = String(msg.role ?? "user");
    if (role === "system") {
      converted.push({
        role: "system",
        content: String(msg.content ?? ""),
      });
      continue;
    }
    if (role === "user") {
      converted.push({
        role: "user",
        content: String(msg.content ?? ""),
      });
      continue;
    }
    if (role === "assistant") {
      const parts: Array<Record<string, unknown>> = [];
      const content = msg.content;
      if (typeof content === "string" && content.length > 0) {
        parts.push({ type: "text", text: content });
      }
      const toolCalls = msg.tool_calls;
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          const fn = (tc.function ?? {}) as Record<string, unknown>;
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(String(fn.arguments ?? "{}")) as Record<string, unknown>;
          } catch {
            input = {};
          }
          parts.push({
            type: "tool-call",
            toolCallId: String(tc.id ?? ""),
            toolName: String(fn.name ?? ""),
            input,
          });
        }
      }
      converted.push({
        role: "assistant",
        content: parts.length > 0 ? (parts as never) : String(content ?? ""),
      });
      continue;
    }
    if (role === "tool") {
      converted.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: String(msg.tool_call_id ?? msg.toolCallId ?? ""),
            toolName: String(msg.name ?? "tool"),
            output: { type: "text" as const, value: String(msg.content ?? "") },
          },
        ],
      });
    }
  }
  return converted;
}

function convertTools(tools?: Array<Record<string, unknown>> | null): ToolSet | undefined {
  if (!tools?.length) {
    return undefined;
  }
  const formatted = formatOpenaiTools(tools);
  const result: ToolSet = {};
  for (const entry of formatted) {
    const fn = (entry.function ?? entry) as Record<string, unknown>;
    const name = String(fn.name ?? "");
    if (!name) {
      continue;
    }
    const parameters = (fn.parameters as Record<string, unknown>) ?? { type: "object", properties: {} };
    result[name] = tool({
      description: String(fn.description ?? ""),
      inputSchema: jsonSchema(parameters),
    });
  }
  return result;
}

function parseToolCallsFromResult(
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> | undefined,
): ToolCallRequest[] {
  if (!toolCalls?.length) {
    return [];
  }
  return toolCalls.map((tc, index) => ({
    id: tc.toolCallId || `call_${index}`,
    toolName: tc.toolName,
    toolInput:
      typeof tc.input === "object" && tc.input !== null && !Array.isArray(tc.input)
        ? (tc.input as Record<string, unknown>)
        : {},
  }));
}

function resolvedBaseUrl(config: LLMProviderConfig): string | undefined {
  return config.baseUrl ?? config.base_url ?? undefined;
}

function resolveModel(config: LLMProviderConfig): LanguageModel {
  const apiKey = getApiKey(config);
  const model = config.model;
  const provider = config.provider;
  const baseURL = resolvedBaseUrl(config);

  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey })(model);
    case "azure_openai":
      return createOpenAI({
        apiKey,
        baseURL,
        headers: config.extraHeaders,
      })(model);
    case "anthropic":
      return createAnthropic({ apiKey })(model);
    case "gemini":
      return createGoogleGenerativeAI({ apiKey })(model);
    case "groq":
      return createGroq({ apiKey })(model);
    case "bedrock":
      return createAmazonBedrock({
        region: String(config.defaultParams?.region ?? process.env.AWS_REGION ?? "us-east-1"),
      })(model);
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: baseURL ?? "http://localhost:11434/v1",
        apiKey: apiKey || "ollama",
      })(model);
    case "openrouter":
      return createOpenAICompatible({
        name: "openrouter",
        baseURL: baseURL ?? "https://openrouter.ai/api/v1",
        apiKey,
        headers: config.extraHeaders,
      })(model);
    case "litellm":
      if (!baseURL) {
        throw new Error("litellm provider requires baseUrl");
      }
      return createOpenAICompatible({
        name: "litellm",
        baseURL,
        apiKey,
        headers: config.extraHeaders,
      })(model);
    case "custom":
      if (!baseURL) {
        throw new Error("custom provider requires baseUrl");
      }
      return createOpenAICompatible({
        name: "custom",
        baseURL,
        apiKey,
        headers: config.extraHeaders,
      })(model);
    default:
      return resolveModel({ ...config, provider: mapLegacyProvider(provider) });
  }
}

function mapLegacyProvider(provider: ProviderType): ProviderType {
  return provider;
}

function buildCallSettings(config: LLMProviderConfig, options: ChatOptions) {
  const settings: Record<string, unknown> = {
    ...config.defaultParams,
    ...options,
  };
  delete settings.tools;
  delete settings.temperature;
  delete settings.maxTokens;
  delete settings.stopSequences;

  if (options.temperature != null) {
    settings.temperature = options.temperature;
  }
  if (options.maxTokens != null) {
    settings.maxOutputTokens = options.maxTokens;
  } else if (config.defaultParams?.max_tokens != null) {
    settings.maxOutputTokens = config.defaultParams.max_tokens;
  }
  if (options.stopSequences?.length) {
    settings.stopSequences = options.stopSequences;
  }

  if (config.enableThinking != null) {
    const extraBody = { ...(settings.extraBody as Record<string, unknown> | undefined) };
    const chatTemplateKwargs = {
      ...(extraBody.chat_template_kwargs as Record<string, unknown> | undefined),
      enable_thinking: config.enableThinking,
    };
    extraBody.chat_template_kwargs = chatTemplateKwargs;
    settings.providerOptions = {
      ...(settings.providerOptions as Record<string, unknown> | undefined),
      openaiCompatible: extraBody,
    };
  }

  return settings;
}

export class VercelAdapter extends BaseLLMAdapter {
  private readonly model: LanguageModel;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.model = resolveModel(config);
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const maxRetries = this.config.maxRetries ?? 0;
    const retryDelay = this.config.retryDelay ?? 1;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        if (this.config.timeout && this.config.timeout > 0) {
          return await Promise.race([
            fn(),
            new Promise<T>((_, reject) =>
              setTimeout(() => reject(new Error("LLM request timed out")), this.config.timeout! * 1000),
            ),
          ]);
        }
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt >= maxRetries) {
          break;
        }
        await sleep(retryDelay * 1000 * 2 ** attempt);
      }
    }
    throw lastError;
  }

  async chat(
    messages: Array<Record<string, unknown>>,
    options: ChatOptions = {},
  ): Promise<LLMResponse> {
    const modelMessages = convertOpenAiMessages(messages);
    const tools = convertTools(options.tools);
    const settings = buildCallSettings(this.config, options);

    return this.withRetry(async () => {
      const result = await generateText({
        model: this.model,
        messages: modelMessages,
        tools,
        toolChoice: tools ? "auto" : undefined,
        ...settings,
      });

      const reasoning =
        readReasoning(result.reasoningText) ??
        (Array.isArray(result.reasoning)
          ? result.reasoning.map((part) => part.text).join("")
          : null);

      return createLLMResponse({
        content: result.text || null,
        reasoning,
        toolCalls: parseToolCallsFromResult(result.toolCalls),
        usage: toTokenUsage(result.usage),
        finishReason: result.finishReason ?? "stop",
        rawResponse: {},
      });
    });
  }

  async *chatStream(
    messages: Array<Record<string, unknown>>,
    options: ChatOptions = {},
  ): AsyncIterable<LLMStreamChunk> {
    const modelMessages = convertOpenAiMessages(messages);
    const tools = convertTools(options.tools);
    const settings = buildCallSettings(this.config, options);

    const result = streamText({
      model: this.model,
      messages: modelMessages,
      tools,
      toolChoice: tools ? "auto" : undefined,
      ...settings,
    });

    const toolAcc = new Map<number, { id?: string; name: string; arguments: string }>();

    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        yield createLLMStreamChunk({ content: part.text });
      } else if (part.type === "reasoning-delta") {
        yield createLLMStreamChunk({ reasoning: part.text });
      } else if (part.type === "tool-call") {
        const index = toolAcc.size;
        toolAcc.set(index, {
          id: part.toolCallId,
          name: part.toolName,
          arguments: JSON.stringify(part.input ?? {}),
        });
        yield createLLMStreamChunk({
          toolCalls: [
            {
              index,
              id: part.toolCallId,
              function: {
                name: part.toolName,
                arguments: JSON.stringify(part.input ?? {}),
              },
            },
          ],
        });
      } else if (part.type === "tool-input-delta") {
        const index = Math.max(toolAcc.size - 1, 0);
        const current = toolAcc.get(index) ?? { name: "", arguments: "" };
        current.arguments += part.delta;
        toolAcc.set(index, current);
        yield createLLMStreamChunk({
          toolCalls: [
            {
              index,
              id: current.id,
              function: {
                name: current.name,
                arguments: current.arguments,
              },
            },
          ],
        });
      } else if (part.type === "finish") {
        yield createLLMStreamChunk({
          finishReason: part.finishReason,
          usage: toTokenUsage(part.totalUsage),
        });
      }
    }
  }
}

export function createVercelAdapter(config: LLMProviderConfig): VercelAdapter {
  return new VercelAdapter(config);
}
