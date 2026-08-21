/** RAG protocols and document chunk model. */

import type { RunContext } from "../tools/context.js";

export interface DocumentChunk {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
  embedding?: number[] | null;
}

export interface EmbeddingsProtocol {
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorStore {
  upsert(collection: string, chunks: DocumentChunk[]): Promise<void>;
  search(
    collection: string,
    queryEmbedding: number[],
    k?: number,
  ): Promise<DocumentChunk[]>;
}

export interface Chunker {
  chunk(
    text: string,
    opts?: { metadata?: Record<string, unknown> | null },
  ): Promise<DocumentChunk[]>;
}

export interface SparseIndex {
  upsert(collection: string, chunks: DocumentChunk[]): Promise<void>;
  search(collection: string, query: string, k?: number): Promise<DocumentChunk[]>;
}

export interface Reranker {
  rerank(
    query: string,
    chunks: DocumentChunk[],
    k?: number,
  ): Promise<DocumentChunk[]>;
}

export interface RAGProvider {
  ingest(
    ctx: RunContext,
    documents: DocumentChunk[] | string[],
    opts?: { collection?: string | null },
  ): Promise<void>;
  retrieve(ctx: RunContext, query: string, k?: number): Promise<DocumentChunk[]>;
}
