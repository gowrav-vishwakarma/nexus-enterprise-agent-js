/** Ports of Python tests/test_stateful_agents.py — durable state, HITL, turn-end hooks. */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockLLMAdapter } from "../src/eval/mock-llm.js";
import type { TurnContext, TurnDecision } from "../src/runner/hooks.js";
import { AgentSession } from "../src/session/models.js";
import { SessionManager } from "../src/session/manager.js";
import { SQLiteStorageAdapter } from "../src/session/adapters/sqlite.js";
import { createRunContext } from "../src/tools/context.js";
import { defineTool } from "../src/tools/decorators.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { collectStream, makeRunner, testAgentConfig, testLlmConfig } from "./helpers.js";

const markEscalated = defineTool((ctx: { setState: (key: string, value: unknown) => void }) => {
  ctx.setState("escalated", true);
  return "marked";
}, { name: "mark_escalated" });

function usage(promptTokens: number, completionTokens: number) {
  return { promptTokens, completionTokens };
}

function toolThenDone() {
  return [
    {
      content: "Checking.",
      toolCalls: [{ id: "c1", name: "global.mark_escalated", arguments: {} }],
      usage: usage(4, 2),
      finishReason: "tool_calls",
    },
    { content: "All set.", usage: usage(5, 3), finishReason: "stop" },
  ];
}

