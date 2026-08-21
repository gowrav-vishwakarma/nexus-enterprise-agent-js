import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultRAGConfig } from "../src/rag/config.js";
import { HashingEmbeddings } from "../src/rag/embeddings.js";
import { InMemoryRAGProvider } from "../src/rag/providers/in-memory.js";
import { createRunContext } from "../src/tools/context.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "rag_eval.jsonl");

function loadRows(): Array<{ query: string; doc: string; answer: string }> {
  return readFileSync(FIXTURE, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { query: string; doc: string; answer: string });
}

describe("RAG eval fixture", () => {
  // PYTHON: test_in_memory_rag_eval_hit_rate
  it("hits at least 60% of fixture queries", async () => {
    const rows = loadRows();
    expect(rows).toHaveLength(50);
    const provider = new InMemoryRAGProvider({
      embeddings: new HashingEmbeddings(64),
      config: { ...defaultRAGConfig(), retrieval: { k: 5, hybrid: true } },
    });
    const ctx = createRunContext({ tenantId: "eval", userId: "eval" });
    await provider.ingest(
      ctx,
      rows.map((row) => row.doc),
    );
    let hits = 0;
    for (const row of rows) {
      const retrieved = await provider.retrieve(ctx, row.query, 5);
      const texts = retrieved.map((h) => h.text).join(" ");
      if (texts.toLowerCase().includes(row.answer.toLowerCase()) || texts.includes(row.doc)) {
        hits += 1;
      }
    }
    expect(hits / rows.length).toBeGreaterThanOrEqual(0.6);
  });
});
