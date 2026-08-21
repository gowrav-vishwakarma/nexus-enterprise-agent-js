/** Pass-through reranker. */

import type { DocumentChunk, Reranker } from "./protocol.js";

export class PassThroughReranker implements Reranker {
  async rerank(
    _query: string,
    chunks: DocumentChunk[],
    k = 5,
  ): Promise<DocumentChunk[]> {
    return chunks.slice(0, k);
  }
}

export class CohereReranker implements Reranker {
  constructor(
    private readonly apiKey: string,
    private readonly model = "rerank-v3.5",
  ) {}

  async rerank(
    _query: string,
    chunks: DocumentChunk[],
    k = 5,
  ): Promise<DocumentChunk[]> {
    void this.apiKey;
    void this.model;
    throw new Error("CohereReranker is not implemented in the JS port yet");
  }
}

export class BGEReranker implements Reranker {
  constructor(private readonly modelName = "BAAI/bge-reranker-v2-m3") {}

  async rerank(
    _query: string,
    _chunks: DocumentChunk[],
    _k = 5,
  ): Promise<DocumentChunk[]> {
    throw new Error(
      `BGEReranker (${this.modelName}) is not implemented in the JS port yet`,
    );
  }
}
