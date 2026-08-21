import { describe, expect, it } from "vitest";
import { parseAgentConfig } from "../src/config/agent.js";
import { parseMemoryConfig } from "../src/config/memory.js";
import { HashingEmbeddings } from "../src/rag/embeddings.js";
import { defaultRAGConfig } from "../src/rag/config.js";
import { buildRagProvider } from "../src/rag/factory.js";
import { buildMemoryProvider } from "../src/memory/factory.js";
import { InMemoryCrossSessionMemoryStore } from "../src/memory/cross-session-store.js";
import { InMemoryRAGProvider } from "../src/rag/providers/in-memory.js";
import { RetrieveToolPlugin } from "../src/rag/retrieve.js";
import { createRunContext } from "../src/tools/context.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { makeRunner, testLlmConfig } from "./helpers.js";

function agent(extra: Record<string, unknown> = {}) {
  return parseAgentConfig({
    name: "rag-bot",
    llm: testLlmConfig({ model: "gpt-4o-mini" }),
    persona: { role: "assistant", goal: "answer" },
    ...extra,
  });
}

describe("RAG/memory manifest wiring", () => {
  // PYTHON: test_yaml_agent_accepts_rag_and_memory_provider
  it("accepts rag and memory.provider on agent config", () => {
    const cfg = parseAgentConfig({
      name: "docs",
      llm: { provider: "openai", model: "gpt-4o-mini", api_key: "sk-test" },
      rag: {
        provider: "in_memory",
        collection: "handbook",
        retrieval: { k: 4, hybrid: true },
      },
      memory: {
        enabled: true,
        provider: "builtin_semantic",
        require_approval: false,
      },
    });
    expect(cfg.rag).toBeTruthy();
    expect((cfg.rag as { collection: string }).collection).toBe("handbook");
    expect((cfg.rag as { retrieval: { hybrid: boolean } }).retrieval.hybrid).toBe(true);
    expect(cfg.memory.provider).toBe("builtin_semantic");
  });

  // PYTHON: test_runner_builds_providers_from_config
  it("builds RAG and memory providers from config", async () => {
    const store = new InMemoryCrossSessionMemoryStore();
    const rag = await buildRagProvider({ ...defaultRAGConfig(), provider: "in_memory" });
    const memory = await buildMemoryProvider(
      parseMemoryConfig({ enabled: true, provider: "builtin_semantic", expose_tools: true }),
      store,
      { agentName: "rag-bot" },
    );
    expect(rag).toBeTruthy();
    expect(memory).toBeTruthy();
  });

  // PYTHON: test_runner_skips_rag_when_unset
  it("leaves rag unset when the agent has no rag block", () => {
    const cfg = agent();
    expect(cfg.rag == null).toBe(true);
  });

  // PYTHON: test_runner_rag_retrieve_end_to_end
  it("runs rag.retrieve end-to-end through AgentRunner", async () => {
    const ctx = createRunContext({ tenantId: "acme", userId: "u1", sessionId: "s1" });
    const provider = new InMemoryRAGProvider({
      embeddings: new HashingEmbeddings(32),
      config: { ...defaultRAGConfig(), provider: "in_memory" },
    });
    await provider.ingest(ctx, ["The Eiffel Tower is in Paris, France."], { collection: "default" });
    const registry = new ToolRegistry();
    registry.registerPlugin(new RetrieveToolPlugin(provider));
    const { runner } = makeRunner({
      config: agent({ rag: { provider: "in_memory" } }),
      registry,
      runContext: ctx,
      responses: [
        {
          content: "",
          toolCalls: [
            { id: "call-1", toolName: "rag.retrieve", toolInput: { query: "Eiffel Tower", k: 2 } },
          ],
          finishReason: "tool_calls",
        },
        { content: "Paris.", finishReason: "stop" },
      ],
    });
    const result = await runner.run("Where is the Eiffel Tower?", { sessionId: "s1" });
    expect(result.status).toBe("completed");
    expect(runner.toolRegistry.has("rag.retrieve")).toBe(true);
    expect(result.finalResponse).toBe("Paris.");
  });

  // PYTHON: test_hashing_embeddings_stable
  it("returns stable hashing embeddings", async () => {
    const emb = new HashingEmbeddings(16);
    const a = await emb.embed(["hello world"]);
    const b = await emb.embed(["hello world"]);
    expect(a).toEqual(b);
    expect(a[0]).toHaveLength(16);
  });
});
