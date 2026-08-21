/** Retrieve tool for RAG. */

import { tool, toolPlugin } from "../tools/decorators.js";
import type { RunContext } from "../tools/context.js";
import { InMemoryRAGProvider } from "./providers/in-memory.js";
import type {
  EmbeddingsProtocol,
  RAGProvider,
  VectorStore,
} from "./protocol.js";

function isRagProvider(obj: unknown): obj is RAGProvider {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "retrieve" in obj &&
    "ingest" in obj
  );
}

@toolPlugin("rag")
export class RetrieveToolPlugin {
  static readonly pluginName = "rag";
  provider: RAGProvider;
  store: VectorStore | RAGProvider;
  embeddings?: EmbeddingsProtocol | null;

  constructor(
    storeOrProvider: VectorStore | RAGProvider,
    embeddings?: EmbeddingsProtocol | null,
    opts: { provider?: RAGProvider | null } = {},
  ) {
    if (opts.provider) {
      this.provider = opts.provider;
      this.store = storeOrProvider;
      this.embeddings = embeddings ?? null;
    } else if (isRagProvider(storeOrProvider)) {
      this.provider = storeOrProvider;
      this.store = storeOrProvider;
      this.embeddings = embeddings ?? null;
    } else {
      const wrapped = new InMemoryRAGProvider({ store: storeOrProvider, embeddings });
      this.provider = wrapped;
      this.store = storeOrProvider;
      this.embeddings = embeddings ?? wrapped.embeddings;
    }
  }

  @tool({ name: "retrieve", description: "Search the knowledge base for relevant passages." })
  async retrieve(
    query: string,
    k = 5,
    ctx?: RunContext | null,
  ): Promise<string> {
    if (!ctx) {
      return JSON.stringify({ ok: false, error: "missing context" });
    }
    const hits = await this.provider.retrieve(ctx, query, k);
    return JSON.stringify({
      ok: true,
      results: hits.map((h) => ({ text: h.text, metadata: h.metadata ?? {} })),
    });
  }
}

export function createRetrievePlugin(
  store: VectorStore | RAGProvider,
  embeddings?: EmbeddingsProtocol | null,
): RetrieveToolPlugin {
  return new RetrieveToolPlugin(store, embeddings);
}
