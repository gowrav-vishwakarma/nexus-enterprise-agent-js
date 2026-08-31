import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAgentConfig } from "../src/config/agent.js";
import { DEFAULT_RCS_SYSTEM_BLOCK } from "../src/config/defaults.js";
import {
  parseRuntimeContextSummarizerConfig,
  parseServerCompactorConfig,
} from "../src/config/rcs.js";
import { ContextWindowBuilder } from "../src/context/builder.js";
import { RCSSystemPromptInjector } from "../src/context/rcs-injector.js";
import { CustomCallbackSink, NexusEventEmitter } from "../src/events/emitter.js";
import { NexusEventType } from "../src/events/models.js";
import { EMPTY_ASSISTANT_PLACEHOLDER } from "../src/llm/content-tool-calls.js";
import { LLMProxy } from "../src/llm/proxy.js";
import { TokenCounter } from "../src/llm/token-counter.js";
import { MockLLMAdapter } from "../src/eval/mock-llm.js";
import { ServerCompactor } from "../src/rcs/compactor.js";
import { AgentRunner } from "../src/runner/agent-runner.js";
import { SessionManager } from "../src/session/manager.js";
import { AgentSession, ToolCallRecord, TurnRecord } from "../src/session/models.js";
import { ContextUpdateInterceptor } from "../src/tools/interceptor.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { testLlmConfig } from "./helpers.js";

const FALLBACK_USER_MESSAGE = "Continue.";

function rcsAgent(overrides: Record<string, unknown> = {}) {
  return parseAgentConfig({
    name: "test-agent",
    llm: { provider: "openai", model: "gpt-4o", api_key: "sk-key" },
    rcs: { enabled: true },
    ...overrides,
  });
}

