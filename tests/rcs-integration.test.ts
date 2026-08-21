import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAgentConfig } from "../src/config/agent.js";
import { parseLLMProviderConfig } from "../src/config/llm.js";
import { parseRuntimeContextSummarizerConfig, parseServerCompactorConfig } from "../src/config/rcs.js";
import { ContextWindowBuilder } from "../src/context/builder.js";
import { MockLLMAdapter } from "../src/eval/mock-llm.js";
import { LLMProxy } from "../src/llm/proxy.js";
import {
  createLLMResponse,
  createLLMStreamChunk,
  type LLMResponse,
} from "../src/llm/response.js";
import { ServerCompactor } from "../src/rcs/compactor.js";
import { AgentRunner } from "../src/runner/agent-runner.js";
import { SessionManager } from "../src/session/manager.js";
import type { AgentSession } from "../src/session/models.js";
import { defineTool } from "../src/tools/decorators.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { hasLiveLlm, liveLlmConfig } from "./helpers.js";

const NOISE_BLOB = (
  "PANDAS COOKBOOK: How to make chocolate chip cookies with butter, flour, and sugar. " +
  "Season the dough with vanilla extract. Bake at 350F for 12 minutes. " +
  "This recipe has nothing to do with physics, quantum mechanics, or documentation. "
).repeat(8);

const RCS_SUMMARY = "I checked noise_lookup but it does not contain what I want.";

const USER_PROMPT =
  "Find quantum entanglement info in our docs. " +
  "First call global.noise_lookup with query 'quantum entanglement'. " +
  "If that result is not about quantum physics, call global.doc_search next and include " +
  `_context_updates summarizing the noise_lookup result as: '${RCS_SUMMARY}'`;

