/** Ports of Python tests/test_runner.py — AgentRunner loop, stream, cancel. */

import { describe, expect, it } from "vitest";
import { MockLLMAdapter } from "../src/eval/mock-llm.js";
import { AgentRunner } from "../src/runner/agent-runner.js";
import { SessionManager } from "../src/session/manager.js";
import { defineTool } from "../src/tools/decorators.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { collectStream, makeRunner, testAgentConfig, testLlmConfig } from "./helpers.js";

const webSearch = defineTool((query: string) => `Search result for ${query}`, {
  name: "web_search",
});

const lookupDb = defineTool((table: string) => `DB row from ${table}`, {
  name: "lookup_db",
});

function usage(promptTokens: number, completionTokens: number) {
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

describe("AgentRunner", () => {
  // PYTHON: test_agent_runner_loop
  it("executes turns, calls tools, and returns results", async () => {
    const registry = new ToolRegistry();
    registry.registerTool(webSearch);
    const manager = new SessionManager();
    const adapter = new MockLLMAdapter(testLlmConfig(), [
      {
        content: "Let me look that up.",
        toolCalls: [{ id: "call-1", name: "global.web_search", arguments: { query: "weather" } }],
        usage: usage(10, 15),
        finishReason: "tool_calls",
      },
      {
        content: "It is sunny.",
        toolCalls: [],
        usage: usage(20, 5),
        finishReason: "stop",
      },
    ]);
    const { runner } = makeRunner({ registry, sessionManager: manager, adapter });

    const result = await runner.run("What is the weather?", { sessionId: "runner-sess-1" });

    expect(result.sessionId).toBe("runner-sess-1");
    expect(result.finalResponse).toBe("It is sunny.");
    expect(result.turnsUsed).toBe(2);
    expect(result.status).toBe("completed");
    expect(result.totalTokensIn).toBe(30);
    expect(result.totalTokensOut).toBe(20);

    const sess = await manager.loadSession("runner-sess-1");
    expect(sess).not.toBeNull();
    expect(sess!.turns).toHaveLength(2);
    expect(sess!.turns[0]!.userMessage).toBe("What is the weather?");
    expect(sess!.turns[0]!.toolCalls).toHaveLength(1);
    expect(sess!.turns[0]!.toolCalls[0]!.tcId).toMatch(/^TC\d+$/);
    expect(sess!.turns[0]!.toolCalls[0]!.toolName).toBe("global.web_search");
    expect(sess!.turns[0]!.toolCalls[0]!.rawResponse).toBe("Search result for weather");
    expect(sess!.turns[1]!.userMessage).toBeNull();
    expect(sess!.turns[1]!.toolCalls).toHaveLength(0);
  });

  // PYTHON: test_agent_runner_streaming_parity
  it("produces the same final result in streaming and blocking modes", async () => {
    const registry = new ToolRegistry();
    registry.registerTool(webSearch);

    const blockingResponses = [
      {
        content: "Let me look that up.",
        toolCalls: [{ id: "call-1", name: "global.web_search", arguments: { query: "weather" } }],
        usage: usage(10, 15),
        finishReason: "tool_calls",
      },
      {
        content: "It is sunny.",
        toolCalls: [],
        usage: usage(20, 5),
        finishReason: "stop",
      },
    ];
    const streamingResponses = [
      {
        content: "Let me look that up.",
        toolCalls: [{ id: "call-1", name: "global.web_search", arguments: { query: "weather" } }],
        usage: usage(10, 15),
        finishReason: "tool_calls",
        streamChunks: [
          { content: "Let me look that up." },
          {
            toolCalls: [
              {
                index: 0,
                id: "call-1",
                name: "global.web_search",
                arguments: '{"query": "weather"}',
              },
            ],
            finishReason: "tool_calls",
            usage: usage(10, 15),
          },
        ],
      },
      {
        content: "It is sunny.",
        usage: usage(20, 5),
        finishReason: "stop",
        streamChunks: [
          { content: "It is " },
          { content: "sunny.", finishReason: "stop", usage: usage(20, 5) },
        ],
      },
    ];

    const { runner: blocking } = makeRunner({
      registry,
      adapter: new MockLLMAdapter(testLlmConfig(), blockingResponses),
    });
    const { runner: streaming, manager: streamingManager } = makeRunner({
      registry,
      adapter: new MockLLMAdapter(testLlmConfig(), streamingResponses),
    });

    const blockingResult = await blocking.run("What is the weather?", {
      sessionId: "blocking-sess",
      stream: false,
    });
    const events = await collectStream(streaming, "What is the weather?", {
      sessionId: "streaming-sess",
    });
    const streamFinal = events.find((e) => e.eventType === "final_response");
    const streamingResult = streamFinal?.data as {
      finalResponse?: string;
      turnsUsed?: number;
      totalTokensIn?: number;
      totalTokensOut?: number;
    };

    expect(blockingResult.finalResponse).toBe("It is sunny.");
    expect(streamingResult.finalResponse).toBe("It is sunny.");
    expect(blockingResult.turnsUsed).toBe(2);
    expect(streamingResult.turnsUsed).toBe(2);
    expect(blockingResult.totalTokensIn).toBe(30);
    expect(streamingResult.totalTokensIn).toBe(30);
    expect(blockingResult.totalTokensOut).toBe(20);
    expect(streamingResult.totalTokensOut).toBe(20);

    const contentEvents = events.filter((e) => e.eventType === "content");
    expect(contentEvents.some((e) => e.content === "It is ")).toBe(true);
    expect(contentEvents.some((e) => e.content === "sunny.")).toBe(true);
    expect(contentEvents.some((e) => e.content === "Let me look that up.")).toBe(true);

    const toolCallEvents = events.filter((e) => e.eventType === "tool_call");
    expect(toolCallEvents).toHaveLength(1);
    expect(toolCallEvents[0]!.data?.toolName).toBe("global.web_search");

    const blockingSess = await blocking.sessionManager.loadSession("blocking-sess");
    const streamingSess = await streamingManager.loadSession("streaming-sess");
    expect(blockingSess?.turns).toHaveLength(2);
    expect(streamingSess?.turns).toHaveLength(2);
  });

  // PYTHON: test_agent_runner_stream_multi_turn_deltas_are_live
  it("streams every multi-turn delta in occurrence order", async () => {
    const registry = new ToolRegistry();
    registry.registerTool(webSearch);
    registry.registerTool(lookupDb);
    const adapter = new MockLLMAdapter(testLlmConfig(), [
      {
        content: "Searching weather...",
        toolCalls: [{ id: "call-1", name: "global.web_search", arguments: { query: "weather" } }],
        usage: usage(10, 8),
        streamChunks: [
          { content: "Searching weather..." },
          {
            toolCalls: [
              {
                index: 0,
                id: "call-1",
                name: "global.web_search",
                arguments: '{"query": "weather"}',
              },
            ],
            finishReason: "tool_calls",
            usage: usage(10, 8),
          },
        ],
      },
      {
        content: "Now checking database...",
        toolCalls: [{ id: "call-2", name: "global.lookup_db", arguments: { table: "forecasts" } }],
        usage: usage(15, 9),
        streamChunks: [
          { content: "Now checking database..." },
          {
            toolCalls: [
              {
                index: 0,
                id: "call-2",
                name: "global.lookup_db",
                arguments: '{"table": "forecasts"}',
              },
            ],
            finishReason: "tool_calls",
            usage: usage(15, 9),
          },
        ],
      },
      {
        content: "Weather is sunny and DB says clear.",
        usage: usage(20, 10),
        streamChunks: [
          { content: "Weather is " },
          {
            content: "sunny and DB says clear.",
            finishReason: "stop",
            usage: usage(20, 10),
          },
        ],
      },
    ]);
    const { runner, manager } = makeRunner({
      registry,
      adapter,
      config: testAgentConfig({ tool_plugins: ["global"] }),
    });

    const events = await collectStream(runner, "Full weather report?", {
      sessionId: "multi-tool-stream",
    });
    const final = events.find((e) => e.eventType === "final_response");
    const result = final?.data as { turnsUsed?: number; finalResponse?: string; status?: string };

    expect(result.turnsUsed).toBe(3);
    expect(result.finalResponse).toBe("Weather is sunny and DB says clear.");
    expect(result.status).toBe("completed");

    const contentEvents = events.filter((e) => e.eventType === "content");
    const toolCallEvents = events.filter((e) => e.eventType === "tool_call");
    const toolResultEvents = events.filter((e) => e.eventType === "tool_result");

    expect(toolCallEvents).toHaveLength(2);
    expect(toolResultEvents).toHaveLength(2);
    expect(toolCallEvents[0]!.data?.turnIndex).toBe(0);
    expect(toolCallEvents[0]!.data?.toolName).toBe("global.web_search");
    expect(toolCallEvents[1]!.data?.turnIndex).toBe(1);
    expect(toolCallEvents[1]!.data?.toolName).toBe("global.lookup_db");
    expect(toolResultEvents[0]!.data?.turnIndex).toBe(0);
    expect(toolResultEvents[0]!.content).toContain("Search result for weather");
    expect(toolResultEvents[1]!.data?.turnIndex).toBe(1);
    expect(toolResultEvents[1]!.content).toContain("DB row from forecasts");

    expect(contentEvents.map((e) => [e.data?.turnIndex, e.content])).toEqual([
      [0, "Searching weather..."],
      [1, "Now checking database..."],
      [2, "Weather is "],
      [2, "sunny and DB says clear."],
    ]);

    const timeline = events
      .filter((e) => ["tool_call", "tool_result", "content"].includes(e.eventType))
      .map((e) => [e.eventType, e.data?.turnIndex ?? null, e.content ?? null] as const);
    const order: Array<readonly [string, number, string | null]> = [
      ["content", 0, "Searching weather..."],
      ["tool_call", 0, null],
      ["tool_result", 0, "Search result for weather"],
      ["content", 1, "Now checking database..."],
      ["tool_call", 1, null],
      ["tool_result", 1, "DB row from forecasts"],
      ["content", 2, "Weather is "],
      ["content", 2, "sunny and DB says clear."],
    ];
    const indexes = order.map((step) =>
      timeline.findIndex(
        (row) => row[0] === step[0] && row[1] === step[1] && row[2] === step[2],
      ),
    );
    expect(indexes.every((i) => i >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));

    const sess = await manager.loadSession("multi-tool-stream");
    expect(sess?.turns).toHaveLength(3);
    expect(sess!.turns[0]!.toolCalls).toHaveLength(1);
    expect(sess!.turns[1]!.toolCalls).toHaveLength(1);
    expect(sess!.turns[2]!.toolCalls).toHaveLength(0);
  });

  // PYTHON: test_agent_runner_stream_reasoning_events_and_persistence
  it("streams reasoning as its own event type and persists it on the turn", async () => {
    const adapter = new MockLLMAdapter(testLlmConfig(), [
      {
        content: "It is sunny.",
        reasoning: "The user wants the weather.",
        usage: usage(10, 5),
        streamChunks: [
          { reasoning: "The user wants " },
          { reasoning: "the weather." },
          { content: "It is " },
          { content: "sunny.", finishReason: "stop", usage: usage(10, 5) },
        ],
      },
    ]);
    const { runner, manager } = makeRunner({ adapter });
    const events = await collectStream(runner, "What is the weather?", {
      sessionId: "reasoning-sess",
    });

    const reasoningEvents = events.filter((e) => e.eventType === "reasoning");
    const contentEvents = events.filter((e) => e.eventType === "content");
    expect(reasoningEvents.map((e) => e.content)).toEqual(["The user wants ", "the weather."]);
    expect(contentEvents.map((e) => e.content)).toEqual(["It is ", "sunny."]);
    expect(events.indexOf(reasoningEvents[reasoningEvents.length - 1]!)).toBeLessThan(
      events.indexOf(contentEvents[0]!),
    );

    const final = events.find((e) => e.eventType === "final_response");
    expect((final?.data as { finalResponse?: string }).finalResponse).toBe("It is sunny.");

    const sess = await manager.loadSession("reasoning-sess");
    expect(sess!.turns[0]!.reasoning).toBe("The user wants the weather.");
    expect(sess!.turns[0]!.llmMessages.every((m) => !("reasoning" in m))).toBe(true);
  });

  // PYTHON: test_agent_runner_xml_tool_call_in_content_promotes_and_executes
  it("promotes XML tool calls in assistant content and executes them", async () => {
    const executeSql = defineTool((sql: string) => `rows:1 sql_len=${sql.length}`, {
      name: "execute_sql",
    });
    const registry = new ToolRegistry();
    registry.registerTool(executeSql, null);
    const adapter = new MockLLMAdapter(testLlmConfig(), [
      {
        content:
          "Checking balances:\n<tool_call><function=execute_sql><parameter=sql>SELECT 1</parameter></function></tool_call>",
        toolCalls: [],
        usage: usage(10, 20),
        finishReason: "stop",
      },
      { content: "Done.", toolCalls: [], usage: usage(30, 5), finishReason: "stop" },
    ]);
    const { runner, manager } = makeRunner({ registry, adapter });

    const result = await runner.run("Show balances", { sessionId: "xml-sess" });
    expect(result.turnsUsed).toBe(2);

    const sess = await manager.loadSession("xml-sess");
    expect(sess!.turns[0]!.toolCalls).toHaveLength(1);
    expect(sess!.turns[0]!.toolCalls[0]!.toolName).toBe("execute_sql");
    const assistantMsg = sess!.turns[0]!.llmMessages[0]!;
    expect(String(assistantMsg.content ?? "")).not.toContain("<tool_call>");
    expect(assistantMsg.tool_calls).toBeTruthy();
  });

  // PYTHON: test_agent_runner_stream_mode_guard
  it("rejects the wrong run vs runStream mode", async () => {
    const streaming = new AgentRunner({
      config: testAgentConfig({ stream_output: true }),
      toolRegistry: new ToolRegistry(),
    });
    await expect(streaming.run("hello")).rejects.toThrow(/runStream/);

    const blocking = new AgentRunner({
      config: testAgentConfig({ stream_output: false }),
      toolRegistry: new ToolRegistry(),
    });
    await expect(async () => {
      for await (const _ of blocking.runStream("hello", { stream: false })) {
        void _;
      }
    }).rejects.toThrow(/run\(\)/);
  });

  // PYTHON: test_cancel_stops_between_turns
  it("stops the loop before the next LLM turn when a tool calls cancel()", async () => {
    const captured: { runner?: AgentRunner } = {};
    const slowOk = defineTool(() => {
      captured.runner?.cancel();
      return "ok";
    }, { name: "slow_ok" });
    const registry = new ToolRegistry();
    registry.registerTool(slowOk);
    const adapter = new MockLLMAdapter(testLlmConfig(), [
      {
        content: "calling",
        toolCalls: [{ id: "call-1", name: "global.slow_ok", arguments: {} }],
        usage: usage(1, 1),
        finishReason: "tool_calls",
      },
    ]);
    const { runner } = makeRunner({
      registry,
      adapter,
      config: testAgentConfig({ name: "cancel-agent" }),
    });
    captured.runner = runner;

    const result = await runner.run("go", { sessionId: "cancel-turns" });
    expect(result.status).toBe("interrupted");
    expect(adapter.calls).toHaveLength(1);
  });

  // PYTHON: test_cancel_stops_mid_stream
  it("drops further streamed content after cancel and marks interrupted", async () => {
    const adapter = new MockLLMAdapter(testLlmConfig(), [
      {
        content: "c0c1c2c3c4c5c6c7",
        usage: usage(1, 8),
        streamChunks: [
          ...Array.from({ length: 8 }, (_, i) => ({ content: `c${i}`, delayMs: 10 })),
          { finishReason: "stop", usage: usage(1, 8) },
        ],
      },
    ]);
    const { runner } = makeRunner({
      adapter,
      config: testAgentConfig({ name: "cancel-stream" }),
    });

    const events = [];
    for await (const event of runner.runStream("hello", {
      sessionId: "cancel-stream",
      stream: true,
    })) {
      events.push(event);
      if (event.eventType === "content" && events.filter((e) => e.eventType === "content").length >= 2) {
        runner.cancel();
      }
    }

    const content = events.filter((e) => e.eventType === "content");
    expect(content).toHaveLength(2);
    const cancelled = events.filter((e) => e.eventType === "event" && e.data?.cancelled);
    expect(cancelled.length).toBeGreaterThan(0);
    expect(cancelled[0]!.content).toBe("Run cancelled.");
    const final = events.find((e) => e.eventType === "final_response");
    expect(final?.data?.status).toBe("interrupted");

    const sess = await runner.sessionManager.loadSession("cancel-stream");
    if (sess) {
      for (const turn of sess.turns) {
        const dumped = JSON.stringify(turn.llmMessages);
        expect(dumped).not.toContain("c0");
        expect(dumped).not.toContain("c1");
      }
    }
  });

  // PYTHON: test_stream_seq_persists_on_session_and_continues
  it("continues stream_seq numbering across a new runner", async () => {
    const manager = new SessionManager();
    const chunked = {
      content: "hello",
      usage: usage(1, 1),
      streamChunks: [{ content: "hello" }, { finishReason: "stop", usage: usage(1, 1) }],
    };
    const { runner: runner1 } = makeRunner({
      sessionManager: manager,
      adapter: new MockLLMAdapter(testLlmConfig(), [chunked]),
      config: testAgentConfig({ name: "seq-agent" }),
    });
    const events1 = await collectStream(runner1, "hi", { sessionId: "seq-sess" });
    const lastSeq = Math.max(
      ...events1.filter((e) => e.data && "seq" in e.data).map((e) => Number(e.data!.seq)),
    );
    const sess = await manager.loadSession("seq-sess");
    expect(sess?.streamSeq).toBe(lastSeq);

    const { runner: runner2 } = makeRunner({
      sessionManager: manager,
      adapter: new MockLLMAdapter(testLlmConfig(), [chunked]),
      config: testAgentConfig({ name: "seq-agent" }),
    });
    const events2 = await collectStream(runner2, "again", { sessionId: "seq-sess" });
    const firstNew = Math.min(
      ...events2.filter((e) => e.data && "seq" in e.data).map((e) => Number(e.data!.seq)),
    );
    expect(firstNew).toBe(lastSeq + 1);
  });
});
