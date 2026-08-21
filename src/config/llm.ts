/** LLM provider configuration models. */

import { z } from "zod";

export const providerTypeSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "ollama",
  "litellm",
  "groq",
  "openrouter",
  "bedrock",
  "azure_openai",
  "custom",
]);

export type ProviderType = z.infer<typeof providerTypeSchema>;

export const llmProviderConfigSchema = z.object({
  provider: providerTypeSchema.default("openai"),
  model: z.string().default("gpt-4o"),
  api_key: z.string().default(""),
  base_url: z.string().nullable().optional(),
  api_version: z.string().nullable().optional(),
  context_window_tokens: z.number().int().min(1).default(128000),
  timeout: z.number().int().default(60),
  max_retries: z.number().int().default(3),
  retry_delay: z.number().default(1.0),
  extra_headers: z.record(z.string()).default({}),
  default_params: z.record(z.unknown()).default({}),
  enable_thinking: z.boolean().nullable().optional(),
});

export type LLMProviderConfig = z.infer<typeof llmProviderConfigSchema> & {
  baseUrl?: string | null;
  apiKey?: string;
  apiVersion?: string | null;
  contextWindowTokens?: number;
  maxRetries?: number;
  retryDelay?: number;
  extraHeaders?: Record<string, string>;
  defaultParams?: Record<string, unknown>;
  enableThinking?: boolean | null;
};

function enrichLLMConfig(
  config: z.infer<typeof llmProviderConfigSchema>,
): LLMProviderConfig {
  return {
    ...config,
    baseUrl: config.base_url ?? null,
    apiKey: config.api_key,
    apiVersion: config.api_version ?? null,
    contextWindowTokens: config.context_window_tokens,
    maxRetries: config.max_retries,
    retryDelay: config.retry_delay,
    extraHeaders: config.extra_headers,
    defaultParams: config.default_params,
    enableThinking: config.enable_thinking ?? null,
  };
}

export function parseLLMProviderConfig(input: unknown): LLMProviderConfig {
  return enrichLLMConfig(llmProviderConfigSchema.parse(input));
}

export function getApiKey(config: LLMProviderConfig): string {
  return config.api_key;
}

export function modelDumpSafe(config: LLMProviderConfig): Record<string, unknown> {
  const data = { ...config };
  const key = data.api_key;
  data.api_key = key ? `***${key.slice(-4)}` : "";
  return data;
}
