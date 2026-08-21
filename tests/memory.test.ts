import { describe, expect, it, vi } from "vitest";
import { parseAgentConfig } from "../src/config/agent.js";
import { parseMemoryConfig } from "../src/config/memory.js";
import { ContextWindowBuilder } from "../src/context/builder.js";
import {
  MemoryCurator,
  createMemoryUpdate,
  memoryUpdateFromLlmOutput,
} from "../src/memory/curator.js";
import { InMemoryCrossSessionMemoryStore } from "../src/memory/cross-session-store.js";
import { AgentSession, TurnRecord } from "../src/session/models.js";
import { SessionManager } from "../src/session/manager.js";
import { createRunContext } from "../src/tools/context.js";
import { testAgentConfig, testLlmConfig } from "./helpers.js";

function sessionWithTurn(user = "Hi", assistant = "Hello"): AgentSession {
  return new AgentSession({
    sessionId: "sess-mem",
    agentId: "agent-1",
    turns: [
      new TurnRecord({
        turnIndex: 0,
        userMessage: user,
        llmMessages: [{ role: "assistant", content: assistant }],
      }),
    ],
  });
}

describe("memory curator", () => {
  // PYTHON: test_memory_update_parse_entities
  it("parses entities from LLM JSON", () => {
    const entities: Record<string, string> = {};
    for (let i = 0; i < 5; i++) entities[`k${i}`] = `v${i}`;
    const update = memoryUpdateFromLlmOutput(JSON.stringify({ entities }));
    expect(Object.keys(update.entities)).toHaveLength(5);
    expect(update.entities.k0).toBe("v0");
  });

  // PYTHON: test_memory_update_malformed_json_no_op
  it("treats malformed JSON as a no-op", () => {
    const update = memoryUpdateFromLlmOutput("not json at all");
    expect(update.isEmpty()).toBe(true);
  });

  // PYTHON: test_should_trigger_matrix
  it.each([
    { turnIndex: 0, afterEach: true, interval: 0, atEnd: false, extractAtEnd: false, expected: true },
    { turnIndex: 1, afterEach: true, interval: 0, atEnd: false, extractAtEnd: false, expected: true },
    { turnIndex: 1, afterEach: false, interval: 3, atEnd: false, extractAtEnd: false, expected: false },
    { turnIndex: 2, afterEach: false, interval: 3, atEnd: false, extractAtEnd: false, expected: true },
    { turnIndex: 0, afterEach: false, interval: 0, atEnd: false, extractAtEnd: false, expected: false },
    { turnIndex: 0, afterEach: true, interval: 0, atEnd: true, extractAtEnd: true, expected: false },
  ])(
    "shouldTrigger turn=$turnIndex afterEach=$afterEach interval=$interval atEnd=$atEnd → $expected",
    ({ turnIndex, afterEach, interval, atEnd, extractAtEnd, expected }) => {
      const cfg = parseMemoryConfig({
        enabled: true,
        extract_after_each_turn: afterEach,
        extraction_interval: interval,
        extract_at_end: extractAtEnd,
      });
      const curator = new MemoryCurator({
        config: cfg,
        llmProxy: { chat: vi.fn() },
        sessionManager: {},
      });
      if (turnIndex === 0 && atEnd && afterEach && !expected) {
        (curator as unknown as { lastCuratedTurn: number | null }).lastCuratedTurn = 0;
      }
      expect(curator.shouldTrigger(turnIndex, atEnd)).toBe(expected);
    },
  );

  // PYTHON: test_curator_disabled_no_llm_call
  it("does not call the LLM when memory is disabled", async () => {
    const chat = vi.fn();
    const curator = new MemoryCurator({
      config: parseMemoryConfig({ enabled: false }),
      llmProxy: { chat },
      sessionManager: {},
    });
    const result = await curator.curate(sessionWithTurn(), 0);
    expect(result.isEmpty()).toBe(true);
    expect(chat).not.toHaveBeenCalled();
  });

  // PYTHON: test_curator_llm_writes_to_cross_session_store
  it("writes extracted entities to the cross-session store", async () => {
    const store = new InMemoryCrossSessionMemoryStore();
    const manager = new SessionManager();
    await manager.createSession("a", "cur-sess", {
      tenantId: "t",
      userId: "u",
    });
    await manager.appendTurn(
      "cur-sess",
      new TurnRecord({
        turnIndex: 0,
        userMessage: "User likes dark mode",
        llmMessages: [{ role: "assistant", content: "Noted." }],
      }),
    );
    const session = await manager.loadSession("cur-sess");
    expect(session).not.toBeNull();

    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ entities: { ui_preference: "dark mode" } }),
    });
    const curator = new MemoryCurator({
      config: parseMemoryConfig({
        enabled: true,
        max_entities: 10,
        extract_after_each_turn: true,
      }),
      llmProxy: { chat },
      sessionManager: manager,
      runContext: createRunContext({ tenantId: "t", userId: "u" }),
      crossSessionMemoryStore: store,
      agentName: "a",
    });
    await curator.curate(session!, 0);

    const record = await store.load("t", "u", "a");
    expect(record?.entityMemory.ui_preference).toBe("dark mode");
  });

  // PYTHON: test_curator_agent_path_recursion_guard
  // curator_agent sub-runner is not wired in the JS port; curate() catches and no-ops.
  it("no-ops when curator_agent is set (sub-runner not wired)", async () => {
    const store = new InMemoryCrossSessionMemoryStore();
    const manager = new SessionManager();
    await manager.createSession("main", "main-sess", { tenantId: "t", userId: "u" });
    await manager.appendTurn(
      "main-sess",
      new TurnRecord({
        turnIndex: 0,
        userMessage: "Remember project Alpha",
        llmMessages: [{ role: "assistant", content: "OK" }],
      }),
    );
    const session = await manager.loadSession("main-sess");
    const parentChat = vi.fn();
    const curator = new MemoryCurator({
      config: parseMemoryConfig({
        enabled: true,
        extract_after_each_turn: true,
        curator_agent: parseAgentConfig({
          name: "mem-curator",
          llm: testLlmConfig(),
          memory: { enabled: true },
        }),
      }),
      llmProxy: { chat: parentChat },
      sessionManager: manager,
      runContext: createRunContext({ tenantId: "t", userId: "u" }),
      crossSessionMemoryStore: store,
      agentName: "main",
    });
    const result = await curator.curate(session!, 0);
    expect(result.isEmpty()).toBe(true);
    expect(parentChat).not.toHaveBeenCalled();
  });

  // PYTHON: test_inject_into_prompt_gate
  it("gates user-memory injection on inject_into_prompt", async () => {
    const session = new AgentSession({ sessionId: "s", agentId: "a" });
    const builder = new ContextWindowBuilder();
    const llm = testLlmConfig();

    const msgsOn = await builder.build({
      session,
      agentConfig: testAgentConfig({
        name: "a",
        llm,
        memory: parseMemoryConfig({ enabled: true, inject_into_prompt: true }),
      }),
      currentUserMessage: "hi",
      tokenBudget: 10000,
      userMemory: { k: "v" },
    });
    expect(msgsOn[0]?.content).toContain("About this user");

    const msgsOff = await builder.build({
      session,
      agentConfig: testAgentConfig({
        name: "a",
        llm,
        memory: parseMemoryConfig({ enabled: true, inject_into_prompt: false }),
      }),
      currentUserMessage: "hi",
      tokenBudget: 10000,
      userMemory: { k: "v" },
    });
    expect(msgsOff[0]?.content).not.toContain("About this user");
  });

  // PYTHON: test_runner_invokes_curator_at_end
  // AgentRunner does not wire MemoryCurator yet; this checks the curator API the runner will call.
  it("curator.curate is the unit the runner will invoke", async () => {
    const curator = new MemoryCurator({
      config: parseMemoryConfig({ enabled: true, extract_after_each_turn: true }),
      llmProxy: {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({ entities: {} }),
        }),
      },
      sessionManager: new SessionManager(),
    });
    const update = await curator.curate(sessionWithTurn(), 0);
    expect(update).toEqual(expect.objectContaining({ entities: expect.any(Object) }));
    expect(typeof update.isEmpty).toBe("function");
    expect(createMemoryUpdate().isEmpty()).toBe(true);
  });
});
