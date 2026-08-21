/** Context summary configuration (rolling conversation summary). */

import { z } from "zod";
import { DEFAULT_CONTEXT_SUMMARY_PROMPT } from "./defaults.js";
import { llmProviderConfigSchema, type LLMProviderConfig } from "./llm.js";

export const contextSummaryConfigSchema = z.object({
  summarize_on: z.number().min(0).max(1).nullable().optional(),
  summary_prompt: z.string().default(""),
  summary_llm: llmProviderConfigSchema.nullable().optional(),
  turns_to_fold: z.number().int().min(1).default(2),
  max_summary_chars: z.number().int().min(200).default(4000),
  inject_into_prompt: z.boolean().default(true),
});

export type ContextSummaryConfig = z.infer<typeof contextSummaryConfigSchema>;

export function getSummaryPrompt(config: ContextSummaryConfig): string {
  return config.summary_prompt || DEFAULT_CONTEXT_SUMMARY_PROMPT;
}

export function parseContextSummaryConfig(input: unknown): ContextSummaryConfig {
  return contextSummaryConfigSchema.parse(input);
}

export type { LLMProviderConfig };
