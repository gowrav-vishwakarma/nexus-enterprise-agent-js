/** Cross-session memory configuration models. */

import { z } from "zod";
import { DEFAULT_MEMORY_CURATOR_PROMPT } from "./defaults.js";
import { llmProviderConfigSchema, type LLMProviderConfig } from "./llm.js";

export const memoryStoreConfigSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  inject: z.enum(["always", "on_recall"]).default("always"),
  char_budget: z.number().int().min(0).default(0),
  max_entries: z.number().int().min(1).default(100),
});

export type MemoryStoreConfig = z.infer<typeof memoryStoreConfigSchema>;

export const memoryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  expose_tools: z.boolean().default(true),
  namespace: z.string().default(""),
  stores: z.array(memoryStoreConfigSchema).default([]),
  max_entities: z.number().int().min(1).default(100),
  extract_after_each_turn: z.boolean().default(true),
  extraction_interval: z.number().int().min(0).default(0),
  extract_at_end: z.boolean().default(false),
  inject_into_prompt: z.boolean().default(true),
  curator_llm: llmProviderConfigSchema.nullable().optional(),
  curator_prompt: z.string().default(""),
  curator_agent: z.unknown().nullable().optional(),
  max_conversation_chars: z.number().int().min(200).default(6000),
  provider: z.string().nullable().optional(),
  provider_class: z.string().nullable().optional(),
  provider_config: z.record(z.unknown()).default({}),
  require_approval: z.boolean().default(false),
});

export type MemoryConfig = z.infer<typeof memoryConfigSchema>;

export type MemoryConfigModel = MemoryConfig & {
  extractAtEnd: boolean;
  extractAfterEachTurn: boolean;
  extractionInterval: number;
  curatorAgent: unknown;
  requireApproval: boolean;
  maxEntities: number;
  maxConversationChars: number;
  injectIntoPrompt: boolean;
  exposeTools: boolean;
};

export function asMemoryConfigModel(config: MemoryConfig): MemoryConfigModel {
  return {
    ...config,
    extractAtEnd: config.extract_at_end,
    extractAfterEachTurn: config.extract_after_each_turn,
    extractionInterval: config.extraction_interval,
    curatorAgent: config.curator_agent,
    requireApproval: config.require_approval,
    maxEntities: config.max_entities,
    maxConversationChars: config.max_conversation_chars,
    injectIntoPrompt: config.inject_into_prompt,
    exposeTools: config.expose_tools,
  };
}

export function getCuratorPrompt(config: MemoryConfig): string {
  return config.curator_prompt || DEFAULT_MEMORY_CURATOR_PROMPT;
}

export function parseMemoryConfig(input: unknown): MemoryConfigModel {
  return asMemoryConfigModel(memoryConfigSchema.parse(input));
}

export function defaultMemoryConfig(): MemoryConfigModel {
  return asMemoryConfigModel(memoryConfigSchema.parse({}));
}

export type { LLMProviderConfig };
