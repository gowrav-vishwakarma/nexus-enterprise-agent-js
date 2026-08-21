/** In-memory RAG provider. */

import { ScopeLevel, scopeKey } from "../../scope.js";
import type { RunContext } from "../../tools/context.js";
import { buildChunker } from "../chunking.js";
import { defaultRAGConfig, type RAGConfig } from "../config.js";
import { HashingEmbeddings } from "../embeddings.js";
import { reciprocalRankFusion } from "../fusion.js";
import { InMemorySparseIndex, InMemoryVectorStore } from "../memory.js";
import type {
  DocumentChunk,
  EmbeddingsProtocol,
  RAGProvider,
  Reranker,
  SparseIndex,
  VectorStore,
} from "../protocol.js";
import { PassThroughReranker } from "../rerankers.js";

export function scopedCollectionKey(
  ctx: RunContext,
  opts: { collection?: string; scopeLevel?: string } = {},
): string {
  const collection = opts.collection ?? "default";
  const scopeLevel = opts.scopeLevel ?? "tenant";
  const level = scopeLevel as ScopeLevel;
  const ns =
    collection === "" || collection === "default" || collection === "rag"
      ? "rag"
      : `rag:${collection}`;
  return scopeKey(ctx, level, ns);
}

export class InMemoryRAGProvider implements RAGProvider {
  config: RAGConfig;
  embeddings: EmbeddingsProtocol;
  store: VectorStore;
  sparse: SparseIndex;
  chunker: {
    chunk(
      text: string,
      opts?: { metadata?: Record<string, unknown> | null },
    ): Promise<DocumentChunk[]>;
  };
  reranker: Reranker;

  constructor(opts: {
    embeddings?: EmbeddingsProtocol | null;
    store?: VectorStore | null;
    sparse?: SparseIndex | null;
    chunker?: InMemoryRAGProvider["chunker"] | null;
    reranker?: Reranker | null;
    config?: RAGConfig | null;
  } = {}) {
    this.config = { ...defaultRAGConfig(), ...opts.config };
    this.embeddings = opts.embeddings ?? new HashingEmbeddings();
    this.store = opts.store ?? new InMemoryVectorStore();
    this.sparse = opts.sparse ?? new InMemorySparseIndex();
    const chunkerCfg = this.config.chunker ?? {};
    this.chunker =
      opts.chunker ??
      buildChunker(chunkerCfg.strategy ?? "fixed", {
        chunkSize: chunkerCfg.chunkSize,
        overlap: chunkerCfg.overlap,
        contextual: chunkerCfg.contextual,
        embeddings: this.embeddings,
      });
    this.reranker = opts.reranker ?? new PassThroughReranker();
  }

  private collection(ctx: RunContext, collection?: string | null): string {
    return scopedCollectionKey(ctx, {
      collection: collection ?? this.config.collection,
      scopeLevel: this.config.scopeLevel,
    });
  }

  async ingest(
    ctx: RunContext,
    documents: DocumentChunk[] | string[],
    opts: { collection?: string | null } = {},
  ): Promise<void> {
    const col = this.collection(ctx, opts.collection);
    const chunks: DocumentChunk[] = [];
    for (const doc of documents) {
      if (typeof doc === "string") {
        chunks.push(...(await this.chunker.chunk(doc)));
      } else {
        chunks.push(doc);
      }
    }
    if (!chunks.length) return;
    const missing = chunks.filter((c) => !c.embedding?.length);
    if (missing.length) {
      const vectors = await this.embeddings.embed(missing.map((c) => c.text));
      missing.forEach((chunk, i) => {
        chunk.embedding = vectors[i]!;
      });
    }
    await this.store.upsert(col, chunks);
    await this.sparse.upsert(col, chunks);
  }

  async retrieve(ctx: RunContext, query: string, k = 5): Promise<DocumentChunk[]> {
    const col = this.collection(ctx);
    const retrieval = { ...defaultRAGConfig().retrieval, ...this.config.retrieval };
    let candidateK = Math.max(k, retrieval.k ?? 5);
    if (retrieval.hybrid || retrieval.rerank) {
      candidateK = Math.max(candidateK, retrieval.rerankTopK ?? 50);
    }
    const vectors = await this.embeddings.embed([query]);
    const dense = await this.store.search(col, vectors[0]!, candidateK);
    let fused: DocumentChunk[];
    if (retrieval.hybrid) {
      const sparseHits = await this.sparse.search(col, query, candidateK);
      fused = reciprocalRankFusion([dense, sparseHits], { topN: candidateK });
    } else {
      fused = dense;
    }
    if (retrieval.rerank) {
      return this.reranker.rerank(query, fused, k);
    }
    return fused.slice(0, k);
  }
}
