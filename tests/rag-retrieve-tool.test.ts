import { describe, expect, it } from "vitest";
import { HashingEmbeddings } from "../src/rag/embeddings.js";
import { InMemoryVectorStore } from "../src/rag/memory.js";
import { InMemoryRAGProvider } from "../src/rag/providers/in-memory.js";
import { RetrieveToolPlugin, createRetrievePlugin } from "../src/rag/retrieve.js";
import { createRunContext } from "../src/tools/context.js";
import { ToolRegistry } from "../src/tools/registry.js";

describe("rag.retrieve tool", () => {
  // PYTHON: test_retrieve_plugin_with_provider
  it("retrieves through the plugin with a provider", async () => {
    const provider = new InMemoryRAGProvider({ embeddings: new HashingEmbeddings(32) });
    const ctx = createRunContext({ tenantId: "acme", userId: "u1" });
    await provider.ingest(ctx, ["Mercury is the closest planet to the Sun."]);
    const plugin = new RetrieveToolPlugin(provider);
    const raw = await plugin.retrieve("closest planet", 3, ctx);
    const payload = JSON.parse(raw) as { ok: boolean; results: Array<{ text: string }> };
    expect(payload.ok).toBe(true);
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results[0]?.text).toContain("Mercury");
  });

  // PYTHON: test_create_retrieve_plugin_store_embeddings_shim
  it("wraps a store + embeddings pair", async () => {
    const store = new InMemoryVectorStore();
    const embeddings = new HashingEmbeddings(32);
    const plugin = createRetrievePlugin(store, embeddings);
    const ctx = createRunContext({ tenantId: "acme", userId: "u1" });
    await plugin.provider.ingest(ctx, ["The mitochondria is the powerhouse of the cell."]);
    const raw = await plugin.retrieve("mitochondria powerhouse", 2, ctx);
    const payload = JSON.parse(raw) as { ok: boolean; results: Array<{ text: string }> };
    expect(payload.ok).toBe(true);
    expect(payload.results.some((r) => r.text.toLowerCase().includes("mitochondria"))).toBe(true);
  });

  // PYTHON: test_retrieve_missing_context
  it("returns ok=false when context is missing", async () => {
    const plugin = new RetrieveToolPlugin(new InMemoryRAGProvider());
    const raw = await plugin.retrieve("anything", 1, null);
    expect(JSON.parse(raw).ok).toBe(false);
  });

  // PYTHON: test_retrieve_registers_on_registry
  it("registers rag.retrieve on the tool registry", () => {
    const registry = new ToolRegistry();
    registry.registerPlugin(new RetrieveToolPlugin(new InMemoryRAGProvider()));
    expect(registry.has("rag.retrieve")).toBe(true);
  });
});
