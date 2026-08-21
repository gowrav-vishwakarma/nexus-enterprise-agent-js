/** Shared builders for the TypeScript test suite. */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAgentConfig, type AgentConfig } from "../src/config/agent.js";
import { parseLLMProviderConfig, type LLMProviderConfig } from "../src/config/llm.js";
import { MockLLMAdapter, type MockLLMResponse } from "../src/eval/mock-llm.js";
import type { AgentOrchestrator, GroupMember } from "../src/multiagent/orchestrator.js";
import { AgentRunner } from "../src/runner/agent-runner.js";
import type { AgentStreamEvent } from "../src/runner/result.js";
import { SessionManager } from "../src/session/manager.js";
import { createRunContext, type RunContext } from "../src/tools/context.js";
import { ToolRegistry } from "../src/tools/registry.js";

export const ORCHESTRATION_FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "orchestration",
);

export const ORCHESTRATION_PROMPTS = join(ORCHESTRATION_FIXTURES, "prompts.ts");
export const FIXTURE_SEARCH_PLUGIN = `${join(ORCHESTRATION_FIXTURES, "fixture-search-plugin.js")}#FixtureSearchPlugin`;

export async function writeTempYaml(filename: string, contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nexus-orch-"));
  const path = join(dir, filename);
  await writeFile(path, contents, "utf8");
  return path;
}

export function testLlmConfig(overrides: Record<string, unknown> = {}): LLMProviderConfig {
  return parseLLMProviderConfig({
    provider: "openai",
    model: "gpt-4o",
    api_key: "sk-test",
    ...overrides,
  });
}

export function testAgentConfig(overrides: Record<string, unknown> = {}): AgentConfig {
  return parseAgentConfig({
    name: "test-agent",
    llm: testLlmConfig(),
    ...overrides,
  });
}

export function liveLlmConfig(): LLMProviderConfig {
  return parseLLMProviderConfig({
    provider: "litellm",
    model: process.env.NEXUS_LLM_MODEL ?? "openai/qwen",
    api_key: process.env.NEXUS_LLM_API_KEY ?? process.env.LITELLM_API_KEY ?? "",
    base_url: process.env.NEXUS_LLM_BASE_URL ?? process.env.LITELLM_BASE_URL ?? "",
    enable_thinking: process.env.LLM_ENABLE_THINKING === "true",
  });
}

export function hasLiveLlm(): boolean {
  return Boolean(process.env.NEXUS_LLM_API_KEY || process.env.LITELLM_API_KEY);
}

export function makeRunner(options: {
  registry?: ToolRegistry;
  sessionManager?: SessionManager;
  runContext?: RunContext;
  responses?: MockLLMResponse[];
  adapter?: MockLLMAdapter;
  config?: AgentConfig;
  crossSessionMemoryStore?: import("../src/memory/cross-session-store.js").CrossSessionMemoryStore | null;
}): { runner: AgentRunner; manager: SessionManager; adapter: MockLLMAdapter; registry: ToolRegistry } {
  const registry = options.registry ?? new ToolRegistry();
  const manager = options.sessionManager ?? new SessionManager();
  const adapter =
    options.adapter ?? new MockLLMAdapter(testLlmConfig(), options.responses ?? [{ content: "ok" }]);
  const runner = new AgentRunner({
    config: options.config ?? testAgentConfig(),
    toolRegistry: registry,
    storageConfig: manager,
    runContext: options.runContext ?? createRunContext({ sessionId: "sess-1" }),
    llmAdapter: adapter,
    crossSessionMemoryStore: options.crossSessionMemoryStore,
  });
  return { runner, manager, adapter, registry };
}

export async function collectStream(
  runner: AgentRunner,
  userMessage: string,
  extra: { sessionId?: string; initialContext?: Record<string, unknown>; stream?: boolean } = {},
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of runner.runStream(userMessage, { stream: true, ...extra })) {
    events.push(event);
  }
  return events;
}

/** Access private runner fields used by Python grant/revoke tests. */
export function runnerInternals(runner: AgentRunner): {
  resolveToolsets: () => void;
  allowedTools: Set<string> | null;
} {
  return runner as unknown as {
    resolveToolsets: () => void;
    allowedTools: Set<string> | null;
  };
}

/** Access private orchestrator fields used by the Python multi-agent tests. */
export function orchInternals(orch: AgentOrchestrator): {
  members: Map<string, GroupMember>;
  selectSupervisor: () => { name: string | null; error: string | null };
  syncDown: (member: GroupMember, delegatedBy?: string | null) => void;
  syncUp: (member: GroupMember) => void;
} {
  return orch as unknown as {
    members: Map<string, GroupMember>;
    selectSupervisor: () => { name: string | null; error: string | null };
    syncDown: (member: GroupMember, delegatedBy?: string | null) => void;
    syncUp: (member: GroupMember) => void;
  };
}
