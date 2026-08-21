/** RAG configuration models. */

export type ChunkerStrategy = "fixed" | "recursive" | "semantic" | "none";
export type RAGProviderKind = "in_memory" | "pgvector" | "custom_class";
export type RAGScopeLevel = "global" | "tenant" | "company" | "user";

export interface ChunkerConfig {
  strategy?: ChunkerStrategy;
  chunkSize?: number;
  overlap?: number;
  contextual?: boolean;
}

export interface RetrievalConfig {
  k?: number;
  hybrid?: boolean;
  rerank?: boolean;
  rerankTopK?: number;
}

export interface RAGConfig {
  provider?: RAGProviderKind;
  providerClass?: string | null;
  providerConfig?: Record<string, unknown>;
  collection?: string;
  chunker?: ChunkerConfig;
  retrieval?: RetrievalConfig;
  embeddingsClass?: string | null;
  rerankerClass?: string | null;
  scopeLevel?: RAGScopeLevel;
}

export const defaultRAGConfig = (): RAGConfig => ({
  provider: "in_memory",
  providerClass: null,
  providerConfig: {},
  collection: "default",
  chunker: { strategy: "fixed", chunkSize: 512, overlap: 64, contextual: false },
  retrieval: { k: 5, hybrid: false, rerank: false, rerankTopK: 50 },
  embeddingsClass: null,
  rerankerClass: null,
  scopeLevel: "tenant",
});
