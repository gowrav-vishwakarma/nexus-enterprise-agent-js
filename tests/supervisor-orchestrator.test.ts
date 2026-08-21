import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAgentConfig, parseAgentGroupConfig } from "../src/config/agent.js";
import { CustomCallbackSink, NexusEventEmitter } from "../src/events/emitter.js";
import { NexusEventType } from "../src/events/models.js";
import { createLLMResponse } from "../src/llm/response.js";
import { AgentOrchestrator } from "../src/multiagent/orchestrator.js";
import type { AgentRunResult } from "../src/runner/result.js";
import { AgentRunner } from "../src/runner/agent-runner.js";
import { SessionManager } from "../src/session/manager.js";
import { createRunContext } from "../src/tools/context.js";
import { defineTool } from "../src/tools/decorators.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { orchInternals, runnerInternals } from "./helpers.js";

function llmAgent(name: string, opts: { toolset?: string | null } = {}) {
  return parseAgentConfig({
    name,
    llm: { provider: "openai", model: "gpt-4o-mini", api_key: "sk-test" },
    persona: { role: name, goal: "work" },
    toolset: opts.toolset ?? null,
  });
}

const supportLookup = defineTool((query: string) => `Support: ${query}`, {
  name: "support_lookup",
  description: "Look up support info.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
});

const oneTurn: AgentRunResult = {
  sessionId: "s",
  finalResponse: "step done",
  turnsUsed: 1,
  status: "completed",
  durationMs: 1,
};

