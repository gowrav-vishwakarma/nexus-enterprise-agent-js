/** Build a RAGProvider from RAGConfig. */

import { importFromPath } from "../orchestration/imports.js";
import { defaultRAGConfig, type RAGConfig } from "./config.js";
import { HashingEmbeddings } from "./embeddings.js";
import type { EmbeddingsProtocol, RAGProvider, Reranker } from "./protocol.js";
import { InMemoryRAGProvider } from "./providers/in-memory.js";
import { PassThroughReranker } from "./rerankers.js";

export async function buildRagProvider(
  config: RAGConfig,
  opts: {
    embeddings?: EmbeddingsProtocol | null;
    reranker?: Reranker | null;
    [key: string]: unknown;
  } = {},
): Promise<RAGProvider> {
  const { embeddings, reranker, ...extra } = opts;
  let embedder = embeddings ?? null;
  if (!embedder && config.embeddingsClass) {
    embedder = (await importFromPath(config.embeddingsClass)) as EmbeddingsProtocol;
  }
  if (!embedder) embedder = new HashingEmbeddings();

  let ranker = reranker ?? null;
  if (!ranker && config.rerankerClass) {
    ranker = (await importFromPath(config.rerankerClass)) as Reranker;
  }
  if (!ranker) ranker = new PassThroughReranker();

  const kwargs = { ...(config.providerConfig ?? {}), ...extra };

  if (config.provider === "custom_class") {
    if (!config.providerClass) {
      throw new Error(
        "RAGConfig.providerClass is required when provider is custom_class",
      );
    }
    const Cls = (await importFromPath(config.providerClass)) as new (
      args: unknown,
    ) => RAGProvider;
    return new Cls({ embeddings: embedder, reranker: ranker, config, ...kwargs });
  }

  if (config.provider === "pgvector") {
    throw new Error("pgvector RAG provider is not implemented in the JS port yet");
  }

  return new InMemoryRAGProvider({
    embeddings: embedder,
    reranker: ranker,
    config: { ...defaultRAGConfig(), ...config },
    ...kwargs,
  });
}
