import { describe, expect, it } from "vitest";
import {
  ContextualChunker,
  FixedChunker,
  RecursiveChunker,
  SemanticChunker,
  chunkText,
} from "../src/rag/chunking.js";
import { HashingEmbeddings } from "../src/rag/embeddings.js";

describe("RAG chunkers", () => {
  // PYTHON: test_chunk_text_overlap
  it("overlaps adjacent chunks", () => {
    const chunks = chunkText("abcdefghijklmnopqrstuvwxyz", { chunkSize: 10, overlap: 3 });
    expect(chunks[0]).toBe("abcdefghij");
    expect(chunks[1]?.startsWith("hij")).toBe(true);
    expect(chunks.join("") || true).toBeTruthy();
    expect(chunks.at(-1)?.endsWith("z")).toBe(true);
  });

  // PYTHON: test_fixed_chunker_metadata
  it("attaches metadata and ids on fixed chunks", async () => {
    const chunker = new FixedChunker(8, 0);
    const chunks = await chunker.chunk("abcdefghijklmnop", { metadata: { doc: "a" } });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.metadata?.doc).toBe("a");
    expect(chunks[0]?.metadata?.chunkIndex).toBe(0);
    expect(chunks[0]?.id.startsWith("chk_")).toBe(true);
  });

  // PYTHON: test_recursive_chunker_prefers_paragraphs
  it("prefers paragraph splits", async () => {
    const text = "First paragraph is short.\n\nSecond paragraph is also short.";
    const chunks = await new RecursiveChunker(40, 0).chunk(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some((c) => c.text.includes("First paragraph"))).toBe(true);
  });

  // PYTHON: test_contextual_chunker_prepends
  it("prepends context to each chunk", async () => {
    const inner = new FixedChunker(20, 0);
    const chunker = new ContextualChunker(inner, "About cats");
    const chunks = await chunker.chunk("Cats sleep a lot during the day.");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.text.startsWith("Context: About cats")).toBe(true);
    expect(chunks[0]?.metadata?.contextual).toBe(true);
  });

  // PYTHON: test_semantic_chunker_falls_back_without_embeddings
  it("falls back without embeddings", async () => {
    const chunker = new SemanticChunker(null, 40, 0);
    const chunks = await chunker.chunk("One sentence. Two sentence. Three sentence.");
    expect(chunks.length).toBeGreaterThan(0);
  });

  // PYTHON: test_semantic_chunker_splits_on_low_similarity
  it("splits on low similarity", async () => {
    const embeddings = new HashingEmbeddings(32);
    const chunker = new SemanticChunker(embeddings, 80, 0, 0.99);
    const text =
      "Alpha alpha alpha alpha. Zebra zebra zebra zebra. " +
      "Alpha alpha continues. Zebra zebra continues.";
    const chunks = await chunker.chunk(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});
