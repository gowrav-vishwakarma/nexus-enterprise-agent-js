import { describe, expect, it } from "vitest";
import { parseAgentConfig } from "../src/config/agent.js";
import { MockLLMAdapter } from "../src/eval/mock-llm.js";
import { AgentRunner } from "../src/runner/agent-runner.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createRunContext } from "../src/tools/context.js";

describe("AgentRunner", () => {
  it("returns a result from run() without a real API key", async () => {
    const config = parseAgentConfig({
      name: "tester",
      llm: { provider: "openai", model: "mock", api_key: "" },
      persona: { role: "Tester", goal: "Prove the loop works" },
    });
    const runner = new AgentRunner({
      config,
      toolRegistry: new ToolRegistry(),
      runContext: createRunContext({ sessionId: "s1", tenantId: "t1", userId: "u1" }),
      llmAdapter: new MockLLMAdapter(config.llm, [{ content: "hello from mock" }]),
    });

    const result = await runner.run("What is Nexus?");
    expect(result).toBeDefined();
    expect(result.finalResponse).toBe("hello from mock");
    expect(result.status).toBe("completed");
    expect(result.sessionId).toBeTruthy();
    expect(result.turnsUsed).toBeGreaterThanOrEqual(1);
  });
});
