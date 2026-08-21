# RAG

**Who this is for:** Developers who want an agent to search a document collection (retrieval-augmented generation) without baking a vendor into the runner.

## Key terms

- **RAG** — Retrieval-augmented generation: look up passages, then let the LLM answer from them.
- **RAGProvider** — One object the runner talks to (`ingest` + `retrieve`).
- **Collection** — A named bucket of chunks, partitioned by tenant (or company/user) via `scopeKey`.
- **Chunker** — Splits raw text into smaller passages before embedding.
- **Hybrid search** — Dense (vector) search plus keyword search, fused with Reciprocal Rank Fusion.
- **Reranker** — Optional second pass that reorders candidate chunks (opt-in; may add latency).

Leave `AgentConfig.rag` unset (the default) to keep current behaviour: no `rag.retrieve` tool is registered. Existing apps that never set `rag` need no changes.

## Quick start

```ts
import { AgentRunner, createRunContext, parseAgentConfig, ToolRegistry } from "nexus-enterprise-agent";

const ctx = createRunContext({ tenantId: "acme", userId: "u1" });
const registry = new ToolRegistry();

// 1. Build an InMemoryRAGProvider (see src/rag).
// 2. await provider.ingest(ctx, ["Photosynthesis converts sunlight into energy."]);
// 3. registry.registerPlugin(createRetrievePlugin(provider));

const runner = new AgentRunner({
  config: parseAgentConfig({
    name: "librarian",
    llm,
    rag: { provider: "in_memory", retrieval: { k: 3, hybrid: true } },
  }),
  toolRegistry: registry,
  runContext: ctx,
});
const result = await runner.run("What is photosynthesis?");
```

`AgentConfig.rag` stores retrieval settings (chunk size, `k`, hybrid). Wire the live provider with `createRetrievePlugin` / `RetrieveToolPlugin` so the model sees `rag.retrieve`.

## RAGConfig

Set on `AgentConfig` as `rag` (optional). TypeScript prefers camelCase; YAML uses snake_case (`chunk_size`, `scope_level`).

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `provider` | No | `"in_memory"` | `in_memory`, `pgvector`, or `custom_class` |
| `providerClass` / `provider_class` | No | `null` | Import path when `provider` is `custom_class` |
| `providerConfig` / `provider_config` | No | `{}` | Extra constructor options (for `pgvector`, include `dsn`) |
| `collection` | No | `"default"` | Logical collection name (scoped by tenant at run time) |
| `chunker` | No | see ChunkerConfig | How ingested text is split |
| `retrieval` | No | see RetrievalConfig | How `retrieve()` searches |
| `embeddingsClass` | No | hashing embeddings | Import path to an `EmbeddingsProtocol` implementation |
| `rerankerClass` | No | pass-through | Import path to a `Reranker` implementation |
| `scopeLevel` / `scope_level` | No | `"tenant"` | `global`, `tenant`, `company`, or `user` partition |

`pgvector` is **not implemented** in this TypeScript package yet. Use `in_memory` or `custom_class`.

### ChunkerConfig

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `strategy` | No | `"fixed"` | `fixed`, `recursive`, `semantic`, or `none` |
| `chunkSize` / `chunk_size` | No | `512` | Target chunk size in characters |
| `overlap` | No | `64` | Character overlap between adjacent chunks |
| `contextual` | No | `false` | Prepend a short document-context string before embedding (opt-in cost) |

`semantic` needs an embeddings model. `contextual` does **not** call an LLM by itself: pass `metadata.context` or the first 200 characters of the source.

### RetrievalConfig

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `k` | No | `5` | Number of chunks to return |
| `hybrid` | No | `false` | Run dense + keyword search and fuse with Reciprocal Rank Fusion |
| `rerank` | No | `false` | Pass fused candidates through a reranker |
| `rerankTopK` / `rerank_top_k` | No | `50` | Candidate count fed to the reranker before cutting to `k` |

Contextual retrieval and reranking can add model calls or API latency. Keep them off until you need them.

## Protocols

| Protocol | Methods |
|----------|---------|
| `RAGProvider` | `ingest(ctx, documents, collection?)`, `retrieve(ctx, query, k?)` |
| `VectorStore` | `upsert(collection, chunks)`, `search(collection, queryEmbedding, k?)` |
| `EmbeddingsProtocol` | `embed(texts)` → `number[][]` |
| `Chunker` | `chunk(text, metadata?)` |
| `SparseIndex` | `upsert(collection, chunks)`, `search(collection, query, k?)` |
| `Reranker` | `rerank(query, chunks, k?)` |

`ingest` accepts a list of strings or a list of `DocumentChunk`. Nexus does not parse PDFs; that is the caller's job.

If you query a collection with a different embedding size than it was ingested with, the provider throws instead of returning a silent bad score.

## Built-in providers

| Provider | Extra | Notes |
|----------|-------|--------|
| `InMemoryRAGProvider` | none | Default for tests and local runs. Hashing embeddings if you do not pass a model. |
| `pgvector` | optional `postgres` peer | Not shipped in TypeScript yet. |

## Isolation

Collections are keyed with `scopeKey(ctx, scopeLevel, "rag")` (or `rag:{name}` for a named collection). Tenant A cannot retrieve tenant B's chunks.

## YAML

```yaml
agents:
  librarian:
    rag:
      provider: in_memory
      collection: handbook
      chunker:
        strategy: recursive
        chunk_size: 256
        overlap: 32
      retrieval:
        k: 3
        hybrid: true
```

## Next steps

- [Memory](memory.md) — user facts across chats (separate from RAG)
- [Scope](scope.md) — how tenant keys are built
- [Agent config](agent-config.md)
