import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAgentConfig, parseAgentGroupConfig, parseAgentPersonaConfig } from "../src/config/agent.js";
import { AgentOrchestrator } from "../src/multiagent/orchestrator.js";
import { OrchestrationManifest, OrchestrationRuntime } from "../src/orchestration/index.js";
import type { AgentRunResult } from "../src/runner/result.js";
import { AgentRunner } from "../src/runner/agent-runner.js";
import { SessionManager } from "../src/session/manager.js";
import { createRunContext } from "../src/tools/context.js";
import { renderSystemPrompt } from "../src/utils/jinja.js";
import {
  ORCHESTRATION_PROMPTS,
  orchInternals,
  writeTempYaml,
} from "./helpers.js";

function agent(name: string) {
  return parseAgentConfig({
    name,
    llm: { provider: "openai", model: "gpt-4o-mini", api_key: "sk-test" },
    persona: { role: name, goal: "work" },
  });
}

describe("multiagent context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // PYTHON: test_derive_child_copies_identity_and_services
  it("copies identity and services onto a derived child", () => {
    const db = {};
    const parent = createRunContext({
      tenantId: "t1",
      companyId: "c1",
      userId: "u1",
      userName: "Alice",
      requestId: "req-1",
      channel: "api",
      branchId: "b1",
      auth: { token: "x" },
      metadata: { plan: "pro" },
      state: { step: 1 },
    });
    parent.bindServices({ db });
    const child = parent.deriveChild({
      sessionId: "child-s",
      isSubagent: true,
      includeContext: true,
    });
    expect(child.companyId).toBe("c1");
    expect(child.userName).toBe("Alice");
    expect(child.requestId).toBe("req-1");
    expect(child.channel).toBe("api");
    expect(child.branchId).toBe("b1");
    expect(child.auth).toEqual({ token: "x" });
    expect(child.metadata).toEqual({ plan: "pro" });
    expect(child.state).toEqual({ step: 1 });
    expect(child.service("db")).toBe(db);
  });

  // PYTHON: test_derive_child_isolated_omits_bags
  it("omits metadata and state when includeContext is false", () => {
    const parent = createRunContext({ metadata: { a: 1 }, state: { b: 2 } });
    const child = parent.deriveChild({ sessionId: "s", includeContext: false });
    expect(child.metadata).toEqual({});
    expect(child.state).toEqual({});
  });

  // PYTHON: test_member_inherits_identity_from_group_at_init
  it("inherits identity and services from the group at init", () => {
    const groupCtx = createRunContext({
      tenantId: "t1",
      companyId: "co-9",
      userId: "u1",
      sessionId: "root",
    });
    groupCtx.bindServices({ db: {} });
    const orch = new AgentOrchestrator({
      config: parseAgentGroupConfig({
        name: "g",
        pattern: "pipeline",
        members: [agent("a")],
      }),
      runContext: groupCtx,
    });
    const memberCtx = (orchInternals(orch).members.get("a") as AgentRunner).runContext;
    expect(memberCtx.companyId).toBe("co-9");
    expect(memberCtx.service("db")).toBe(groupCtx.service("db"));
  });

  // PYTHON: test_context_sharing_isolated_keeps_empty_member_bags
  it("keeps isolated member bags empty", () => {
    const orch = new AgentOrchestrator({
      config: parseAgentGroupConfig({
        name: "g",
        pattern: "pipeline",
        context_sharing: "isolated",
        members: [agent("a")],
      }),
      runContext: createRunContext({ sessionId: "s1", metadata: { k: 1 }, state: { s: 2 } }),
    });
    const ctx = (orchInternals(orch).members.get("a") as AgentRunner).runContext;
    expect(ctx.metadata).toEqual({});
    expect(ctx.state).toEqual({});
  });

  // PYTHON: test_sync_down_at_run_time_sees_live_group_state
  it("syncs live group state down at run time", () => {
    const orch = new AgentOrchestrator({
      config: parseAgentGroupConfig({
        name: "g",
        pattern: "pipeline",
        context_sharing: "inherit",
        members: [agent("a")],
      }),
      runContext: createRunContext({ sessionId: "s1" }),
    });
    orch.runContext.state.live = true;
    const member = orchInternals(orch).members.get("a")!;
    orchInternals(orch).syncDown(member);
    expect(member.runContext.state.live).toBe(true);
    const delegation = member.runContext.metadata.nexus_delegation as Record<string, unknown>;
    expect(delegation.group).toBe("g");
  });

  // PYTHON: test_sync_up_shared_merges_without_delegation_breadcrumb
  it("merges shared member state up without the delegation breadcrumb", () => {
    const orch = new AgentOrchestrator({
      config: parseAgentGroupConfig({
        name: "g",
        pattern: "pipeline",
        context_sharing: "shared",
        members: [agent("a")],
      }),
      runContext: createRunContext({ sessionId: "s1" }),
    });
    const member = orchInternals(orch).members.get("a")!;
    member.runContext.state.from_member = 42;
    member.runContext.metadata.nexus_delegation = { group: "g" };
    member.runContext.metadata.extra = "yes";
    orchInternals(orch).syncUp(member);
    expect(orch.runContext.state.from_member).toBe(42);
    expect(orch.runContext.metadata.extra).toBe("yes");
    expect(orch.runContext.metadata).not.toHaveProperty("nexus_delegation");
  });

  // PYTHON: test_pipeline_shared_propagates_state_to_next_member
  it("propagates shared pipeline state to the next member", async () => {
    const group = parseAgentGroupConfig({
      name: "pipe",
      pattern: "pipeline",
      context_sharing: "shared",
      members: [agent("first"), agent("second")],
    });
    const orch = new AgentOrchestrator({
      config: group,
      storageConfig: new SessionManager(),
      runContext: createRunContext({ sessionId: "pipe-1" }),
    });
    const done: AgentRunResult = {
      sessionId: "s",
      finalResponse: "step1",
      turnsUsed: 1,
      status: "completed",
      durationMs: 1,
    };
    const members = orchInternals(orch).members;
    const first = members.get("first") as AgentRunner;
    const secondRun = vi.fn().mockResolvedValue({
      sessionId: "s2",
      finalResponse: "step2",
      turnsUsed: 1,
      status: "completed",
      durationMs: 1,
    } satisfies AgentRunResult);
    vi.spyOn(first, "run").mockImplementation(async () => {
      first.runContext.setState("handoff", "data");
      return done;
    });
    vi.spyOn(members.get("second") as AgentRunner, "run").mockImplementation(secondRun);
    await orch.run({ userMessage: "go" });
    expect(orch.runContext.state.handoff).toBe("data");
    expect(secondRun).toHaveBeenCalled();
  });

  // PYTHON: test_render_system_prompt_shows_delegation_block
  it("renders a delegation block in the system prompt", () => {
    const persona = parseAgentPersonaConfig({ role: "Worker", goal: "Help" });
    const rendered = renderSystemPrompt(persona as Record<string, unknown>, {
      runContext: createRunContext({
        metadata: {
          nexus_delegation: {
            group: "billing_team",
            delegated_by: "supervisor",
          },
        },
      }),
    });
    expect(rendered).toContain("## Delegated task");
    expect(rendered).toContain("billing_team");
    expect(rendered).toContain("supervisor");
  });

  // PYTHON: test_render_system_prompt_no_delegation_block_without_breadcrumb
  it("omits the delegation block without a breadcrumb", () => {
    const persona = parseAgentPersonaConfig({ role: "Worker", goal: "Help" });
    const rendered = renderSystemPrompt(persona as Record<string, unknown>, {
      runContext: createRunContext(),
    });
    expect(rendered).not.toContain("## Delegated task");
  });

  // PYTHON: test_yaml_context_sharing_resolves
  it("resolves context_sharing from YAML", async () => {
    const path = await writeTempYaml(
      "context_sharing.yaml",
      `version: "1"
prompts_module: ${ORCHESTRATION_PROMPTS}
root: research_team

defaults:
  llm: &default_llm
    provider: openai
    model: gpt-4o-mini
    api_key: mock-key

agents:
  supervisor:
    llm: *default_llm
    persona:
      role: Supervisor
      goal: Coordinate
      prompt: researcher_system

  researcher:
    llm: *default_llm
    persona:
      role: Researcher
      goal: Research
      prompt: researcher_system

groups:
  research_team:
    pattern: supervisor
    context_sharing: shared
    members: [supervisor, researcher]
`,
    );
    const manifest = await OrchestrationManifest.load(path);
    const runtime = await OrchestrationRuntime.fromManifest(manifest, {
      runContext: createRunContext({ sessionId: "ctx-yaml" }),
    });
    expect(runtime.executor).toBeInstanceOf(AgentOrchestrator);
    expect((runtime.executor as AgentOrchestrator).config.context_sharing).toBe("shared");
  });
});
