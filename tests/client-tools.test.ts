/** Ports of Python tests/test_client_tools.py — pause, stream, and resume. */

import { beforeEach, describe, expect, it } from "vitest";
import { MockLLMAdapter } from "../src/eval/mock-llm.js";
import { defineTool } from "../src/tools/decorators.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { collectStream, makeRunner, testAgentConfig, testLlmConfig } from "./helpers.js";

const serverRan: string[] = [];

const fillForm = defineTool((field: string) => {
  serverRan.push("fill_form");
  return "server-side execution should not happen";
}, { name: "fill_form", execution: "client" });

const requestUserInput = defineTool((question: string) => {
  serverRan.push("request_user_input");
  return "";
}, { name: "request_user_input", execution: "client" });

const slowClientAction = defineTool(async (field: string) => {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  return `should never run ${field}`;
}, { name: "slow_client_action", execution: "client", timeoutSeconds: 1 });

function clientRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.addTool(fillForm);
  registry.addTool(requestUserInput);
  registry.addTool(slowClientAction);
  return registry;
}

describe("client tools", () => {
  beforeEach(() => {
    serverRan.length = 0;
  });

  // PYTHON: test_client_tool_pauses_without_running_server_side
  it("pauses a client tool without running it server-side", async () => {
    const adapter = new MockLLMAdapter(testLlmConfig(), [
      {
        content: "opening the form",
        toolCalls: [{ id: "call-fill_form", name: "fill_form", arguments: { field: "name" } }],
      },
    ]);
    const { runner } = makeRunner({
      registry: clientRegistry(),
      adapter,
      config: testAgentConfig({ name: "client-tool-agent", turns: { max_turns: 5 } }),
    });

    const result = await runner.run("fill the form", { sessionId: "client-1" });
    expect(result.status).toBe("paused");
    expect(serverRan).toEqual([]);
    expect(result.pendingInteractions).toHaveLength(1);
    expect(result.pendingInteractions![0]!.tool_name).toBe("fill_form");
    expect(result.pendingInteractions![0]!.kind).toBe("client_tool");
    expect(result.pendingInteractions![0]!.args).toEqual({ field: "name" });
  });

  // PYTHON: test_elicitation_pauses_with_its_own_kind
  it("pauses request_user_input as an elicitation", async () => {
    const adapter = new MockLLMAdapter(testLlmConfig(), [
      {
        toolCalls: [
          {
            id: "call-request_user_input",
            name: "request_user_input",
            arguments: { question: "Which invoice?" },
          },
        ],
      },
    ]);
    const { runner } = makeRunner({
      registry: clientRegistry(),
      adapter,
      config: testAgentConfig({ name: "client-tool-agent", turns: { max_turns: 5 } }),
    });

    const result = await runner.run("pay it", { sessionId: "client-2" });
    expect(result.status).toBe("paused");
    expect(result.pendingInteractions![0]!.kind).toBe("elicitation");
    expect((result.pendingInteractions![0]!.args as { question: string }).question).toBe(
      "Which invoice?",
    );
  });

  // PYTHON: test_declared_timeout_does_not_cancel_a_client_tool
  it("pauses a client tool before its timeout can apply", async () => {
    const adapter = new MockLLMAdapter(testLlmConfig(), [
      {
        toolCalls: [{ id: "call-slow_client_action", name: "slow_client_action", arguments: { field: "x" } }],
      },
    ]);
    const { runner } = makeRunner({
      registry: clientRegistry(),
      adapter,
      config: testAgentConfig({ name: "client-tool-agent", turns: { max_turns: 5 } }),
    });

    const result = await Promise.race([
      runner.run("go", { sessionId: "client-3" }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("client tool should pause before timeout")), 3000),
      ),
    ]);
    expect(result.status).toBe("paused");
  });

  // PYTHON: test_resume_feeds_the_client_result_back_to_the_model
  it("feeds the client result back to the model on resume", async () => {
    const first = new MockLLMAdapter(testLlmConfig(), [
      { toolCalls: [{ id: "call-fill_form", name: "fill_form", arguments: { field: "name" } }] },
    ]);
    const { runner } = makeRunner({
      registry: clientRegistry(),
      adapter: first,
      config: testAgentConfig({ name: "client-tool-agent", turns: { max_turns: 5 } }),
    });

    const paused = await runner.run("fill it", { sessionId: "client-4" });
    const tcId = String(paused.pendingInteractions![0]!.tc_id);

    const { runner: resuming, adapter: resumeAdapter } = makeRunner({
      registry: clientRegistry(),
      sessionManager: runner.sessionManager,
      adapter: new MockLLMAdapter(testLlmConfig(), [{ content: "All done." }]),
      config: testAgentConfig({ name: "client-tool-agent", turns: { max_turns: 5 } }),
    });

    const resumed = await resuming.resume("client-4", [{ tc_id: tcId, content: "form filled by user" }]);
    expect(resumed.status).toBe("completed");
    expect(resumed.finalResponse).toBe("All done.");
    const rendered = JSON.stringify(resumeAdapter.calls);
    expect(rendered).toContain("form filled by user");
  });

  // PYTHON: test_streaming_client_tool_emits_paused_with_pending_interactions
  it("emits a paused stream event with pending interactions", async () => {
    const adapter = new MockLLMAdapter(testLlmConfig(), [
      {
        toolCalls: [
          {
            id: "call-1",
            name: "request_user_input",
            arguments: { question: "Which one?" },
          },
        ],
        streamChunks: [
          {
            toolCalls: [
              {
                index: 0,
                id: "call-1",
                name: "request_user_input",
                arguments: '{"question": "Which one?"}',
              },
            ],
          },
          { finishReason: "tool_calls" },
        ],
      },
    ]);
    const { runner } = makeRunner({
      registry: clientRegistry(),
      adapter,
      config: testAgentConfig({ name: "client-tool-agent", turns: { max_turns: 5 } }),
    });

    const events = await collectStream(runner, "go", { sessionId: "client-5" });
    const paused = events.filter((e) => e.eventType === "paused");
    expect(paused.length).toBeGreaterThan(0);
    const pending = paused[0]!.data?.pendingInteractions as Array<Record<string, unknown>>;
    expect(pending[0]!.tool_name).toBe("request_user_input");
    expect((pending[0]!.args as { question: string }).question).toBe("Which one?");
    expect(events.every((e) => e.data && "seq" in e.data)).toBe(true);
  });
});
