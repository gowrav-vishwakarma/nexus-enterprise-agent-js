/** Agent configuration models. */

import { z } from "zod";
import { DEFAULT_SYSTEM_TEMPLATE } from "./defaults.js";
import { llmProviderConfigSchema, parseLLMProviderConfig } from "./llm.js";
import { runtimeContextSummarizerConfigSchema } from "./rcs.js";
import { memoryConfigSchema } from "./memory.js";
import { contextSummaryConfigSchema } from "./context-summary.js";
import { sessionStorageConfigSchema } from "./storage.js";

export const agentPersonaConfigSchema = z.object({
  role: z.string(),
  goal: z.string(),
  backstory: z.string().nullable().optional(),
  system_prompt: z.string().nullable().optional(),
  system_prompt_template: z.string().default(DEFAULT_SYSTEM_TEMPLATE),
  prompt_args: z.record(z.unknown()).default({}),
});

export type AgentPersonaConfig = z.infer<typeof agentPersonaConfigSchema>;

export const turnConfigSchema = z.object({
  max_turns: z.number().int().min(1).default(10),
  max_tool_calls_per_turn: z.number().int().min(0).default(5),
  stop_on_empty_tool_calls: z.boolean().default(true),
  stop_sequences: z.array(z.string()).default([]),
  stop_on_result_type: z.boolean().default(true),
  human_in_loop_after_turns: z.number().int().min(1).nullable().optional(),
  turn_timeout_seconds: z.number().int().min(1).default(300),
});

export type TurnConfig = z.infer<typeof turnConfigSchema> & {
  maxTurns?: number;
  maxToolCallsPerTurn?: number;
  stopOnEmptyToolCalls?: boolean;
  stopOnResultType?: boolean;
  humanInLoopAfterTurns?: number | null;
  turnTimeoutSeconds?: number;
};

export const agentConfigSchema = z.lazy(() =>
  z.object({
    name: z.string(),
    llm: llmProviderConfigSchema,
    persona: agentPersonaConfigSchema.default({
      role: "Assistant",
      goal: "Help the user",
    }),
    turns: turnConfigSchema.default({}),
    rcs: runtimeContextSummarizerConfigSchema.default({}),
    memory: memoryConfigSchema.default({}),
    context_summary: contextSummaryConfigSchema.default({}),
    storage: sessionStorageConfigSchema.nullable().optional(),
    tool_plugins: z.array(z.string()).default([]),
    toolset: z.union([z.string(), z.array(z.string())]).nullable().optional(),
    skills: z.record(z.unknown()).default({}),
    rag: z.record(z.unknown()).nullable().optional(),
    result_type: z.string().nullable().optional(),
    trace_enabled: z.boolean().default(false),
    trace_sink: z.enum(["stdout", "otel"]).default("stdout"),
    stream_output: z.boolean().default(false),
    parallel_tool_calls: z.boolean().default(false),
    structured_output_max_retries: z.number().int().min(0).default(2),
    metadata: z.record(z.unknown()).default({}),
  }),
);

export interface AgentConfig {
  name: string;
  llm: z.infer<typeof llmProviderConfigSchema>;
  persona: AgentPersonaConfig;
  turns: TurnConfig;
  rcs: z.infer<typeof runtimeContextSummarizerConfigSchema>;
  memory: z.infer<typeof memoryConfigSchema>;
  context_summary: z.infer<typeof contextSummaryConfigSchema>;
  storage?: z.infer<typeof sessionStorageConfigSchema> | null;
  tool_plugins: string[];
  toolset?: string | string[] | null;
  skills: Record<string, unknown>;
  rag?: Record<string, unknown> | null;
  result_type?: unknown;
  resultType?: unknown;
  trace_enabled: boolean;
  traceEnabled?: boolean;
  streamOutput?: boolean;
  structuredOutputMaxRetries?: number;
  trace_sink: "stdout" | "otel";
  stream_output: boolean;
  parallel_tool_calls: boolean;
  structured_output_max_retries: number;
  metadata: Record<string, unknown>;
}

export const agentGroupConfigSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    name: z.string(),
    description: z.string().nullable().optional(),
    pattern: z.enum(["supervisor", "pipeline", "parallel"]).default("supervisor"),
    members: z.array(memberConfigSchema).default([]),
    max_turns: z.number().int().min(1).default(20),
    aggregation_strategy: z
      .enum(["concat", "first_complete", "vote", "supervisor"])
      .default("supervisor"),
    session_id_prefix: z.string().default(""),
    supervisor: z.string().nullable().optional(),
    persist_members: z.boolean().default(false),
    context_sharing: z.enum(["isolated", "inherit", "shared"]).default("inherit"),
    rcs: runtimeContextSummarizerConfigSchema.default({}),
    stream_output: z.boolean().default(false),
  }),
);

export interface AgentGroupConfig {
  name: string;
  description?: string | null;
  pattern: "supervisor" | "pipeline" | "parallel";
  members: MemberConfig[];
  max_turns: number;
  aggregation_strategy: "concat" | "first_complete" | "vote" | "supervisor";
  session_id_prefix: string;
  supervisor?: string | null;
  persist_members: boolean;
  context_sharing: "isolated" | "inherit" | "shared";
  rcs: z.infer<typeof runtimeContextSummarizerConfigSchema>;
  stream_output: boolean;
}

export type MemberConfig = AgentConfig | AgentGroupConfig;

export const memberConfigSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([agentConfigSchema, agentGroupConfigSchema]),
);

export function parseAgentConfig(input: unknown): AgentConfig {
  const parsed = agentConfigSchema.parse(input) as AgentConfig;
  return { ...parsed, llm: parseLLMProviderConfig(parsed.llm) };
}

export function parseAgentGroupConfig(input: unknown): AgentGroupConfig {
  return agentGroupConfigSchema.parse(input);
}

export function parseAgentPersonaConfig(input: unknown): AgentPersonaConfig {
  return agentPersonaConfigSchema.parse(input);
}

export function parseTurnConfig(input: unknown): TurnConfig {
  return turnConfigSchema.parse(input);
}

/** Defaults plus camelCase aliases used by AgentRunner. */
export function defaultTurnConfig(): TurnConfig & {
  maxTurns: number;
  maxToolCallsPerTurn: number;
  stopOnEmptyToolCalls: boolean;
  stopOnResultType: boolean;
  humanInLoopAfterTurns: number | null | undefined;
  turnTimeoutSeconds: number;
} {
  const parsed = parseTurnConfig({});
  return {
    ...parsed,
    maxTurns: parsed.max_turns,
    maxToolCallsPerTurn: parsed.max_tool_calls_per_turn,
    stopOnEmptyToolCalls: parsed.stop_on_empty_tool_calls,
    stopOnResultType: parsed.stop_on_result_type,
    humanInLoopAfterTurns: parsed.human_in_loop_after_turns ?? null,
    turnTimeoutSeconds: parsed.turn_timeout_seconds,
  };
}
