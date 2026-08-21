#!/usr/bin/env npx tsx
/**
 * Annotated single-agent TypeScript API — every parseAgentConfig and AgentRunner
 * parameter explained.
 *
 * This is a reference copy for learning. Copy patterns into your own app.
 */

import {
  AgentRunner,
  InMemoryCrossSessionMemoryStore,
  createRunContext,
  defineTool,
  parseAgentConfig,
  ToolRegistry,
} from "nexus-enterprise-agent";

const echo = defineTool((text: string) => text, {
  name: "echo",
  description: "Echo back the input text",
});

function buildAgentConfig() {
  /** AgentConfig — describes what the agent is. */
  return parseAgentConfig({
    // name (required) — unique id for this agent; used in logs and saved sessions.
    name: "assistant",
    // llm (required) — which large language model (LLM) to call. Transport: Vercel AI SDK.
    llm: {
      provider: "openai", // optional, default: openai
      model: "gpt-4o-mini", // optional, default: gpt-4o
      api_key: process.env.OPENAI_API_KEY ?? "sk-...",
      base_url: null, // optional, default: null — custom endpoint URL
      api_version: null, // optional, default: null
      context_window_tokens: 128000, // optional, default: 128000
      timeout: 60, // optional, default: 60 seconds
      max_retries: 3, // optional, default: 3
      retry_delay: 1.0, // optional, default: 1.0 seconds
      extra_headers: {}, // optional, default: {}
      default_params: {}, // optional, default: {}
      enable_thinking: null, // optional — force thinking on/off for compatible models
    },
    // persona (optional) — how the agent describes itself in the system prompt.
    persona: {
      role: "Helpful assistant", // required in persona block
      goal: "Answer clearly and use tools when useful.",
      backstory: null, // optional, default: null
      system_prompt: null, // optional, default: null — full override
      // system_prompt_template uses the framework default Nunjucks template if omitted
    },
    // turns (optional) — limits on the agent loop.
    turns: {
      max_turns: 10, // optional, default: 10
      max_tool_calls_per_turn: 5, // optional, default: 5 (0 = unlimited)
      stop_on_empty_tool_calls: true, // optional, default: true
      stop_sequences: [], // optional, default: [] — not enforced in the loop yet
      stop_on_result_type: true, // optional, default: true — not enforced in the loop yet
      human_in_loop_after_turns: null, // optional, default: null
      turn_timeout_seconds: 300, // optional, default: 300
    },
    // rcs (optional) — Runtime Context Summarization; compresses long tool outputs.
    rcs: {
      enabled: false, // optional, default: false
      tc_tag_format: "[TC{n}]", // optional, default: "[TC{n}]"
      tc_tag_include_tool_signature: true, // optional, default: true
      context_updates_param_name: "_context_updates", // optional
      fallback_compactor: {
        enabled: false, // optional, default: false
        trigger_token_threshold: 10000, // optional, default: 10000
        compact_oldest_n_tcs: 2, // optional, default: 2
        max_tokens_per_summary: 100, // optional, default: 100
      },
    },
    // rag (optional) — retrieval over a document collection; null = no rag.retrieve tool.
    // rag: { provider: "in_memory" },
    // memory (optional) — durable user facts across chat threads.
    memory: {
      enabled: false, // optional, default: false
      namespace: "", // optional, default: "" (uses agent name)
      max_entities: 100, // optional, default: 100
      extract_after_each_turn: true, // optional, default: true
      inject_into_prompt: true, // optional, default: true
      max_conversation_chars: 6000, // optional, default: 6000
    },
    // context_summary (optional) — fold oldest turns into summary_text when window fills.
    context_summary: {
      summarize_on: null, // optional, default: null (disabled); e.g. 0.8 = 80%
      turns_to_fold: 2, // optional, default: 2
      max_summary_chars: 4000, // optional, default: 4000
      inject_into_prompt: true, // optional, default: true
    },
    // storage (optional, default: null) — fallback when runner has no storageConfig.
    storage: null,
    // toolset (optional, default: null) — name of a toolset defined on the registry;
    // null means every registered tool is visible.
    toolset: null,
    // tool_plugins (optional, default: []) — legacy allow-list of plugin namespaces.
    tool_plugins: [],
    // skills (optional) — agentskills.io SKILL.md folders + learned store.
    skills: {
      enabled: false, // optional, default: false
      activationMode: "auto", // optional, default: "auto"
      allowScripts: false, // optional, default: false
    },
    result_type: null, // optional, default: null — structured output
    trace_enabled: false, // optional, default: false
    trace_sink: "stdout", // optional, default: "stdout" | "otel"
    stream_output: false, // optional, default: false — blocking vs streaming
    metadata: {}, // optional, default: {}
  });
}

async function main(): Promise<void> {
  const config = buildAgentConfig();

  // ToolRegistry (required) — catalog of tools the LLM can call.
  const registry = new ToolRegistry();
  registry.addTool(echo); // flat name "echo" (no plugin prefix)

  // AgentRunner — executes the agent loop.
  const runner = new AgentRunner({
    config, // required
    toolRegistry: registry, // required
    storageConfig: {
      adapter: "sqlite", // optional, default on runner: in-memory
      adapter_config: { tenant_scoped: true }, // uses NEXUS_DATA_ROOT (default ./tenants)
    },
    runContext: createRunContext({
      tenantId: "demo", // optional — which customer/org
      userId: "demo-user", // scopes chat history + cross-session user_memory
      sessionId: "sess-1",
      metadata: {},
    }),
    eventEmitter: undefined, // optional, default: new NexusEventEmitter
    // Built-in SQLite/Postgres/Redis memory class names currently alias in-memory.
    crossSessionMemoryStore: new InMemoryCrossSessionMemoryStore(),
    onTurnEnd: undefined, // optional; TurnDecision hook after each turn
    // llmAdapter: new MockLLMAdapter(), // tests without a real API key
  });
  // runner.cancel() cooperatively stops an in-flight run (status: "interrupted")
  // runner.grantTools("echo") / grantToolset("core") / revokeTools("echo")

  // run() — blocking execution; returns AgentRunResult.
  const result = await runner.run({
    userMessage: "Echo hello", // required
    sessionId: null, // optional — override chat id for this call only
    initialContext: { deal_id: "D-99" }, // optional — merged into session metadata once
    stream: false, // optional — true raises; use runStream() instead
  });
  console.log(result.finalResponse);
  console.log("turns:", result.turnsUsed);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
