/** Runtime Context Summarization (RCS) configuration. */

import { z } from "zod";
import { DEFAULT_CONTEXT_UPDATES_PARAM_DESC, DEFAULT_RCS_SYSTEM_BLOCK } from "./defaults.js";
import { llmProviderConfigSchema, type LLMProviderConfig } from "./llm.js";

export const serverCompactorConfigSchema = z.object({
  enabled: z.boolean().default(false),
  trigger_token_threshold: z.number().int().default(10000),
  compact_oldest_n_tcs: z.number().int().default(2),
  compactor_llm: llmProviderConfigSchema.nullable().optional(),
  max_tokens_per_summary: z.number().int().min(10).default(100),
  prompt_template: z.string().default(""),
});

export type ServerCompactorConfig = z.infer<typeof serverCompactorConfigSchema>;

export const runtimeContextSummarizerConfigSchema = z.object({
  enabled: z.boolean().default(false),
  tc_tag_format: z.string().default("[TC{n}]"),
  tc_tag_include_tool_signature: z.boolean().default(true),
  context_updates_param_name: z.string().default("_context_updates"),
  context_updates_param_description: z.string().default(""),
  rcs_system_block: z.string().default(""),
  fallback_compactor: serverCompactorConfigSchema.default({}),
});

export type RuntimeContextSummarizerConfig = z.infer<
  typeof runtimeContextSummarizerConfigSchema
>;

export function getRcsSystemBlock(config: RuntimeContextSummarizerConfig): string {
  return config.rcs_system_block || DEFAULT_RCS_SYSTEM_BLOCK;
}

export function getContextUpdatesDescription(config: RuntimeContextSummarizerConfig): string {
  return config.context_updates_param_description || DEFAULT_CONTEXT_UPDATES_PARAM_DESC;
}

export function parseRuntimeContextSummarizerConfig(
  input: unknown,
): RuntimeContextSummarizerConfig {
  return runtimeContextSummarizerConfigSchema.parse(input);
}

export function parseServerCompactorConfig(input: unknown): ServerCompactorConfig {
  return serverCompactorConfigSchema.parse(input);
}

export type { LLMProviderConfig };
