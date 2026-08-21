/** In-memory vector and sparse indexes. */

import type { DocumentChunk } from "./protocol.js";

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / ((Math.sqrt(na) || 1) * (Math.sqrt(nb) || 1));
}

export class InMemoryVectorStore {
  private readonly data = new Map<string, DocumentChunk[]>();
  private readonly dims = new Map<string, number>();

  async upsert(collection: string, chunks: DocumentChunk[]): Promise<void> {
    let dim: number | null = null;
    for (const chunk of chunks) {
      if (chunk.embedding?.length) {
        dim = chunk.embedding.length;
        break;
      }
    }
    if (dim != null) {
      const existing = this.dims.get(collection);
      if (existing != null && existing !== dim) {
        throw new Error(
          `Embedding dimension mismatch: collection '${collection}' has dim ${existing}, new chunks have dim ${dim}`,
        );
      }
      this.dims.set(collection, dim);
    }
    const list = this.data.get(collection) ?? [];
    list.push(...chunks);
    this.data.set(collection, list);
  }

  async search(
    collection: string,
    queryEmbedding: number[],
    k = 5,
  ): Promise<DocumentChunk[]> {
    const expected = this.dims.get(collection);
    if (expected != null && queryEmbedding.length !== expected) {
      throw new Error(
        `Embedding dimension mismatch: ${queryEmbedding.length} vs ${expected}`,
      );
    }
    const items = this.data.get(collection) ?? [];
    const scored = items
      .filter((c) => c.embedding?.length)
      .map((c) => [c, cosine(queryEmbedding, c.embedding!)] as const)
      .sort((a, b) => b[1] - a[1]);
    return scored.slice(0, k).map(([c]) => c);
  }
}

export class InMemorySparseIndex {
  private readonly data = new Map<string, DocumentChunk[]>();

  async upsert(collection: string, chunks: DocumentChunk[]): Promise<void> {
    const list = this.data.get(collection) ?? [];
    list.push(...chunks);
    this.data.set(collection, list);
  }

  async search(collection: string, query: string, k = 5): Promise<DocumentChunk[]> {
    const tokens = new Set(query.toLowerCase().split(/\s+/).filter(Boolean));
    if (!tokens.size) return [];
    const scored: Array<[number, DocumentChunk]> = [];
    for (const chunk of this.data.get(collection) ?? []) {
      const chunkTokens = new Set(chunk.text.toLowerCase().split(/\s+/));
      if (!chunkTokens.size) continue;
      let overlap = 0;
      for (const t of tokens) if (chunkTokens.has(t)) overlap++;
      if (overlap) scored.push([overlap / tokens.size, chunk]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, k).map(([, c]) => c);
  }
}