describe("stateful agents", () => {
  // PYTHON: test_state_survives_second_run
  it("keeps session state across a second runner", async () => {
    const registry = new ToolRegistry();
    registry.registerTool(markEscalated);
    const manager = new SessionManager();
    const { runner } = makeRunner({
      registry,
      sessionManager: manager,
      adapter: new MockLLMAdapter(testLlmConfig(), [
        ...toolThenDone(),
        { content: "Done.", usage: usage(5, 3) },
      ]),
      config: testAgentConfig({ name: "state-agent" }),
    });

    const r1 = await runner.run("go", { sessionId: "state-s1" });
    expect(r1.status).toBe("completed");
    expect(r1.state?.escalated).toBe(true);

    const { runner: runner2 } = makeRunner({
      registry,
      sessionManager: manager,
      adapter: new MockLLMAdapter(testLlmConfig(), [{ content: "again" }]),
      config: testAgentConfig({ name: "state-agent" }),
    });
    const r2 = await runner2.run("follow up", { sessionId: "state-s1" });
    expect(r2.state?.escalated).toBe(true);
  });

  // PYTHON: test_initial_context_seeds_state_run_and_stream
  it("seeds state from initialContext in run and runStream", async () => {
    const manager = new SessionManager();
    const { runner } = makeRunner({
      sessionManager: manager,
      adapter: new MockLLMAdapter(testLlmConfig(), [{ content: "Done." }]),
      config: testAgentConfig({ name: "state-agent" }),
    });
    const r = await runner.run("hi", {
      sessionId: "seed-1",
      initialContext: { customer_id: "c-9" },
    });
    expect(r.state?.customer_id).toBe("c-9");

    const { runner: streamRunner } = makeRunner({
      sessionManager: manager,
      adapter: new MockLLMAdapter(testLlmConfig(), [{ content: "Done." }]),
      config: testAgentConfig({ name: "state-agent", stream_output: true }),
    });
    await collectStream(streamRunner, "again", {
      sessionId: "seed-2",
      initialContext: { plan_tier: "pro" },
    });
    const sess = await manager.loadSession("seed-2");
    expect(sess?.state.plan_tier).toBe("pro");
  });

  // PYTHON: test_state_not_persisted_when_should_persist_false
  it("does not persist state when the run context is a cron job", async () => {
    const registry = new ToolRegistry();
    registry.registerTool(markEscalated);
    const manager = new SessionManager();
    const { runner } = makeRunner({
      registry,
      sessionManager: manager,
      runContext: createRunContext({ isCron: true, sessionId: "cron-s1" }),
      adapter: new MockLLMAdapter(testLlmConfig(), [
        {
          content: "x",
          toolCalls: [{ id: "c1", name: "global.mark_escalated", arguments: {} }],
          usage: usage(1, 1),
          finishReason: "tool_calls",
        },
        { content: "Done.", usage: usage(5, 3) },
      ]),
      config: testAgentConfig({ name: "state-agent" }),
    });

    const result = await runner.run("cron job", { sessionId: "cron-s1" });
    expect(result.state?.escalated).toBe(true);

    const otherManager = new SessionManager();
    expect(await otherManager.loadSession("cron-s1")).toBeNull();
  });

  // PYTHON: test_human_in_loop_pauses_and_resume_continues
  it("pauses for human-in-the-loop and continues after resume", async () => {
    const manager = new SessionManager();
    const { runner } = makeRunner({
      sessionManager: manager,
      adapter: new MockLLMAdapter(testLlmConfig(), [{ content: "first reply" }]),
      config: testAgentConfig({
        name: "state-agent",
        turns: { human_in_loop_after_turns: 1 },
      }),
    });
    const paused = await runner.run("hello", { sessionId: "hitl-1" });
    expect(paused.status).toBe("paused");
    expect(paused.pendingInteractions?.some((p) => p.tool_name === "human_in_loop")).toBe(true);

    const { runner: runner2 } = makeRunner({
      sessionManager: manager,
      adapter: new MockLLMAdapter(testLlmConfig(), [{ content: "after human" }]),
      config: testAgentConfig({
        name: "state-agent",
        turns: { human_in_loop_after_turns: null },
      }),
    });
    const resumed = await runner2.resume("hitl-1", [{ tc_id: "HITL", content: "approved" }]);
    expect(resumed.status).toBe("completed");
  });

  // PYTHON: test_on_turn_end_stop_and_inject
  it("honors onTurnEnd inject/stop and swallows hook errors", async () => {
    const manager = new SessionManager();
    const decisions = [
      { action: "inject", message: "injected user line" } satisfies TurnDecision,
      null,
    ];
    const hook = async (_ctx: TurnContext) => decisions.shift() ?? null;

    const { runner, adapter } = makeRunner({
      sessionManager: manager,
      adapter: new MockLLMAdapter(testLlmConfig(), [
        { content: "one" },
        { content: "two" },
      ]),
      config: testAgentConfig({ name: "state-agent", turns: { max_turns: 5 } }),
    });
    runner.hooks.onTurnEnd = hook;

    const result = await runner.run("start", { sessionId: "hook-inject" });
    expect(result.finalResponse).toBe("two");
    expect(adapter.calls).toHaveLength(2);

    const { runner: runnerBad } = makeRunner({
      sessionManager: manager,
      adapter: new MockLLMAdapter(testLlmConfig(), [{ content: "Done." }]),
      config: testAgentConfig({ name: "state-agent" }),
    });
    runnerBad.hooks.onTurnEnd = async () => {
      throw new Error("boom");
    };
    const ok = await runnerBad.run("x", { sessionId: "hook-err" });
    expect(ok.status).toBe("completed");

    const { runner: stopRunner } = makeRunner({
      sessionManager: manager,
      adapter: new MockLLMAdapter(testLlmConfig(), [{ content: "Done." }]),
      config: testAgentConfig({ name: "state-agent" }),
    });
    stopRunner.hooks.onTurnEnd = async () => ({ action: "stop" });
    const stopped = await stopRunner.run("y", { sessionId: "hook-stop" });
    expect(stopped.status).toBe("interrupted");
  });

  // PYTHON: test_session_json_without_state_field_loads
  it("loads a session JSON document that has no state field", () => {
    const session = AgentSession.fromJSON({
      session_id: "legacy-1",
      agent_id: "a",
      turns: [],
    });
    expect(session.state).toEqual({});
  });

  // PYTHON: test_state_sqlite_round_trip
  it("round-trips session state through SQLite when @libsql/client is available", async () => {
    let adapter: SQLiteStorageAdapter;
    try {
      const dataRoot = await mkdtemp(join(tmpdir(), "nexus-state-sqlite-"));
      adapter = new SQLiteStorageAdapter({ data_root: dataRoot, tenant_scoped: true });
      await adapter.saveSession(
        new AgentSession({ sessionId: "_probe", agentId: "probe", tenantId: "t", userId: "u" }),
      );
    } catch (error) {
      if (String(error).includes("@libsql/client")) {
        return;
      }
      throw error;
    }

    const registry = new ToolRegistry();
    registry.registerTool(markEscalated);
    const manager = new SessionManager(adapter);
    const { runner } = makeRunner({
      registry,
      sessionManager: manager,
      adapter: new MockLLMAdapter(testLlmConfig(), [
        {
          content: "t",
          toolCalls: [{ id: "c1", name: "global.mark_escalated", arguments: {} }],
          usage: usage(1, 1),
          finishReason: "tool_calls",
        },
        { content: "Done." },
      ]),
      config: testAgentConfig({ name: "state-agent" }),
      runContext: createRunContext({ tenantId: "t", userId: "u", sessionId: "sqlite-state-1" }),
    });
    await runner.run("persist", { sessionId: "sqlite-state-1" });

    const loaded = await manager.loadSession("sqlite-state-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.state.escalated).toBe(true);
  });
});