describe("supervisor orchestrator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // PYTHON: test_members_default_to_subagent_run_context
  it("defaults members to subagent run context", () => {
    const group = parseAgentGroupConfig({
      name: "team",
      pattern: "pipeline",
      members: [llmAgent("a"), llmAgent("b")],
    });
    const orch = new AgentOrchestrator({
      config: group,
      storageConfig: new SessionManager(),
      runContext: createRunContext({ sessionId: "g1" }),
    });
    const members = orchInternals(orch).members;
    expect((members.get("a") as AgentRunner).runContext.isSubagent).toBe(true);
    expect((members.get("b") as AgentRunner).runContext.isSubagent).toBe(true);
  });

  // PYTHON: test_persist_members_opt_in
  it("opts members out of subagent when persist_members is true", () => {
    const group = parseAgentGroupConfig({
      name: "team",
      pattern: "pipeline",
      persist_members: true,
      members: [llmAgent("a")],
    });
    const orch = new AgentOrchestrator({
      config: group,
      storageConfig: new SessionManager(),
      runContext: createRunContext({ sessionId: "g1" }),
    });
    expect((orchInternals(orch).members.get("a") as AgentRunner).runContext.isSubagent).toBe(
      false,
    );
  });

  // PYTHON: test_select_supervisor_explicit
  it("selects an explicit supervisor", () => {
    const group = parseAgentGroupConfig({
      name: "team",
      pattern: "supervisor",
      supervisor: "lead",
      members: [llmAgent("lead"), llmAgent("worker")],
    });
    const orch = new AgentOrchestrator({
      config: group,
      runContext: createRunContext({ sessionId: "g1" }),
    });
    const { name, error } = orchInternals(orch).selectSupervisor();
    expect(error).toBeNull();
    expect(name).toBe("lead");
  });

  // PYTHON: test_select_supervisor_invalid_explicit
  it("rejects an explicit supervisor that is not a member", () => {
    const group = parseAgentGroupConfig({
      name: "team",
      pattern: "supervisor",
      supervisor: "missing",
      members: [llmAgent("lead")],
    });
    const orch = new AgentOrchestrator({
      config: group,
      runContext: createRunContext({ sessionId: "g1" }),
    });
    const { name, error } = orchInternals(orch).selectSupervisor();
    expect(name).toBeNull();
    expect(error ?? "").toMatch(/not a group member/);
  });

  // PYTHON: test_select_supervisor_heuristic
  it("heuristically selects a member whose name includes supervisor", () => {
    const group = parseAgentGroupConfig({
      name: "team",
      pattern: "supervisor",
      members: [llmAgent("worker"), llmAgent("team_supervisor")],
    });
    const orch = new AgentOrchestrator({
      config: group,
      runContext: createRunContext({ sessionId: "g1" }),
    });
    const { name, error } = orchInternals(orch).selectSupervisor();
    expect(error).toBeNull();
    expect(name).toBe("team_supervisor");
  });

  // PYTHON: test_pipeline_respects_group_max_turns
  it("stops a pipeline when the group max_turns budget is used", async () => {
    const group = parseAgentGroupConfig({
      name: "pipe",
      pattern: "pipeline",
      max_turns: 1,
      members: [llmAgent("first"), llmAgent("second")],
    });
    const orch = new AgentOrchestrator({
      config: group,
      storageConfig: new SessionManager(),
      runContext: createRunContext({ sessionId: "pipe-1" }),
    });
    const members = orchInternals(orch).members;
    const firstRun = vi.fn().mockResolvedValue(oneTurn);
    const secondRun = vi.fn().mockResolvedValue(oneTurn);
    vi.spyOn(members.get("first") as AgentRunner, "run").mockImplementation(firstRun);
    vi.spyOn(members.get("second") as AgentRunner, "run").mockImplementation(secondRun);

    const result = await orch.run({ userMessage: "go" });
    expect(result.status).toBe("completed");
    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(secondRun).not.toHaveBeenCalled();
    expect(result.memberResults).toHaveProperty("first");
    expect(result.memberResults).not.toHaveProperty("second");
  });

  // PYTHON: test_supervisor_auto_grants_delegate_tools_with_toolset
  it("auto-grants supervisor delegate tools when a toolset is set", async () => {
    const registry = new ToolRegistry();
    registry.addToolset("support", [supportLookup]);
    const group = parseAgentGroupConfig({
      name: "team",
      pattern: "supervisor",
      supervisor: "lead",
      members: [llmAgent("lead", { toolset: "support" }), llmAgent("worker")],
    });
    const orch = new AgentOrchestrator({
      config: group,
      toolRegistry: registry,
      storageConfig: new SessionManager(),
      runContext: createRunContext({ sessionId: "sup-1" }),
    });
    const lead = orchInternals(orch).members.get("lead") as AgentRunner;
    const done: AgentRunResult = {
      sessionId: "lead-s",
      finalResponse: "all set",
      turnsUsed: 1,
      status: "completed",
      durationMs: 1,
    };

    vi.spyOn(lead, "run").mockImplementation(async () => {
      const internals = runnerInternals(lead);
      internals.resolveToolsets();
      expect(internals.allowedTools?.has("supervisor.delegate_to_worker")).toBe(true);
      return done;
    });

    const result = await orch.run({ userMessage: "delegate please" });
    expect(result.status).toBe("completed");
    expect(result.memberResults).toHaveProperty("lead");
  });

  // PYTHON: test_orchestrator_fans_out_event_emitter
  it("fans the event emitter out to members", async () => {
    const seen: Array<{ eventType: string }> = [];
    const emitter = new NexusEventEmitter();
    emitter.registerSink(
      new CustomCallbackSink(async (event) => {
        seen.push(event);
      }),
    );

    const group = parseAgentGroupConfig({
      name: "team",
      pattern: "pipeline",
      members: [llmAgent("a")],
    });
    const orch = new AgentOrchestrator({
      config: group,
      storageConfig: new SessionManager(),
      runContext: createRunContext({ sessionId: "emit-1" }),
      eventEmitter: emitter,
    });
    const member = orchInternals(orch).members.get("a") as AgentRunner;
    expect(member.eventEmitter).toBe(emitter);

    vi.spyOn(member.llmProxy, "chat").mockResolvedValue(
      createLLMResponse({
        content: "ok",
        toolCalls: [],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cachedTokens: 0 },
        finishReason: "stop",
      }),
    );
    await orch.run({ userMessage: "hello" });
    expect(seen.some((e) => e.eventType === NexusEventType.AGENT_STARTED)).toBe(true);
  });
});
