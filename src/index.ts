/** Nexus Agent Framework — SaaS-ready, context-efficient multi-agent runtime. */

export const __version__ = "0.1.0";

export {
  agentConfigSchema,
  agentGroupConfigSchema,
  agentPersonaConfigSchema,
  parseAgentConfig,
  parseAgentGroupConfig,
  parseAgentPersonaConfig,
  parseTurnConfig,
  type AgentConfig,
  type AgentGroupConfig,
  type AgentPersonaConfig,
  type TurnConfig,
} from "./config/agent.js";

export {
  llmProviderConfigSchema,
  parseLLMProviderConfig,
  type LLMProviderConfig,
} from "./config/llm.js";

export {
  type RuntimeContextSummarizerConfig,
  type ServerCompactorConfig,
} from "./config/rcs.js";

export { type MemoryConfig } from "./config/memory.js";
export { type ContextSummaryConfig } from "./config/context-summary.js";
export { type SessionStorageConfig } from "./config/storage.js";

export {
  DEFAULT_RCS_SYSTEM_BLOCK,
  DEFAULT_COMPACTOR_PROMPT,
  DEFAULT_SYSTEM_TEMPLATE,
  DEFAULT_ENTITY_EXTRACTION_PROMPT,
  DEFAULT_MEMORY_CURATOR_PROMPT,
  DEFAULT_SESSION_MEMORY_CURATOR_PROMPT,
  DEFAULT_CONTEXT_SUMMARY_PROMPT,
} from "./config/defaults.js";

export { AgentRunner, PENDING_SUPERSEDED } from "./runner/agent-runner.js";
export {
  type AgentRunResult,
  type AgentStreamEvent,
} from "./runner/result.js";
export {
  type TurnContext,
  type TurnDecision,
  type RunnerHooks,
  type ToolCallContext,
  type LLMCallContext,
} from "./runner/hooks.js";
export { type RunCheckpoint, checkpointFromSession } from "./runner/checkpoint.js";
export { validateStructuredResult } from "./runner/structured-output.js";

export { RunContext, createRunContext, type RunContextLike } from "./tools/context.js";
export { defineTool, defineToolPlugin, tool, toolPlugin } from "./tools/decorators.js";
export { ToolRegistry } from "./tools/registry.js";

export {
  MemoryCurator,
  createMemoryUpdate,
  type MemoryUpdate,
} from "./memory/curator.js";
export {
  InMemoryCrossSessionMemoryStore,
  createCrossSessionMemoryRecord,
  type CrossSessionMemoryRecord,
  type CrossSessionMemoryStore,
} from "./memory/cross-session-store.js";
export { SQLiteCrossSessionMemoryStore } from "./memory/stores/sqlite.js";
export { PostgreSQLCrossSessionMemoryStore } from "./memory/stores/postgresql.js";
export { createMemoryPlugin, MemoryPlugin } from "./memory/plugin.js";
export { type MemoryProvider } from "./memory/provider.js";
export { BuiltInSemanticMemoryProvider } from "./memory/providers/builtin-semantic.js";

export { type RAGConfig } from "./rag/config.js";
export { type RAGProvider } from "./rag/protocol.js";

export {
  PersistenceFactory,
  type PersistenceBundle,
} from "./persistence/factory.js";
export { type PersistenceResolver } from "./persistence/resolver.js";

export { AgentOrchestrator } from "./multiagent/orchestrator.js";
export { type AgentGroupResult } from "./multiagent/results.js";

export { OrchestrationManifest } from "./orchestration/manifest.js";
export { OrchestrationRuntime } from "./orchestration/runtime.js";

export {
  EventEmitted,
  NexusEventType,
  type NexusEvent,
} from "./events/models.js";
export { NexusEventEmitter } from "./events/emitter.js";

export { SessionManager } from "./session/manager.js";

export { ScopeLevel, scopeKey, scopeKeysFromConfig } from "./scope.js";

export {
  NexusError,
  LLMError,
  ToolError,
  GuardrailError,
  TurnTimeoutError,
  ValidationError,
} from "./errors.js";

export { SkillsPlugin, createSkillsPlugin, SkillsRegistry } from "./skills/index.js";
export { MCPClient, mountMcpTools, toolsetToMcpTools, executeMcpToolCall } from "./mcp/index.js";
export { GuardEngine, PIIRedactionGuard, PromptInjectionGuard } from "./guardrails/index.js";
export { JobScheduler, InMemoryJobStore } from "./jobs/index.js";
export { LocalArtifactStore } from "./artifacts/index.js";
export { ScopedCache } from "./cache/index.js";
export { MockLLMAdapter, EvalRunner, SessionReplayer } from "./eval/index.js";