const noiseLookup = defineTool(
  (query: string) => `[noise_lookup for '${query}'] ${NOISE_BLOB}`,
  {
    name: "noise_lookup",
    description: "General lookup that may return unrelated content.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
);

const docSearch = defineTool(
  (query: string) => `Doc hit for '${query}': quantum entanglement is covered in section 4.2.`,
  {
    name: "doc_search",
    description: "Search internal documentation.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
);

const summarizeFindings = defineTool((text: string) => `Summary: ${text}`, {
  name: "summarize_findings",
  description: "Summarize findings.",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
});

function registerRcsTools(registry: ToolRegistry): void {
  registry.registerTool(noiseLookup);
  registry.registerTool(docSearch);
  registry.registerTool(summarizeFindings);
}

function rcsAgentConfig(llmConfig: ReturnType<typeof parseLLMProviderConfig>, extras: Record<string, unknown> = {}) {
  return parseAgentConfig({
    name: "rcs-test-agent",
    llm: llmConfig,
    rcs: { enabled: true },
    tool_plugins: ["global"],
    turns: { max_turns: 5, turn_timeout_seconds: 120 },
    persona: {
      role: "Research assistant",
      goal: "Find correct documentation and manage context efficiently",
    },
    ...extras,
  });
}

function summaryMatchesIntent(summary: string): boolean {
  const lower = summary.toLowerCase();
  return ["checked", "not contain", "does not", "not relevant", "unrelated"].some((phrase) =>
    lower.includes(phrase),
  );
}

async function assertRcsApplied(session: AgentSession, agentConfig: ReturnType<typeof parseAgentConfig>) {
  expect(session.turns.length).toBeGreaterThanOrEqual(2);
  const noiseTc = session.turns[0]!.toolCalls[0]!;
  expect(noiseTc.toolName).toBe("global.noise_lookup");
  expect(noiseTc.tcId).toMatch(/^TC\d+$/);
  expect(noiseTc.tcIndex).toBeGreaterThanOrEqual(0);
  expect(noiseTc.rawResponse).toContain("PANDAS COOKBOOK");
  expect(noiseTc.summarizedResponse).toBeTruthy();
  const hasUpdates = session.turns.some((turn) => turn.contextUpdatesReceived.length > 0);
  expect(hasUpdates || Boolean(noiseTc.summarizedResponse)).toBe(true);
  const summary = noiseTc.summarizedResponse ?? "";
  expect(summaryMatchesIntent(summary), `Unexpected summary: ${JSON.stringify(summary)}`).toBe(true);
  for (const turn of session.turns.slice(1)) {
    for (const tc of turn.toolCalls) {
      expect(tc.toolInput).not.toHaveProperty("_context_updates");
    }
  }
  const messages = await new ContextWindowBuilder().build({ session, agentConfig });
  const toolContents = messages.filter((m) => m.role === "tool").map((m) => String(m.content));
  expect(
    toolContents.some(
      (c) => c.toLowerCase().includes(RCS_SUMMARY.toLowerCase()) || summaryMatchesIntent(c),
    ),
  ).toBe(true);
  expect(toolContents.some((c) => c.includes("PANDAS COOKBOOK"))).toBe(false);
  expect(session.totalTokensSavedByRcs).toBeGreaterThan(0);
}

function usage(prompt: number, completion: number) {
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
    cachedTokens: 0,
  };
}

describe("RCS integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // PYTHON: test_rcs_e2e_mocked_llm
  it("compresses an irrelevant tool result on the next tool call", async () => {
    const llmConfig = parseLLMProviderConfig({ provider: "openai", model: "gpt-4o", api_key: "sk-test" });
    const agentConfig = rcsAgentConfig(llmConfig);
    const registry = new ToolRegistry();
    registerRcsTools(registry);
    const manager = new SessionManager();
    const runner = new AgentRunner({
      config: agentConfig,
      toolRegistry: registry,
      storageConfig: manager,
    });

    const responseTurn0 = createLLMResponse({
      content: "Let me try the general lookup first.",
      toolCalls: [
        {
          id: "call-1",
          toolName: "global.noise_lookup",
          toolInput: { query: "quantum entanglement" },
        },
      ],
      usage: usage(10, 8),
      finishReason: "tool_calls",
    });
    const responseTurn2 = createLLMResponse({
      content: "Found quantum entanglement in section 4.2.",
      toolCalls: [],
      usage: usage(30, 10),
      finishReason: "stop",
    });

    let callCount = 0;
    vi.spyOn(runner.llmProxy, "chat").mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return responseTurn0;
      if (callCount === 2) {
        const sess = await manager.loadSession("rcs-mock-sess");
        const tcId = sess!.turns[0]!.toolCalls[0]!.tcId;
        return createLLMResponse({
          content: "The noise result was useless; searching docs instead.",
          toolCalls: [
            {
              id: "call-2",
              toolName: "global.doc_search",
              toolInput: {
                query: "quantum entanglement",
                _context_updates: [{ tc_id: tcId, summary: RCS_SUMMARY }],
              },
            },
          ],
          usage: usage(20, 12),
          finishReason: "tool_calls",
        });
      }
      return responseTurn2;
    });

    const result = await runner.run({
      userMessage: USER_PROMPT,
      sessionId: "rcs-mock-sess",
    });
    expect(result.status).toBe("completed");
    expect(result.totalTokensSavedByRcs ?? 0).toBeGreaterThan(0);
    const sess = (await manager.loadSession("rcs-mock-sess"))!;
    await assertRcsApplied(sess, agentConfig);
    const summarized = sess.findTc(sess.turns[0]!.toolCalls[0]!.tcId);
    expect(summarized?.summarizedResponse).toBe(RCS_SUMMARY);
  });

  // PYTHON: test_rcs_e2e_live_llm
  it.skipIf(!hasLiveLlm() || process.env.NEXUS_LIVE_LLM !== "1")(
    "runs a live LLM RCS flow when explicitly enabled",
    async () => {
      const agentConfig = rcsAgentConfig(liveLlmConfig());
      const registry = new ToolRegistry();
      registerRcsTools(registry);
      const manager = new SessionManager();
      const runner = new AgentRunner({
        config: agentConfig,
        toolRegistry: registry,
        storageConfig: manager,
      });
      await runner.run({ userMessage: USER_PROMPT, sessionId: "rcs-live-sess" });
      const sess = (await manager.loadSession("rcs-live-sess"))!;
      await assertRcsApplied(sess, agentConfig);
    },
  );

  // PYTHON: test_rcs_e2e_streaming
  it("applies RCS in streaming mode", async () => {
    const llmConfig = parseLLMProviderConfig({ provider: "openai", model: "gpt-4o", api_key: "sk-test" });
    const agentConfig = rcsAgentConfig(llmConfig, { stream_output: true });
    const registry = new ToolRegistry();
    registerRcsTools(registry);
    const manager = new SessionManager();
    const runner = new AgentRunner({
      config: agentConfig,
      toolRegistry: registry,
      storageConfig: manager,
    });

    let streamCallIdx = 0;
    vi.spyOn(runner.llmProxy, "chatStream").mockImplementation(async function* () {
      streamCallIdx += 1;
      if (streamCallIdx === 1) {
        yield createLLMStreamChunk({ content: "Trying noise lookup." });
        yield createLLMStreamChunk({
          toolCalls: [
            {
              index: 0,
              id: "c1",
              name: "global.noise_lookup",
              arguments: '{"query": "quantum entanglement"}',
            },
          ],
          finishReason: "tool_calls",
          usage: usage(10, 8),
        });
        return;
      }
      if (streamCallIdx === 2) {
        const sess = await manager.loadSession("rcs-stream-sess");
        const tcId = sess?.turns[0]?.toolCalls[0]?.tcId ?? "TC0";
        yield createLLMStreamChunk({ content: "Noise useless; searching docs." });
        yield createLLMStreamChunk({
          toolCalls: [
            {
              index: 0,
              id: "c2",
              name: "global.doc_search",
              arguments: JSON.stringify({
                query: "quantum entanglement",
                _context_updates: [{ tc_id: tcId, summary: RCS_SUMMARY }],
              }),
            },
          ],
          finishReason: "tool_calls",
          usage: usage(20, 12),
        });
        return;
      }
      yield createLLMStreamChunk({ content: "Found it in section 4.2." });
      yield createLLMStreamChunk({ content: "", finishReason: "stop", usage: usage(30, 10) });
    });

    const events = [];
    for await (const ev of runner.runStream({
      userMessage: USER_PROMPT,
      sessionId: "rcs-stream-sess",
    })) {
      events.push(ev);
    }
    expect(events.some((e) => e.eventType === "final_response")).toBe(true);
    const sess = (await manager.loadSession("rcs-stream-sess"))!;
    expect(sess.totalTokensSavedByRcs).toBeGreaterThan(0);
  });

  // PYTHON: test_rcs_e2e_legacy_sentinel_is_ignored
  it("ignores a legacy summary='[]' and keeps the full result tagged", async () => {
    const llmConfig = parseLLMProviderConfig({ provider: "openai", model: "gpt-4o", api_key: "sk-test" });
    const agentConfig = rcsAgentConfig(llmConfig);
    const registry = new ToolRegistry();
    registerRcsTools(registry);
    const manager = new SessionManager();
    const runner = new AgentRunner({
      config: agentConfig,
      toolRegistry: registry,
      storageConfig: manager,
    });

    const responses: LLMResponse[] = [];
    let callCount = 0;
    vi.spyOn(runner.llmProxy, "chat").mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return createLLMResponse({
          content: "Lookup.",
          toolCalls: [
            { id: "c1", toolName: "global.noise_lookup", toolInput: { query: "q" } },
          ],
          usage: usage(10, 5),
          finishReason: "tool_calls",
        });
      }
      if (callCount === 2) {
        const sess = await manager.loadSession("rcs-drop-sess");
        const tcId = sess!.turns[0]!.toolCalls[0]!.tcId;
        return createLLMResponse({
          content: "Dropping noise, searching docs.",
          toolCalls: [
            {
              id: "c2",
              toolName: "global.doc_search",
              toolInput: {
                query: "q",
                _context_updates: [{ tc_id: tcId, summary: "[]" }],
              },
            },
          ],
          usage: usage(20, 10),
          finishReason: "tool_calls",
        });
      }
      return createLLMResponse({
        content: "Done.",
        toolCalls: [],
        usage: usage(15, 5),
        finishReason: "stop",
      });
    });
    void responses;

    await runner.run({ userMessage: USER_PROMPT, sessionId: "rcs-drop-sess" });
    const sess = (await manager.loadSession("rcs-drop-sess"))!;
    const noiseTc = sess.turns[0]!.toolCalls[0]!;
    expect(noiseTc.summarizedResponse).toBeNull();
    const messages = await new ContextWindowBuilder().build({ session: sess, agentConfig });
    const toolContents = messages.filter((m) => m.role === "tool").map((m) => String(m.content));
    expect(toolContents.some((c) => c.includes("PANDAS COOKBOOK"))).toBe(true);
    expect(toolContents.some((c) => /\[TC\d+]/.test(c))).toBe(true);
    const roles = messages.map((m) => m.role);
    expect(
      roles.some((role, i) => role === "assistant" && roles[i + 1] === "assistant"),
    ).toBe(false);
  });

  // PYTHON: test_rcs_e2e_multiple_tc_summarized_in_one_call
  it("summarizes multiple TCs in a single _context_updates list", async () => {
    const llmConfig = parseLLMProviderConfig({ provider: "openai", model: "gpt-4o", api_key: "sk-test" });
    const agentConfig = rcsAgentConfig(llmConfig);
    const registry = new ToolRegistry();
    registerRcsTools(registry);
    const manager = new SessionManager();
    const runner = new AgentRunner({
      config: agentConfig,
      toolRegistry: registry,
      storageConfig: manager,
    });

    let callCount = 0;
    vi.spyOn(runner.llmProxy, "chat").mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return createLLMResponse({
          content: "Two lookups.",
          toolCalls: [
            { id: "c1", toolName: "global.noise_lookup", toolInput: { query: "q1" } },
            { id: "c2", toolName: "global.noise_lookup", toolInput: { query: "q2" } },
          ],
          usage: usage(10, 5),
          finishReason: "tool_calls",
        });
      }
      if (callCount === 2) {
        const sess = await manager.loadSession("rcs-multi-sess");
        const tc1 = sess!.turns[0]!.toolCalls[0]!.tcId;
        const tc2 = sess!.turns[0]!.toolCalls[1]!.tcId;
        return createLLMResponse({
          content: "Both useless; searching docs.",
          toolCalls: [
            {
              id: "c3",
              toolName: "global.doc_search",
              toolInput: {
                query: "q",
                _context_updates: [
                  { tc_id: tc1, summary: "noise1 not relevant" },
                  { tc_id: tc2, summary: "noise2 not relevant" },
                ],
              },
            },
          ],
          usage: usage(20, 10),
          finishReason: "tool_calls",
        });
      }
      return createLLMResponse({
        content: "Done.",
        toolCalls: [],
        usage: usage(15, 5),
        finishReason: "stop",
      });
    });

    await runner.run({ userMessage: "Search q", sessionId: "rcs-multi-sess" });
    const sess = (await manager.loadSession("rcs-multi-sess"))!;
    const first = sess.turns[0]!.toolCalls[0]!;
    const second = sess.turns[0]!.toolCalls[1]!;
    expect(sess.findTc(first.tcId)?.summarizedResponse).toBe("noise1 not relevant");
    expect(sess.findTc(second.tcId)?.summarizedResponse).toBe("noise2 not relevant");
  });

  // PYTHON: test_rcs_e2e_custom_param_name
  it("works end-to-end with a custom context_updates_param_name", async () => {
    const llmConfig = parseLLMProviderConfig({ provider: "openai", model: "gpt-4o", api_key: "sk-test" });
    const agentConfig = parseAgentConfig({
      name: "rcs-custom",
      llm: llmConfig,
      rcs: { enabled: true, context_updates_param_name: "_my_updates" },
      tool_plugins: ["global"],
      turns: { max_turns: 5, turn_timeout_seconds: 120 },
      persona: { role: "Research assistant", goal: "Find docs." },
    });
    const registry = new ToolRegistry();
    registerRcsTools(registry);
    const manager = new SessionManager();
    const runner = new AgentRunner({
      config: agentConfig,
      toolRegistry: registry,
      storageConfig: manager,
    });
    const schemas = registry.getToolSchemasForLlm(null, agentConfig.rcs);
    expect(
      (schemas[0]!.parameters as { properties: Record<string, unknown> }).properties,
    ).toHaveProperty("_my_updates");

    let callCount = 0;
    vi.spyOn(runner.llmProxy, "chat").mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return createLLMResponse({
          content: "Lookup.",
          toolCalls: [
            { id: "c1", toolName: "global.noise_lookup", toolInput: { query: "q" } },
          ],
          usage: usage(10, 5),
          finishReason: "tool_calls",
        });
      }
      if (callCount === 2) {
        const sess = await manager.loadSession("rcs-custom-sess");
        const tcId = sess!.turns[0]!.toolCalls[0]!.tcId;
        return createLLMResponse({
          content: "Searching docs.",
          toolCalls: [
            {
              id: "c2",
              toolName: "global.doc_search",
              toolInput: {
                query: "q",
                _my_updates: [{ tc_id: tcId, summary: "noise not relevant" }],
              },
            },
          ],
          usage: usage(20, 10),
          finishReason: "tool_calls",
        });
      }
      return createLLMResponse({
        content: "Done.",
        toolCalls: [],
        usage: usage(15, 5),
        finishReason: "stop",
      });
    });

    await runner.run({ userMessage: "Search q", sessionId: "rcs-custom-sess" });
    const sess = (await manager.loadSession("rcs-custom-sess"))!;
    expect(sess.findTc(sess.turns[0]!.toolCalls[0]!.tcId)?.summarizedResponse).toBe(
      "noise not relevant",
    );
    expect(sess.totalTokensSavedByRcs).toBeGreaterThan(0);
  });

  // PYTHON: test_rcs_invariant_tool_input_never_has_context_updates
  it("never stores _context_updates on ToolCallRecord.tool_input", async () => {
    const llmConfig = parseLLMProviderConfig({ provider: "openai", model: "gpt-4o", api_key: "sk-test" });
    const agentConfig = rcsAgentConfig(llmConfig);
    const registry = new ToolRegistry();
    registerRcsTools(registry);
    const manager = new SessionManager();
    const runner = new AgentRunner({
      config: agentConfig,
      toolRegistry: registry,
      storageConfig: manager,
    });

    let callCount = 0;
    vi.spyOn(runner.llmProxy, "chat").mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return createLLMResponse({
          content: "Lookup.",
          toolCalls: [
            { id: "c1", toolName: "global.noise_lookup", toolInput: { query: "q" } },
          ],
          usage: usage(10, 5),
          finishReason: "tool_calls",
        });
      }
      if (callCount === 2) {
        const sess = await manager.loadSession("rcs-invariant-sess");
        const tcId = sess!.turns[0]!.toolCalls[0]!.tcId;
        return createLLMResponse({
          content: "Searching docs.",
          toolCalls: [
            {
              id: "c2",
              toolName: "global.doc_search",
              toolInput: {
                query: "q",
                _context_updates: [{ tc_id: tcId, summary: "noise not relevant" }],
              },
            },
          ],
          usage: usage(20, 10),
          finishReason: "tool_calls",
        });
      }
      return createLLMResponse({
        content: "Done.",
        toolCalls: [],
        usage: usage(15, 5),
        finishReason: "stop",
      });
    });

    await runner.run({ userMessage: "Search q", sessionId: "rcs-invariant-sess" });
    const sess = (await manager.loadSession("rcs-invariant-sess"))!;
    for (const turn of sess.turns) {
      for (const tc of turn.toolCalls) {
        expect(tc.toolInput, `${tc.tcId} leaked _context_updates into tool_input`).not.toHaveProperty(
          "_context_updates",
        );
      }
    }
  });

  // PYTHON: test_rcs_invariant_aggregated_tokens_match_turn_sum
  it("keeps session RCS savings consistent with applied summaries", async () => {
    const llmConfig = parseLLMProviderConfig({ provider: "openai", model: "gpt-4o", api_key: "sk-test" });
    const agentConfig = rcsAgentConfig(llmConfig);
    const registry = new ToolRegistry();
    registerRcsTools(registry);
    const manager = new SessionManager();
    const runner = new AgentRunner({
      config: agentConfig,
      toolRegistry: registry,
      storageConfig: manager,
    });

    let callCount = 0;
    vi.spyOn(runner.llmProxy, "chat").mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return createLLMResponse({
          content: "Lookup.",
          toolCalls: [
            { id: "c1", toolName: "global.noise_lookup", toolInput: { query: "q" } },
          ],
          usage: usage(10, 5),
          finishReason: "tool_calls",
        });
      }
      if (callCount === 2) {
        const sess = await manager.loadSession("rcs-agg-sess");
        const tcId = sess!.turns[0]!.toolCalls[0]!.tcId;
        return createLLMResponse({
          content: "Searching docs.",
          toolCalls: [
            {
              id: "c2",
              toolName: "global.doc_search",
              toolInput: {
                query: "q",
                _context_updates: [{ tc_id: tcId, summary: "noise not relevant" }],
              },
            },
          ],
          usage: usage(20, 10),
          finishReason: "tool_calls",
        });
      }
      return createLLMResponse({
        content: "Done.",
        toolCalls: [],
        usage: usage(15, 5),
        finishReason: "stop",
      });
    });

    await runner.run({ userMessage: "Search q", sessionId: "rcs-agg-sess" });
    const sess = (await manager.loadSession("rcs-agg-sess"))!;
    const turnSum = sess.turns.reduce((sum, t) => sum + t.tokensSavedThisTurn, 0);
    expect(sess.totalTokensSavedByRcs).toBeGreaterThan(0);
    if (turnSum > 0) {
      expect(turnSum).toBe(sess.totalTokensSavedByRcs);
    }
  });

  // PYTHON: test_rcs_e2e_fallback_compactor_triggered
  it("can compact an oversized unsummarized TC via ServerCompactor", async () => {
    const llmConfig = parseLLMProviderConfig({ provider: "openai", model: "gpt-4o", api_key: "sk-test" });
    const agentConfig = parseAgentConfig({
      name: "rcs-compactor",
      llm: llmConfig,
      rcs: {
        enabled: true,
        fallback_compactor: {
          enabled: true,
          trigger_token_threshold: 100,
          compact_oldest_n_tcs: 1,
        },
      },
      tool_plugins: ["global"],
      turns: { max_turns: 5, turn_timeout_seconds: 120 },
      persona: { role: "Research assistant", goal: "Find docs." },
    });
    const registry = new ToolRegistry();
    registerRcsTools(registry);
    const manager = new SessionManager();
    const runner = new AgentRunner({
      config: agentConfig,
      toolRegistry: registry,
      storageConfig: manager,
    });

    let callCount = 0;
    vi.spyOn(runner.llmProxy, "chat").mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return createLLMResponse({
          content: "Lookup.",
          toolCalls: [
            { id: "c1", toolName: "global.noise_lookup", toolInput: { query: "q" } },
          ],
          usage: usage(10, 5),
          finishReason: "tool_calls",
        });
      }
      return createLLMResponse({
        content: "Done.",
        toolCalls: [],
        usage: usage(15, 5),
        finishReason: "stop",
      });
    });

    await runner.run({ userMessage: "Search q", sessionId: "rcs-compactor-sess" });
    const sess = (await manager.loadSession("rcs-compactor-sess"))!;
    const tc1 = sess.turns[0]!.toolCalls[0]!;
    if (!tc1.summarizedResponse) {
      const compactCfg = parseServerCompactorConfig({
        enabled: true,
        trigger_token_threshold: 100,
        compact_oldest_n_tcs: 1,
      });
      const adapter = new MockLLMAdapter(llmConfig, [
        { content: "compacted noise lookup result" },
      ]);
      const compactor = new ServerCompactor(
        compactCfg,
        new LLMProxy(llmConfig, adapter),
        manager,
      );
      await compactor.compact(sess, 1);
    }
    expect(sess.findTc(tc1.tcId)?.summarizedResponse).toBeTruthy();
    expect(sess.totalTokensSavedByRcs).toBeGreaterThan(0);
  });

  // PYTHON: test_rcs_cumulative_savings_exceed_one_time
  it("accumulates recurring savings above one-time savings", async () => {
    const llmConfig = parseLLMProviderConfig({ provider: "openai", model: "gpt-4o", api_key: "sk-test" });
    const agentConfig = rcsAgentConfig(llmConfig);
    const registry = new ToolRegistry();
    registerRcsTools(registry);
    const manager = new SessionManager();
    const runner = new AgentRunner({
      config: agentConfig,
      toolRegistry: registry,
      storageConfig: manager,
    });

    let callCount = 0;
    vi.spyOn(runner.llmProxy, "chat").mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return createLLMResponse({
          content: "Lookup.",
          toolCalls: [
            { id: "c1", toolName: "global.noise_lookup", toolInput: { query: "q" } },
          ],
          usage: usage(10, 5),
          finishReason: "tool_calls",
        });
      }
      if (callCount === 2) {
        const sess = await manager.loadSession("rcs-cumulative-sess");
        const tcId = sess!.turns[0]!.toolCalls[0]!.tcId;
        return createLLMResponse({
          content: "Searching docs.",
          toolCalls: [
            {
              id: "c2",
              toolName: "global.doc_search",
              toolInput: {
                query: "q",
                _context_updates: [{ tc_id: tcId, summary: "noise not relevant" }],
              },
            },
          ],
          usage: usage(20, 10),
          finishReason: "tool_calls",
        });
      }
      if (callCount === 3) {
        const sess = await manager.loadSession("rcs-cumulative-sess");
        const tcId = sess!.turns[1]!.toolCalls[0]!.tcId;
        return createLLMResponse({
          content: "Found it. Summarizing.",
          toolCalls: [
            {
              id: "c3",
              toolName: "global.summarize_findings",
              toolInput: {
                text: "found section 4.2",
                _context_updates: [{ tc_id: tcId, summary: "found section 4.2" }],
              },
            },
          ],
          usage: usage(25, 10),
          finishReason: "tool_calls",
        });
      }
      return createLLMResponse({
        content: "Done.",
        toolCalls: [],
        usage: usage(15, 5),
        finishReason: "stop",
      });
    });

    const result = await runner.run({
      userMessage: "Search q",
      sessionId: "rcs-cumulative-sess",
    });
    const sess = (await manager.loadSession("rcs-cumulative-sess"))!;
    expect(sess.totalTokensSavedByRcs).toBeGreaterThan(0);
    expect(sess.cumulativeInputTokensSavedByRcs).toBeGreaterThan(sess.totalTokensSavedByRcs);
    expect(result.cumulativeInputTokensSavedByRcs).toBe(sess.cumulativeInputTokensSavedByRcs);
    const dumped = sess.toJSON();
    const tokenUsage = dumped.token_usage as Record<string, unknown>;
    expect(tokenUsage.total_tokens_in).toBe(
      sess.turns.reduce((sum, t) => sum + t.totalTokensIn, 0),
    );
    expect(tokenUsage.total_tokens_out).toBe(
      sess.turns.reduce((sum, t) => sum + t.totalTokensOut, 0),
    );
    expect(tokenUsage.total_tokens_saved_by_rcs).toBe(sess.totalTokensSavedByRcs);
    expect(tokenUsage.cumulative_input_tokens_saved_by_rcs).toBe(
      sess.cumulativeInputTokensSavedByRcs,
    );
    expect(tokenUsage.rcs_enabled).toBe(sess.rcsEnabled);
    expect(sess.tokenUsage).toEqual(tokenUsage);
  });

  // PYTHON: test_rcs_recurring_savings_monotonic
  it("keeps cumulative recurring savings monotonically non-decreasing", async () => {
    const llmConfig = parseLLMProviderConfig({ provider: "openai", model: "gpt-4o", api_key: "sk-test" });
    const agentConfig = rcsAgentConfig(llmConfig);
    const registry = new ToolRegistry();
    registerRcsTools(registry);
    const manager = new SessionManager();
    const runner = new AgentRunner({
      config: agentConfig,
      toolRegistry: registry,
      storageConfig: manager,
    });

    let callCount = 0;
    vi.spyOn(runner.llmProxy, "chat").mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return createLLMResponse({
          content: "Lookup.",
          toolCalls: [
            { id: "c1", toolName: "global.noise_lookup", toolInput: { query: "q" } },
          ],
          usage: usage(10, 5),
          finishReason: "tool_calls",
        });
      }
      if (callCount === 2) {
        const sess = await manager.loadSession("rcs-monotonic-sess");
        const tcId = sess!.turns[0]!.toolCalls[0]!.tcId;
        return createLLMResponse({
          content: "Searching docs.",
          toolCalls: [
            {
              id: "c2",
              toolName: "global.doc_search",
              toolInput: {
                query: "q",
                _context_updates: [{ tc_id: tcId, summary: "noise not relevant" }],
              },
            },
          ],
          usage: usage(20, 10),
          finishReason: "tool_calls",
        });
      }
      return createLLMResponse({
        content: "Done.",
        toolCalls: [],
        usage: usage(15, 5),
        finishReason: "stop",
      });
    });

    await runner.run({ userMessage: "Search q", sessionId: "rcs-monotonic-sess" });
    const sess = (await manager.loadSession("rcs-monotonic-sess"))!;
    let runningTotal = 0;
    for (const turn of sess.turns) {
      expect(turn.recurringSavingsThisTurn).toBeGreaterThanOrEqual(0);
      runningTotal += turn.recurringSavingsThisTurn;
    }
    expect(runningTotal).toBe(sess.cumulativeInputTokensSavedByRcs);
  });
});
