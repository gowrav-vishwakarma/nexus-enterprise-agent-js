import { describe, expect, it } from "vitest";
import { defaultRAGConfig } from "../src/rag/config.js";
import { HashingEmbeddings } from "../src/rag/embeddings.js";
import { reciprocalRankFusion } from "../src/rag/fusion.js";
import { InMemoryVectorStore } from "../src/rag/memory.js";
import type { DocumentChunk } from "../src/rag/protocol.js";
import { InMemoryRAGProvider } from "../src/rag/providers/in-memory.js";
import { createRunContext } from "../src/tools/context.js";

describe("InMemoryRAGProvider", () => {
  // PYTHON: test_rrf_merges_lists
  it("merges ranked lists with reciprocal rank fusion", () => {
    const a: DocumentChunk = { id: "a", text: "A" };
    const b: DocumentChunk = { id: "b", text: "B" };
    const c: DocumentChunk = { id: "c", text: "C" };
    const fused = reciprocalRankFusion([
      [a, b],
      [b, c],
    ], { k: 60, topN: 3 });
    expect(fused[0]?.id).toBe("b");
    expect(new Set(fused.map((x) => x.id))).toEqual(new Set(["a", "b", "c"]));
  });

  // PYTHON: test_ingest_and_retrieve_keyword_overlap
  it("ingests documents and retrieves by keyword overlap", async () => {
    const provider = new InMemoryRAGProvider({
      embeddings: new HashingEmbeddings(32),
      config: { ...defaultRAGConfig(), retrieval: { k: 3, hybrid: true } },
    });
    const ctx = createRunContext({ tenantId: "acme", userId: "u1" });
    await provider.ingest(ctx, [
      "The Nile is a river in Africa.",
      "Photosynthesis converts sunlight into chemical energy in plants.",
      "Paris is the capital of France.",
    ]);
    const hits = await provider.retrieve(ctx, "photosynthesis in plants", 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.text.includes("Photosynthesis"))).toBe(true);
  });

  // PYTHON: test_tenant_isolation
  it("isolates collections by tenant", async () => {
    const provider = new InMemoryRAGProvider({ embeddings: new HashingEmbeddings(32) });
    const a = createRunContext({ tenantId: "tenant-a", userId: "u1" });
    const b = createRunContext({ tenantId: "tenant-b", userId: "u1" });
    await provider.ingest(a, ["Secret alpha document about widgets."]);
    await provider.ingest(b, ["Secret beta document about gadgets."]);
    const hitsA = await provider.retrieve(a, "secret widgets", 5);
    const hitsB = await provider.retrieve(b, "secret gadgets", 5);
    expect(hitsA.every((h) => !h.text.toLowerCase().includes("beta"))).toBe(true);
    expect(hitsB.every((h) => !h.text.toLowerCase().includes("alpha"))).toBe(true);
  });

  // PYTHON: test_dimension_mismatch_raises
  it("raises on embedding dimension mismatch", async () => {
    const store = new InMemoryVectorStore();
    const p1 = new InMemoryRAGProvider({ embeddings: new HashingEmbeddings(16), store });
    const ctx = createRunContext({ tenantId: "t", userId: "u" });
    await p1.ingest(ctx, ["hello world"]);
    const p2 = new InMemoryRAGProvider({ embeddings: new HashingEmbeddings(64), store });
    await expect(p2.ingest(ctx, ["another document here"])).rejects.toThrow(/dimension/i);
  });

  // PYTHON: test_accepts_document_chunks
  it("accepts pre-built document chunks", async () => {
    const provider = new InMemoryRAGProvider({ embeddings: new HashingEmbeddings(16) });
    const ctx = createRunContext({ tenantId: "t", userId: "u" });
    await provider.ingest(ctx, [
      { id: "d1", text: "Oak trees grow acorns.", metadata: { src: "botany" } },
    ]);
    const hits = await provider.retrieve(ctx, "acorns oak", 1);
    expect(hits[0]?.metadata?.src).toBe("botany");
  });
});