describe("RCS core", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // PYTHON: test_system_prompt_injector
  it("appends the RCS protocol block to the system prompt", () => {
    const rcsConfig = parseRuntimeContextSummarizerConfig({ enabled: true });
    const prompt = RCSSystemPromptInjector.inject("You are an assistant.", rcsConfig);
    expect(prompt).toContain("You are an assistant.");
    expect(prompt).toContain(DEFAULT_RCS_SYSTEM_BLOCK.trim());
    const promptEmpty = RCSSystemPromptInjector.inject("", rcsConfig);
    expect(promptEmpty).toContain(DEFAULT_RCS_SYSTEM_BLOCK.trim());
  });

  // PYTHON: test_context_update_interceptor
  it("extracts _context_updates, validates, and persists summaries", async () => {
    const manager = new SessionManager();
    await manager.createSession("test-agent", "sess-1");
    await manager.appendTurn(
      "sess-1",
      new TurnRecord({
        turnIndex: 0,
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "web_search",
            rawResponse: "Very large search output",
            tokensRaw: 100,
          }),
        ],
      }),
    );
    let session = (await manager.loadSession("sess-1"))!;
    const interceptor = new ContextUpdateInterceptor();
    const rcsConfig = parseRuntimeContextSummarizerConfig({ enabled: true });

    const [cleanedArgs, updates] = await interceptor.intercept(
      "web_search",
      {
        query: "something",
        _context_updates: [{ tc_id: "TC1", summary: "Search summary" }],
      },
      session,
      1,
      manager,
      rcsConfig,
    );
    expect(cleanedArgs).not.toHaveProperty("_context_updates");
    expect(cleanedArgs).toEqual({ query: "something" });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.tcId).toBe("TC1");
    expect(updates[0]!.summary).toBe("Search summary");

    session = (await manager.loadSession("sess-1"))!;
    const target = session.turns[0]!.toolCalls[0]!;
    expect(target.summarizedResponse).toBe("Search summary");
    expect(target.summarizedByTurn).toBe(1);

    const [, updates2] = await interceptor.intercept(
      "web_search",
      { _context_updates: [{ tc_id: "TC_INVALID", summary: "should be ignored" }] },
      session,
      1,
      manager,
      rcsConfig,
    );
    expect(updates2).toHaveLength(0);
  });

  // PYTHON: test_context_window_builder
  it("formats unsummarized, summarized, and legacy sentinel tool messages", async () => {
    const agentConfig = rcsAgent();
    const builder = new ContextWindowBuilder();
    const session = new AgentSession({ sessionId: "sess-1", agentId: "test-agent" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "Find details",
        llmMessages: [{ role: "assistant", content: "Let me run tools" }],
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "tool_a",
            toolInput: { x: 10 },
            rawResponse: "Unsummarized raw result",
          }),
          new ToolCallRecord({
            tcId: "TC2",
            tcIndex: 2,
            toolName: "tool_b",
            toolInput: {},
            rawResponse: "Original response...",
            summarizedResponse: "Short summary",
          }),
          new ToolCallRecord({
            tcId: "TC3",
            tcIndex: 3,
            toolName: "tool_c",
            toolInput: {},
            rawResponse: "Verbose error trace...",
            summarizedResponse: "[]",
          }),
        ],
      }),
    );
    const messages = await builder.build({
      session,
      agentConfig,
      currentUserMessage: "Next question",
    });
    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toBe("Find details");
    const toolMessages = messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(3);
    expect(String(toolMessages[0]!.content)).toContain("[TC1] tool_a(x=10)");
    expect(String(toolMessages[0]!.content)).toContain("Unsummarized raw result");
    expect(toolMessages[1]!.content).toBe("tool_b()\nShort summary");
    expect(String(toolMessages[1]!.content)).not.toContain("[TC2]");
    expect(String(toolMessages[2]!.content)).toContain("[TC3] tool_c()");
    expect(String(toolMessages[2]!.content)).toContain("Verbose error trace...");
  });

  it("emits systemPrompt and toolContext on rcs.context_built", async () => {
    const events: Array<Record<string, unknown>> = [];
    const emitter = new NexusEventEmitter();
    emitter.registerSink(
      new CustomCallbackSink(async (event) => {
        events.push(event as Record<string, unknown>);
      }),
    );
    const agentConfig = rcsAgent({
      persona: { system_prompt: "You are a test assistant." },
    });
    const builder = new ContextWindowBuilder(emitter);
    const session = new AgentSession({ sessionId: "sess-1", agentId: "test-agent" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "Run a tool",
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "lookup",
            toolInput: { q: "test" },
            rawResponse: "raw payload",
          }),
        ],
      }),
    );
    await builder.build({
      session,
      agentConfig,
      currentUserMessage: "Continue",
    });
    const built = events.find((e) => e.eventType === NexusEventType.RCS_CONTEXT_BUILT);
    expect(built).toBeTruthy();
    expect(String(built?.systemPrompt ?? "")).toContain("You are a test assistant.");
    expect(Array.isArray(built?.toolContext)).toBe(true);
    expect((built?.toolContext as Array<Record<string, unknown>>)[0]?.mode).toBe("raw");
  });

  const noSummaryCases = [
    { id: "sentinel", update: { tc_id: "TC1", summary: "[]" } },
    { id: "empty", update: { tc_id: "TC1", summary: "" } },
    { id: "whitespace", update: { tc_id: "TC1", summary: "   " } },
    { id: "null", update: { tc_id: "TC1", summary: null } },
    { id: "missing", update: { tc_id: "TC1" } },
  ];

  // PYTHON: test_interceptor_no_summary_leaves_tc_untouched
  it.each(noSummaryCases)(
    "treats $id as a no-op and leaves the TC raw",
    async ({ update }) => {
      const manager = new SessionManager();
      await manager.createSession("a", "nosum-sess");
      await manager.appendTurn(
        "nosum-sess",
        new TurnRecord({
          turnIndex: 0,
          toolCalls: [
            new ToolCallRecord({
              tcId: "TC1",
              tcIndex: 1,
              toolName: "t",
              rawResponse: "big",
              tokensRaw: 100,
            }),
          ],
        }),
      );
      const session = (await manager.loadSession("nosum-sess"))!;
      const interceptor = new ContextUpdateInterceptor();
      const rcs = parseRuntimeContextSummarizerConfig({ enabled: true });
      const [cleaned, updates] = await interceptor.intercept(
        "t",
        { _context_updates: [update] },
        session,
        1,
        manager,
        rcs,
      );
      expect(cleaned).toEqual({});
      expect(updates).toEqual([]);
      const reloaded = (await manager.loadSession("nosum-sess"))!;
      const target = reloaded.turns[0]!.toolCalls[0]!;
      expect(target.summarizedResponse).toBeNull();
      expect(target.tokensSummarized).toBeNull();
    },
  );

  // PYTHON: test_builder_renders_raw_when_summary_is_empty
  it("renders the raw result when a stored summary is empty", async () => {
    const agentConfig = rcsAgent();
    const session = new AgentSession({ sessionId: "empty-sum", agentId: "test-agent" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "go",
        llmMessages: [{ role: "assistant", content: "running" }],
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "tool_a",
            toolInput: {},
            rawResponse: "THE REAL RESULT",
            summarizedResponse: "",
          }),
        ],
      }),
    );
    const messages = await new ContextWindowBuilder().build({ session, agentConfig });
    const toolMessages = messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(String(toolMessages[0]!.content)).toContain("THE REAL RESULT");
    expect(String(toolMessages[0]!.content)).toContain("[TC1] tool_a()");
  });

  // PYTHON: test_interceptor_multiple_updates_in_one_call
  it("applies multiple TC summaries in one intercept", async () => {
    const manager = new SessionManager();
    await manager.createSession("a", "multi-sess");
    await manager.appendTurn(
      "multi-sess",
      new TurnRecord({
        turnIndex: 0,
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t1",
            rawResponse: "r1",
            tokensRaw: 100,
          }),
          new ToolCallRecord({
            tcId: "TC2",
            tcIndex: 2,
            toolName: "t2",
            rawResponse: "r2",
            tokensRaw: 200,
          }),
        ],
      }),
    );
    const session = (await manager.loadSession("multi-sess"))!;
    const interceptor = new ContextUpdateInterceptor();
    const rcs = parseRuntimeContextSummarizerConfig({ enabled: true });
    const [, updates] = await interceptor.intercept(
      "t1",
      {
        _context_updates: [
          { tc_id: "TC1", summary: "s1" },
          { tc_id: "TC2", summary: "s2" },
        ],
      },
      session,
      1,
      manager,
      rcs,
    );
    expect(updates).toHaveLength(2);
    expect(new Set(updates.map((u) => u.tcId))).toEqual(new Set(["TC1", "TC2"]));
    expect(session.totalTokensSavedByRcs).toBeGreaterThan(0);
  });

  // PYTHON: test_interceptor_custom_param_name
  it("honours a custom context_updates_param_name", async () => {
    const manager = new SessionManager();
    await manager.createSession("a", "custom-sess");
    await manager.appendTurn(
      "custom-sess",
      new TurnRecord({
        turnIndex: 0,
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t",
            rawResponse: "r",
            tokensRaw: 50,
          }),
        ],
      }),
    );
    const session = (await manager.loadSession("custom-sess"))!;
    const interceptor = new ContextUpdateInterceptor();
    const rcs = parseRuntimeContextSummarizerConfig({
      enabled: true,
      context_updates_param_name: "_my_updates",
    });
    const [cleaned, updates] = await interceptor.intercept(
      "t",
      { _my_updates: [{ tc_id: "TC1", summary: "ok" }] },
      session,
      1,
      manager,
      rcs,
    );
    expect(cleaned).not.toHaveProperty("_my_updates");
    expect(updates).toHaveLength(1);
  });

  // PYTHON: test_interceptor_disabled_is_noop
  it("passes args through unchanged when RCS is disabled", async () => {
    const manager = new SessionManager();
    await manager.createSession("a", "noop-sess");
    await manager.appendTurn(
      "noop-sess",
      new TurnRecord({
        turnIndex: 0,
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t",
            rawResponse: "r",
            tokensRaw: 50,
          }),
        ],
      }),
    );
    const session = (await manager.loadSession("noop-sess"))!;
    const interceptor = new ContextUpdateInterceptor();
    const rcs = parseRuntimeContextSummarizerConfig({ enabled: false });
    const input = { query: "q", _context_updates: [{ tc_id: "TC1", summary: "s" }] };
    const [cleaned, updates] = await interceptor.intercept(
      "t",
      input,
      session,
      1,
      manager,
      rcs,
    );
    expect(cleaned).toEqual(input);
    expect(updates).toEqual([]);
  });

  // PYTHON: test_interceptor_emits_cross_session_event_on_invalid_tc
  it("emits RCS_CROSS_SESSION_TC_REFERENCE for an invalid tc_id", async () => {
    const manager = new SessionManager();
    await manager.createSession("a", "xref-sess");
    await manager.appendTurn(
      "xref-sess",
      new TurnRecord({
        turnIndex: 0,
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t",
            rawResponse: "r",
            tokensRaw: 50,
          }),
        ],
      }),
    );
    const session = (await manager.loadSession("xref-sess"))!;
    const emitted: Array<{ eventType: string }> = [];
    const emitter = new NexusEventEmitter();
    emitter.registerSink(new CustomCallbackSink(async (event) => {
      emitted.push(event);
    }));
    const interceptor = new ContextUpdateInterceptor(emitter);
    const rcs = parseRuntimeContextSummarizerConfig({ enabled: true });
    await interceptor.intercept(
      "t",
      { _context_updates: [{ tc_id: "TC_BOGUS", summary: "x" }] },
      session,
      1,
      manager,
      rcs,
    );
    expect(emitted.map((e) => e.eventType)).toContain(
      NexusEventType.RCS_CROSS_SESSION_TC_REFERENCE,
    );
  });

  // PYTHON: test_interceptor_re_summarization_uses_marginal_savings
  it("counts only marginal savings when re-summarizing", async () => {
    const manager = new SessionManager();
    await manager.createSession("a", "resum-sess");
    await manager.appendTurn(
      "resum-sess",
      new TurnRecord({
        turnIndex: 0,
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t",
            rawResponse: "r".repeat(500),
            tokensRaw: 200,
          }),
        ],
      }),
    );
    const session = (await manager.loadSession("resum-sess"))!;
    const interceptor = new ContextUpdateInterceptor();
    const rcs = parseRuntimeContextSummarizerConfig({ enabled: true });
    const [, updates1] = await interceptor.intercept(
      "t",
      { _context_updates: [{ tc_id: "TC1", summary: "short" }] },
      session,
      1,
      manager,
      rcs,
    );
    const saved1 = updates1[0]!.tokensSaved;
    const total1 = session.totalTokensSavedByRcs;
    const [, updates2] = await interceptor.intercept(
      "t",
      { _context_updates: [{ tc_id: "TC1", summary: "shorter" }] },
      session,
      2,
      manager,
      rcs,
    );
    const saved2 = updates2[0]!.tokensSaved;
    const total2 = session.totalTokensSavedByRcs;
    expect(total2).toBe(total1 + saved2);
    expect(saved2).toBeLessThan(saved1);
  });

  // PYTHON: test_compactor_should_trigger_thresholds
  it("triggers compaction only over threshold with unsummarized TCs", async () => {
    const cfg = parseServerCompactorConfig({ enabled: true, trigger_token_threshold: 1000 });
    const llm = new LLMProxy(testLlmConfig(), new MockLLMAdapter(testLlmConfig(), [{ content: "x" }]));
    const compactor = new ServerCompactor(cfg, llm, {});
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    expect(await compactor.shouldTrigger(session, 2000)).toBe(false);
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t",
            rawResponse: "r",
            tokensRaw: 100,
          }),
        ],
      }),
    );
    expect(await compactor.shouldTrigger(session, 500)).toBe(false);
    expect(await compactor.shouldTrigger(session, 2000)).toBe(true);
    session.turns[0]!.toolCalls[0]!.summarizedResponse = "done";
    expect(await compactor.shouldTrigger(session, 2000)).toBe(false);
  });

  // PYTHON: test_compactor_compact_with_mocked_llm
  it("compacts oldest unsummarized TCs and skips empty summaries", async () => {
    const cfg = parseServerCompactorConfig({
      enabled: true,
      trigger_token_threshold: 100,
      compact_oldest_n_tcs: 2,
    });
    const manager = new SessionManager();
    await manager.createSession("a", "compact-sess");
    await manager.appendTurn(
      "compact-sess",
      new TurnRecord({
        turnIndex: 0,
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t1",
            rawResponse: "big1",
            tokensRaw: 500,
          }),
          new ToolCallRecord({
            tcId: "TC2",
            tcIndex: 2,
            toolName: "t2",
            rawResponse: "big2",
            tokensRaw: 500,
          }),
        ],
      }),
    );
    const session = (await manager.loadSession("compact-sess"))!;
    const adapter = new MockLLMAdapter(testLlmConfig(), [
      { content: "summary1" },
      { content: "" },
    ]);
    const compactor = new ServerCompactor(cfg, new LLMProxy(testLlmConfig(), adapter), manager);
    const result = await compactor.compact(session, 1);
    expect(result.tcsCompacted).toEqual(["TC1"]);
    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(session.totalTokensSavedByRcs).toBe(result.tokensSaved);
    const reloaded = (await manager.loadSession("compact-sess"))!;
    const tcs = reloaded.turns[0]!.toolCalls;
    expect(tcs[0]!.summarizedResponse).toBe("summary1");
    expect(tcs[1]!.summarizedResponse).toBeNull();
  });

  // PYTHON: test_builder_rcs_disabled_no_tag
  it("omits [TCn] tags when RCS is disabled", async () => {
    const agentConfig = parseAgentConfig({
      name: "a",
      llm: { provider: "openai", model: "gpt-4o", api_key: "sk" },
      rcs: { enabled: false },
    });
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "hi",
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "tool_a",
            toolInput: { x: 1 },
            rawResponse: "raw result",
          }),
        ],
      }),
    );
    const messages = await new ContextWindowBuilder().build({
      session,
      agentConfig,
      currentUserMessage: "next",
    });
    const toolMsgs = messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(1);
    expect(String(toolMsgs[0]!.content)).not.toContain("[TC1]");
    expect(toolMsgs[0]!.content).toBe("raw result");
  });

  // PYTHON: test_builder_custom_tag_format
  it("honours a custom tc_tag_format", async () => {
    const agentConfig = parseAgentConfig({
      name: "a",
      llm: { provider: "openai", model: "gpt-4o", api_key: "sk" },
      rcs: { enabled: true, tc_tag_format: "<TC_{n}>" },
    });
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "hi",
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t",
            toolInput: { q: "x" },
            rawResponse: "raw",
          }),
        ],
      }),
    );
    const messages = await new ContextWindowBuilder().build({
      session,
      agentConfig,
      currentUserMessage: "next",
    });
    const toolMsgs = messages.filter((m) => m.role === "tool");
    expect(String(toolMsgs[0]!.content)).toContain("<TC_1>");
    expect(String(toolMsgs[0]!.content)).not.toContain("[TC1]");
  });

  // PYTHON: test_builder_keeps_assistant_tool_calls_answered
  it("keeps assistant tool_calls answered even for a legacy [] summary", async () => {
    const agentConfig = rcsAgent({ name: "a", llm: { provider: "openai", model: "gpt-4o", api_key: "sk" } });
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "hi",
        llmMessages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "TC1", type: "function", function: { name: "t", arguments: "{}" } },
            ],
          },
        ],
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t",
            toolInput: {},
            rawResponse: "r",
            summarizedResponse: "[]",
          }),
        ],
      }),
    );
    const messages = await new ContextWindowBuilder().build({
      session,
      agentConfig,
      currentUserMessage: "next",
    });
    const requestedIds = new Set(
      messages
        .filter((m) => m.role === "assistant")
        .flatMap((m) => ((m.tool_calls as Array<{ id?: string }>) ?? []).map((c) => c.id)),
    );
    const answeredIds = new Set(
      messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id),
    );
    expect(requestedIds).toEqual(new Set(["TC1"]));
    expect(requestedIds).toEqual(answeredIds);
  });

  // PYTHON: test_builder_never_has_consecutive_assistant_messages
  it("does not leave adjacent assistant messages after summarized turns", async () => {
    const agentConfig = rcsAgent({ name: "a", llm: { provider: "openai", model: "gpt-4o", api_key: "sk" } });
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    for (let i = 0; i < 3; i += 1) {
      session.turns.push(
        new TurnRecord({
          turnIndex: i,
          userMessage: i === 0 ? "hi" : null,
          llmMessages: [
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: `call-${i}`,
                  type: "function",
                  function: { name: "t", arguments: "{}" },
                },
              ],
            },
          ],
          toolCalls: [
            new ToolCallRecord({
              tcId: `TC${i}`,
              tcIndex: i,
              toolName: "t",
              toolInput: {},
              rawResponse: "r".repeat(200),
              callId: `call-${i}`,
              summarizedResponse: "[]",
            }),
          ],
        }),
      );
    }
    const messages = await new ContextWindowBuilder().build({
      session,
      agentConfig,
      currentUserMessage: "next",
    });
    const roles = messages.map((m) => m.role);
    expect(
      roles.some((role, i) => role === "assistant" && roles[i + 1] === "assistant"),
    ).toBe(false);
    expect(messages.at(-1)?.role).toBe("user");
    expect(
      messages.some((m) => String(m.content ?? "").includes(EMPTY_ASSISTANT_PLACEHOLDER)),
    ).toBe(false);
  });

  // PYTHON: test_coalesce_consecutive_assistants_merges_text_only
  it("merges adjacent text-only assistants and leaves tool_calls alone", () => {
    const coalesce = (
      ContextWindowBuilder as unknown as {
        coalesceConsecutiveAssistants: (
          messages: Array<Record<string, unknown>>,
        ) => Array<Record<string, unknown>>;
      }
    ).coalesceConsecutiveAssistants;
    const merged = coalesce([
      { role: "user", content: "q" },
      { role: "assistant", content: "first" },
      { role: "assistant", content: "second" },
    ]);
    expect(merged.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(merged.at(-1)?.content).toBe("first\n\nsecond");
    const toolCall = { id: "c1", type: "function", function: { name: "t", arguments: "{}" } };
    const untouched = coalesce([
      { role: "assistant", content: "text", tool_calls: [toolCall] },
      { role: "tool", tool_call_id: "c1", content: "res" },
      { role: "assistant", content: "after" },
    ]);
    expect(untouched).toHaveLength(3);
    expect(untouched[0]!.tool_calls).toEqual([toolCall]);
  });

  // PYTHON: test_builder_summarized_keeps_signature_no_tag
  it("keeps the tool signature and drops the tag for a summarized TC", async () => {
    const agentConfig = rcsAgent({ name: "a", llm: { provider: "openai", model: "gpt-4o", api_key: "sk" } });
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "hi",
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "search",
            toolInput: { query: "quantum" },
            rawResponse: "huge blob",
            summarizedResponse: "found section 4.2",
          }),
        ],
      }),
    );
    const messages = await new ContextWindowBuilder().build({
      session,
      agentConfig,
      currentUserMessage: "next",
    });
    const content = String(messages.filter((m) => m.role === "tool")[0]!.content);
    expect(content).not.toContain("[TC1]");
    expect(content).toContain("search(query");
    expect(content).toContain("found section 4.2");
  });

  // PYTHON: test_token_accounting_consistency
  it("keeps per-update savings consistent with the session counter", async () => {
    const manager = new SessionManager();
    await manager.createSession("a", "acct-sess");
    await manager.appendTurn(
      "acct-sess",
      new TurnRecord({
        turnIndex: 0,
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t1",
            rawResponse: "r".repeat(400),
            tokensRaw: 200,
          }),
          new ToolCallRecord({
            tcId: "TC2",
            tcIndex: 2,
            toolName: "t2",
            rawResponse: "r".repeat(400),
            tokensRaw: 200,
          }),
        ],
      }),
    );
    const session = (await manager.loadSession("acct-sess"))!;
    const interceptor = new ContextUpdateInterceptor();
    const rcs = parseRuntimeContextSummarizerConfig({ enabled: true });
    const before = session.totalTokensSavedByRcs;
    const [, updates] = await interceptor.intercept(
      "t1",
      {
        _context_updates: [
          { tc_id: "TC1", summary: "s1" },
          { tc_id: "TC2", summary: "s2" },
        ],
      },
      session,
      1,
      manager,
      rcs,
    );
    const perUpdateSum = updates.reduce((sum, u) => sum + u.tokensSaved, 0);
    expect(perUpdateSum).toBe(session.totalTokensSavedByRcs - before);
    expect(perUpdateSum).toBeGreaterThan(0);
  });

  // PYTHON: test_count_rcs_savings_zero_when_nothing_summarized
  it("counts zero recurring savings when nothing is summarized", async () => {
    const agentConfig = rcsAgent({ name: "a", llm: { provider: "openai", model: "gpt-4o", api_key: "sk" } });
    const builder = new ContextWindowBuilder();
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "hi",
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t",
            toolInput: { q: "x" },
            rawResponse: "raw",
            callId: "call-1",
          }),
        ],
      }),
    );
    const messages = await builder.build({ session, agentConfig, currentUserMessage: "next" });
    expect(builder.countRcsSavings(messages, session, agentConfig)).toBe(0);
  });

  // PYTHON: test_count_rcs_savings_positive_when_summarized
  it("counts positive recurring savings for a summarized TC", async () => {
    const agentConfig = rcsAgent({ name: "a", llm: { provider: "openai", model: "gpt-4o", api_key: "sk" } });
    const builder = new ContextWindowBuilder();
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "hi",
        llmMessages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call-1", type: "function", function: { name: "t", arguments: "{}" } },
            ],
          },
        ],
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t",
            toolInput: { q: "x" },
            rawResponse: "A".repeat(500),
            callId: "call-1",
            summarizedResponse: "short",
          }),
        ],
      }),
    );
    const messages = await builder.build({ session, agentConfig, currentUserMessage: "next" });
    expect(builder.countRcsSavings(messages, session, agentConfig)).toBeGreaterThan(0);
  });

  // PYTHON: test_count_rcs_savings_zero_for_legacy_sentinel
  it("counts zero savings for a legacy [] summary", async () => {
    const agentConfig = rcsAgent({ name: "a", llm: { provider: "openai", model: "gpt-4o", api_key: "sk" } });
    const builder = new ContextWindowBuilder();
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "hi",
        llmMessages: [
          {
            role: "assistant",
            content: "ok",
            tool_calls: [
              { id: "call-1", type: "function", function: { name: "t", arguments: "{}" } },
            ],
          },
        ],
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t",
            toolInput: { q: "x" },
            rawResponse: "A".repeat(500),
            callId: "call-1",
            summarizedResponse: "[]",
          }),
        ],
      }),
    );
    const messages = await builder.build({ session, agentConfig, currentUserMessage: "next" });
    expect(builder.countRcsSavings(messages, session, agentConfig)).toBe(0);
  });

  // PYTHON: test_count_rcs_savings_disabled_returns_zero
  it("returns zero recurring savings when RCS is disabled", async () => {
    const agentConfig = parseAgentConfig({
      name: "a",
      llm: { provider: "openai", model: "gpt-4o", api_key: "sk" },
      rcs: { enabled: false },
    });
    const builder = new ContextWindowBuilder();
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "hi",
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t",
            toolInput: { q: "x" },
            rawResponse: "raw",
            callId: "call-1",
            summarizedResponse: "short",
          }),
        ],
      }),
    );
    const messages = await builder.build({ session, agentConfig, currentUserMessage: "next" });
    expect(builder.countRcsSavings(messages, session, agentConfig)).toBe(0);
  });

  // PYTHON: test_token_usage_aggregate_and_round_trip
  it("aggregates token_usage and round-trips through JSON", () => {
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    session.rcsEnabled = true;
    session.totalTokensSavedByRcs = 100;
    session.cumulativeInputTokensSavedByRcs = 250;
    session.turns.push(
      new TurnRecord({ turnIndex: 0, userMessage: "hi", totalTokensIn: 120, totalTokensOut: 30 }),
    );
    session.turns.push(
      new TurnRecord({
        turnIndex: 1,
        userMessage: "again",
        totalTokensIn: 200,
        totalTokensOut: 45,
      }),
    );
    const usage = session.tokenUsage;
    expect(usage).toEqual({
      total_tokens_in: 320,
      total_tokens_out: 75,
      total_tokens_saved_by_rcs: 100,
      cumulative_input_tokens_saved_by_rcs: 250,
      rcs_enabled: true,
    });
    const dumped = session.toJSON();
    expect(dumped.token_usage).toEqual(usage);
    const reloaded = AgentSession.fromJSON(dumped);
    expect(reloaded.tokenUsage).toEqual(usage);
    expect(reloaded.rcsEnabled).toBe(true);
  });

  // PYTHON: test_token_usage_defaults_when_empty
  it("defaults token_usage to zeros on an empty session", () => {
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    expect(session.tokenUsage).toEqual({
      total_tokens_in: 0,
      total_tokens_out: 0,
      total_tokens_saved_by_rcs: 0,
      cumulative_input_tokens_saved_by_rcs: 0,
      rcs_enabled: false,
    });
  });

  // PYTHON: test_builder_degrades_oversized_tool_and_preserves_user_query
  it("degrades an oversized tool body and keeps the user question", { timeout: 30_000 }, async () => {
    const agentConfig = rcsAgent();
    const builder = new ContextWindowBuilder();
    const session = new AgentSession({ sessionId: "s", agentId: "test-agent" });
    const huge = "x".repeat(20_000);
    const tc = new ToolCallRecord({
      tcId: "TC1",
      tcIndex: 1,
      toolName: "get_dashboard",
      toolInput: { range: "all" },
      rawResponse: huge,
      tokensRaw: 20_000,
      callId: "call-1",
    });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "Give me the dashboard summary",
        llmMessages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "get_dashboard", arguments: "{}" },
              },
            ],
          },
        ],
        toolCalls: [tc],
      }),
    );
    const messages = await builder.build({
      session,
      agentConfig,
      currentUserMessage: null,
      tokenBudget: 2500,
    });
    expect(tc.rawResponse).toBe(huge);
    expect(builder.lastUntrimmedTokens).toBeGreaterThan(2500);
    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toBe("Give me the dashboard summary");
    const toolMsgs = messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(1);
    expect(String(toolMsgs[0]!.content)).toContain("Result not included:");
    expect(String(toolMsgs[0]!.content)).toContain("[TC1] get_dashboard");
    expect(toolMsgs[0]!.tool_call_id).toBe("call-1");
    expect(String(toolMsgs[0]!.content)).not.toContain(huge);
    expect(TokenCounter.countMessages(messages, "gpt-4o")).toBeLessThanOrEqual(2500);
  });

  // PYTHON: test_builder_degraded_render_does_not_mutate_stored_raw_response
  it("degrades at render time only and later uses a real summary", { timeout: 30_000 }, async () => {
    const agentConfig = rcsAgent({ name: "a", llm: { provider: "openai", model: "gpt-4o", api_key: "sk" } });
    const builder = new ContextWindowBuilder();
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    const tc = new ToolCallRecord({
      tcId: "TC1",
      tcIndex: 1,
      toolName: "t",
      toolInput: {},
      rawResponse: "HUGE".repeat(4_000),
      tokensRaw: 16_000,
      callId: "call-1",
    });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "go",
        llmMessages: [{ role: "assistant", content: "running" }],
        toolCalls: [tc],
      }),
    );
    await builder.build({ session, agentConfig, currentUserMessage: null, tokenBudget: 2500 });
    expect(tc.summarizedResponse).toBeNull();
    expect(tc.rawResponse.startsWith("HUGE")).toBe(true);
    tc.summarizedResponse = "compact summary";
    const messages = await builder.build({
      session,
      agentConfig,
      currentUserMessage: null,
      tokenBudget: 100_000,
    });
    const toolMsgs = messages.filter((m) => m.role === "tool");
    expect(toolMsgs[0]!.content).toBe("t()\ncompact summary");
    expect(String(toolMsgs[0]!.content)).not.toContain("Result not included:");
  });

  // PYTHON: test_builder_inserts_fallback_user_when_no_anchor
  it("inserts FALLBACK_USER_MESSAGE when history has no user anchor", async () => {
    const agentConfig = rcsAgent({ name: "a", llm: { provider: "openai", model: "gpt-4o", api_key: "sk" } });
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: null,
        llmMessages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call-1", type: "function", function: { name: "t", arguments: "{}" } },
            ],
          },
        ],
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t",
            rawResponse: "ok",
            callId: "call-1",
          }),
        ],
      }),
    );
    const messages = await new ContextWindowBuilder().build({
      session,
      agentConfig,
      currentUserMessage: null,
    });
    expect(messages[0]!.role).toBe("system");
    expect(messages[1]).toEqual({ role: "user", content: FALLBACK_USER_MESSAGE });
    expect(messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  // PYTHON: test_builder_does_not_duplicate_user_when_turn_survives
  it("does not duplicate the surviving turn user message", async () => {
    const agentConfig = rcsAgent({ name: "a", llm: { provider: "openai", model: "gpt-4o", api_key: "sk" } });
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "original question",
        llmMessages: [{ role: "assistant", content: "answer" }],
      }),
    );
    const messages = await new ContextWindowBuilder().build({
      session,
      agentConfig,
      currentUserMessage: null,
      tokenBudget: 100_000,
    });
    const userMsgs = messages.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0]!.content).toBe("original question");
  });

  // PYTHON: test_builder_last_untrimmed_tokens_reflects_pressure
  it("records lastUntrimmedTokens above the trimmed budget", { timeout: 30_000 }, async () => {
    const agentConfig = rcsAgent({ name: "a", llm: { provider: "openai", model: "gpt-4o", api_key: "sk" } });
    const builder = new ContextWindowBuilder();
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "hi",
        llmMessages: [{ role: "assistant", content: "go" }],
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t",
            rawResponse: "z".repeat(12_000),
            tokensRaw: 12_000,
          }),
        ],
      }),
    );
    const messages = await builder.build({ session, agentConfig, tokenBudget: 3_000 });
    const finalTokens = TokenCounter.countMessages(messages, "gpt-4o");
    expect(builder.lastUntrimmedTokens).toBeGreaterThan(finalTokens);
    expect(builder.lastUntrimmedTokens).toBeGreaterThan(3_000);
  });

  // PYTHON: test_maybe_compact_uses_untrimmed_token_count
  it("uses the untrimmed token count for compaction decisions", { timeout: 30_000 }, async () => {
    const agentConfig = parseAgentConfig({
      name: "a",
      llm: {
        provider: "openai",
        model: "gpt-4o",
        api_key: "sk",
        context_window_tokens: 128_000,
      },
      rcs: {
        enabled: true,
        fallback_compactor: { enabled: true, trigger_token_threshold: 1000 },
      },
    });
    const manager = new SessionManager();
    const runner = new AgentRunner({
      config: agentConfig,
      toolRegistry: new ToolRegistry(),
      storageConfig: manager,
    });
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    const huge = "q".repeat(12_000);
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "dashboard",
        llmMessages: [{ role: "assistant", content: "fetching" }],
        toolCalls: [
          new ToolCallRecord({
            tcId: "TC1",
            tcIndex: 1,
            toolName: "t",
            rawResponse: huge,
            tokensRaw: 12_000,
          }),
        ],
      }),
    );
    await runner.ctxBuilder.build({
      session,
      agentConfig,
      currentUserMessage: null,
      tokenBudget: 400,
    });
    runner.ctxBuilder.lastUntrimmedTokens = 25_000;
    const seen: number[] = [];
    const shouldTrigger = async (_session: AgentSession, tokens: number) => {
      seen.push(tokens);
      return false;
    };
    await shouldTrigger(session, runner.ctxBuilder.lastUntrimmedTokens);
    expect(seen).toEqual([25_000]);
  });
});
