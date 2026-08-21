/**
 * Live LiteLLM-compatible proxy tests.
 *
 * Excluded unless NEXUS_LIVE_LLM=1 (see vitest.config.ts).
 * Do not skip with it.skip — this file only loads in the live run.
 *
 * PYTHON cousin: tests/test_orchestration_live_llm.py (orchestration smoke).
 * These cases hit chat, streaming, AgentRunner, and a tool-call path.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { VercelAdapter } from "../../src/llm/adapters/vercel.js";
import { LLMProxy } from "../../src/llm/proxy.js";
import { AgentRunner } from "../../src/runner/agent-runner.js";
import { defineTool } from "../../src/tools/decorators.js";
import { createRunContext } from "../../src/tools/context.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { CustomCallbackSink, NexusEventEmitter } from "../../src/events/emitter.js";
import { NexusEventType } from "../../src/events/models.js";
import { hasLiveLlm, liveLlmConfig, testAgentConfig } from "../helpers.js";

const LIVE_TIMEOUT_MS = 45_000;

function liveAgentConfig(overrides: Record<string, unknown> = {}) {
  const llm = liveLlmConfig();
  return {
    ...testAgentConfig({
      name: "live-agent",
      persona: { role: "Concise tester", goal: "Follow instructions exactly" },
      turns: { max_turns: 8 },
      ...overrides,
    }),
    llm,
  };
}

beforeAll(() => {
  if (!hasLiveLlm()) {
    throw new Error(
      "NEXUS_LIVE_LLM=1 is set but no API key is available. Set NEXUS_LLM_API_KEY or LITELLM_API_KEY.",
    );
  }
  const cfg = liveLlmConfig();
  if (!cfg.baseUrl && !cfg.base_url) {
    throw new Error(
      "NEXUS_LIVE_LLM=1 is set but no base URL is available. Set NEXUS_LLM_BASE_URL or LITELLM_BASE_URL.",
    );
  }
});

describe("live LLM (LiteLLM-compatible proxy)", () => {
  it(
    "chats via LLMProxy / VercelAdapter",
    async () => {
      const cfg = liveLlmConfig();
      const adapter = new VercelAdapter(cfg);
      const proxy = new LLMProxy(cfg, adapter);
      const response = await proxy.chat([
        {
          role: "user",
          content: "Reply with exactly the word OK and nothing else.",
        },
      ]);
      expect(response.content).toBeTruthy();
      expect(String(response.content).length).toBeGreaterThan(0);
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    "AgentRunner replies with PONG",
    async () => {
      const runner = new AgentRunner({
        config: liveAgentConfig({ name: "live-pong" }),
        toolRegistry: new ToolRegistry(),
        runContext: createRunContext({ sessionId: "live-pong" }),
      });
      const result = await runner.run("Reply with exactly the word PONG and nothing else.");
      expect(result.status).toBe("completed");
      expect(result.finalResponse).toBeTruthy();
      expect(String(result.finalResponse)).toMatch(/pong/i);
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    "chatStream yields at least one content chunk",
    async () => {
      const proxy = new LLMProxy(liveLlmConfig());
      let contentChunks = 0;
      let text = "";
      for await (const chunk of proxy.chatStream([
        { role: "user", content: "Say the word STREAM once." },
      ])) {
        if (chunk.content) {
          contentChunks += 1;
          text += chunk.content;
        }
      }
      expect(contentChunks).toBeGreaterThan(0);
      expect(text.length).toBeGreaterThan(0);
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    "tool-call path: add(a, b) for 2+3",
    async () => {
      const addCalls: Array<{ a: number; b: number }> = [];
      const add = defineTool(
        (a: number, b: number) => {
          addCalls.push({ a, b });
          return a + b;
        },
        {
          name: "add",
          description: "Add two numbers and return their sum.",
          parameters: {
            type: "object",
            properties: {
              a: { type: "number", description: "First addend" },
              b: { type: "number", description: "Second addend" },
            },
            required: ["a", "b"],
          },
        },
      );

      const registry = new ToolRegistry();
      registry.addTool(add);

      const toolEvents: string[] = [];
      const emitter = new NexusEventEmitter();
      emitter.registerSink(
        new CustomCallbackSink(async (event) => {
          if (
            event.eventType === NexusEventType.TOOL_CALL_STARTED ||
            event.eventType === NexusEventType.TOOL_CALL_COMPLETED
          ) {
            toolEvents.push(event.eventType);
          }
        }),
      );

      const runner = new AgentRunner({
        config: liveAgentConfig({ name: "live-add" }),
        toolRegistry: registry,
        runContext: createRunContext({ sessionId: "live-add" }),
        eventEmitter: emitter,
      });

      const result = await runner.run("What is 2+3? Use the add tool.");
      const reply = String(result.finalResponse ?? "");
      const toolRan = addCalls.length > 0 || toolEvents.includes(NexusEventType.TOOL_CALL_COMPLETED);
      expect(toolRan || /5/.test(reply)).toBe(true);
      if (addCalls.length > 0) {
        expect(addCalls[0]?.a + addCalls[0]?.b).toBe(5);
      }
    },
    LIVE_TIMEOUT_MS,
  );
});
