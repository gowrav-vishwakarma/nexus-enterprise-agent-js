import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAgentConfig, parseAgentGroupConfig, type AgentGroupConfig } from "../src/config/agent.js";
import { parseRuntimeContextSummarizerConfig } from "../src/config/rcs.js";
import {
  createLLMResponse,
  createLLMStreamChunk,
  emptyTokenUsage,
} from "../src/llm/response.js";
import { AgentOrchestrator } from "../src/multiagent/orchestrator.js";
import type { AgentRunResult } from "../src/runner/result.js";
import { AgentRunner } from "../src/runner/agent-runner.js";
import { SessionManager } from "../src/session/manager.js";
import { createRunContext } from "../src/tools/context.js";
import { orchInternals } from "./helpers.js";

function agent(name: string, extras: Record<string, unknown> = {}) {
  return parseAgentConfig({
    name,
    llm: { provider: "openai", model: "gpt-4o-mini", api_key: "sk-test" },
    persona: { role: name, goal: "answer" },
    ...extras,
  });
}

function group(strategy = "concat"): AgentGroupConfig {
  return parseAgentGroupConfig({
    name: "panel",
    pattern: "parallel",
    members: [agent("alpha"), agent("beta")],
    aggregation_strategy: strategy,
  });
}

function build(cfg: AgentGroupConfig): AgentOrchestrator {
  return new AgentOrchestrator({
    config: cfg,
    storageConfig: new SessionManager(),
    runContext: createRunContext({ sessionId: "panel-1" }),
  });
}

function chatFor(reply: string) {
  return async () =>
    createLLMResponse({
      content: reply,
      toolCalls: [],
      finishReason: "stop",
      usage: emptyTokenUsage(),
    });
}

async function* chatStreamFor(reply: string) {
  yield createLLMStreamChunk({ content: reply });
  yield createLLMStreamChunk({
    content: null,
    finishReason: "stop",
    usage: emptyTokenUsage(),
  });
}

describe("parallel orchestrator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // PYTHON: test_parallel_concat_aggregation
  it("concatenates member replies", async () => {
    const orch = build(group("concat"));
    const members = orchInternals(orch).members;
    vi.spyOn((members.get("alpha") as AgentRunner).llmProxy, "chat").mockImplementation(
      chatFor("A says hi"),
    );
    vi.spyOn((members.get("beta") as AgentRunner).llmProxy, "chat").mockImplementation(
      chatFor("B says hi"),
    );
    const result = await orch.run({ userMessage: "question" });
    expect(result.status).toBe("completed");
    expect(result.finalResponse).toContain("[alpha]");
    expect(result.finalResponse).toContain("[beta]");
    expect(result.finalResponse).toContain("A says hi");
    expect(result.finalResponse).toContain("B says hi");
    expect(new Set(Object.keys(result.memberResults))).toEqual(new Set(["alpha", "beta"]));
  });

  // PYTHON: test_parallel_vote_aggregation
  it("votes and first-completes member replies", async () => {
    let orch = build(group("vote"));
    let members = orchInternals(orch).members;
    vi.spyOn((members.get("alpha") as AgentRunner).llmProxy, "chat").mockImplementation(
      chatFor("yes"),
    );
    vi.spyOn((members.get("beta") as AgentRunner).llmProxy, "chat").mockImplementation(
      chatFor("yes"),
    );
    let result = await orch.run({ userMessage: "question" });
    expect(result.status).toBe("completed");
    expect(result.finalResponse).toBe("yes");

    orch = build(group("first_complete"));
    members = orchInternals(orch).members;
    vi.spyOn((members.get("alpha") as AgentRunner).llmProxy, "chat").mockImplementation(
      chatFor("only A"),
    );
    vi.spyOn((members.get("beta") as AgentRunner).llmProxy, "chat").mockImplementation(
      chatFor("only B"),
    );
    result = await orch.run({ userMessage: "question" });
    expect(["only A", "only B"]).toContain(result.finalResponse);
  });

  // PYTHON: test_parallel_stream_multiplexes_members
  it("multiplexes member streams", async () => {
    const orch = build(group("concat"));
    const members = orchInternals(orch).members;
    vi.spyOn((members.get("alpha") as AgentRunner).llmProxy, "chatStream").mockImplementation(
      () => chatStreamFor("A1"),
    );
    vi.spyOn((members.get("beta") as AgentRunner).llmProxy, "chatStream").mockImplementation(
      () => chatStreamFor("B1"),
    );
    const events = [];
    for await (const ev of orch.runStream({ userMessage: "question", stream: true })) {
      events.push(ev);
    }
    const final = events.filter((e) => e.eventType === "final_response").at(-1);
    const text = `${final?.content ?? ""} ${JSON.stringify(final?.data ?? {})}`;
    expect(text).toContain("[alpha]");
    expect(text).toContain("[beta]");
  });

  // PYTHON: test_parallel_rcs_token_savings_aggregate
  it("sums RCS token savings across parallel members", async () => {
    const rcs = parseRuntimeContextSummarizerConfig({ enabled: true });
    const cfg = parseAgentGroupConfig({
      name: "rcs-panel",
      pattern: "parallel",
      members: [agent("alpha", { rcs }), agent("beta", { rcs })],
      aggregation_strategy: "concat",
    });
    const orch = new AgentOrchestrator({
      config: cfg,
      storageConfig: new SessionManager(),
      runContext: createRunContext({ sessionId: "rcs-panel-1" }),
    });
    const alphaResult: AgentRunResult = {
      sessionId: "alpha-sess",
      finalResponse: "A done",
      turnsUsed: 1,
      totalTokensIn: 100,
      totalTokensOut: 20,
      totalTokensSavedByRcs: 150,
      cumulativeInputTokensSavedByRcs: 450,
      durationMs: 10,
      status: "completed",
    };
    const betaResult: AgentRunResult = {
      sessionId: "beta-sess",
      finalResponse: "B done",
      turnsUsed: 1,
      totalTokensIn: 200,
      totalTokensOut: 30,
      totalTokensSavedByRcs: 250,
      cumulativeInputTokensSavedByRcs: 750,
      durationMs: 10,
      status: "completed",
    };
    const members = orchInternals(orch).members;
    vi.spyOn(members.get("alpha") as AgentRunner, "run").mockResolvedValue(alphaResult);
    vi.spyOn(members.get("beta") as AgentRunner, "run").mockResolvedValue(betaResult);

    const result = await orch.run({ userMessage: "question" });
    expect(result.status).toBe("completed");
    expect(result.totalTokensSavedByRcs).toBe(150 + 250);
    expect(result.totalTokensSavedByRcs).toBe(
      (alphaResult.totalTokensSavedByRcs ?? 0) + (betaResult.totalTokensSavedByRcs ?? 0),
    );
    expect(result.cumulativeInputTokensSavedByRcs).toBe(450 + 750);
    expect(result.cumulativeInputTokensSavedByRcs).toBe(
      (alphaResult.cumulativeInputTokensSavedByRcs ?? 0) +
        (betaResult.cumulativeInputTokensSavedByRcs ?? 0),
    );
  });
});
