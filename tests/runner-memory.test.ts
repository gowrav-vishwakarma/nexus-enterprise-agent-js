import { describe, expect, it } from "vitest";
import { parseMemoryConfig } from "../src/config/memory.js";
import { InMemoryCrossSessionMemoryStore } from "../src/memory/cross-session-store.js";
import { createRunContext } from "../src/tools/context.js";
import { makeRunner, testAgentConfig } from "./helpers.js";

describe("AgentRunner memory wiring", () => {
  it("registers memory.write when enabled and expose_tools", () => {
    const store = new InMemoryCrossSessionMemoryStore();
    const { registry } = makeRunner({
      config: testAgentConfig({
        memory: parseMemoryConfig({ enabled: true, expose_tools: true }),
      }),
      crossSessionMemoryStore: store,
      runContext: createRunContext({ userId: "u1", tenantId: "t1", sessionId: "s1" }),
    });
    expect(registry.has("memory.write")).toBe(true);
  });

  it("does not register memory tools when disabled", () => {
    const store = new InMemoryCrossSessionMemoryStore();
    const { registry } = makeRunner({
      config: testAgentConfig({
        memory: parseMemoryConfig({ enabled: false, expose_tools: true }),
      }),
      crossSessionMemoryStore: store,
    });
    expect(registry.toolNames().some((n) => n.startsWith("memory."))).toBe(false);
  });
});
