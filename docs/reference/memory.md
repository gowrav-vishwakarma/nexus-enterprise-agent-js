# Memory

**Who this is for:** Developers who want agents to remember facts about a user across chat threads.

## Key terms

- **User memory** — Durable key/value facts about a user, stored outside the chat session JSON.
- **Cross-session memory store** — The live object that holds user memory (`CrossSessionMemoryStore`). Pass it as `crossSessionMemoryStore` on the runner.
- **Named store** — A labeled bucket inside memory (for example `user` vs `notes`) with its own inject policy.
- **Curator** — An optional extra LLM call that extracts facts after each turn and writes them to the store.
- **Memory tools** — `memory.write` / `search` / `list` / `remove` the agent can call when `expose_tools` is on. With `require_approval`, also `memory.approve` / `reject` / `edit`.
- **Memory provider** — Optional richer backend (`MemoryProvider`) for semantic search. Unset = keep the key/value store path.
- **Chat history** — The full turn-by-turn conversation in `AgentSession.turns` (within one chat thread). Saved via `storageConfig`, not via the memory store.
- **RCS** — Runtime Context Summarization; compresses tool results in context. Not a fact store.

Chat JSON vs user facts vs ownership filter: [Four objects people mix up](../architecture.md#four-objects-people-mix-up).

## Two mechanisms

| Question | Mechanism | Survives new chat thread? |
|----------|-----------|---------------------------|
| Remember within this chat? | `session.turns` + optional RCS summaries (via `storageConfig`) | No (same `sessionId` only) |
| Remember this user next time? | `memory` config + `crossSessionMemoryStore` | Yes (with a persistent store) |
| Search a large document set? | Opt-in [RAG](rag.md) (`AgentConfig.rag`) | N/A (not user-fact memory) |

Within a single chat, the conversation history is the context. For long chats, enable [RCS](agent-config.md) to compress tool outputs and optional [context summary](context-summary.md) to fold older turns into `summary_text`.

## MemoryConfig

Set on `AgentConfig` as `memory`. YAML uses snake_case.

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `enabled` | No | `false` | Master switch; if false, no curator runs and facts are not injected |
| `expose_tools` | No | `true` | When enabled, auto-register the `memory` tool plugin |
| `namespace` | No | `""` | Isolation key for facts (empty = agent name) |
| `stores` | No | `[]` | Named stores; empty = single default store |
| `max_entities` | No | `100` | Max stored facts (oldest dropped beyond cap) |
| `extract_after_each_turn` | No | `true` | Run curator after each turn |
| `extract_at_end` | No | `false` | Run curator once more after `run()` finishes |
| `extraction_interval` | No | `0` | Run every N turns instead (0 = use `extract_after_each_turn` only) |
| `inject_into_prompt` | No | `true` | Show `user_memory` in the system prompt |
| `curator_llm` | No | agent's LLM | Cheaper model for extraction |
| `curator_prompt` | No | default prompt | Custom curator prompt |
| `curator_agent` | No | `null` | Full `AgentConfig` used as curator (advanced) |
| `max_conversation_chars` | No | `6000` | Max chars fed to the curator |
| `provider` | No | `null` | Optional backend: `builtin_semantic`, `builtin_kv`, or `custom_class`. `null` uses `CrossSessionMemoryStore` directly |
| `provider_class` | No | `null` | Import path when `provider` is `custom_class` |
| `provider_config` | No | `{}` | Extra constructor options |
| `require_approval` | No | `false` | When `true`, curator and `memory.write` go to a `pending` store; only approved facts are injected |

## MemoryStoreConfig (named stores)

Use `stores` when you want more than one bucket (profile vs agent notes):

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `name` | Yes | — | Store name, e.g. `user` or `memory` |
| `description` | No | `""` | Shown in prompts / tools |
| `inject` | No | `"always"` | `"always"` = inject into system prompt; `"on_recall"` = only via tool search |
| `char_budget` | No | `0` | Soft char budget for always-injected stores (`0` = no budget) |
| `max_entries` | No | `100` | Max keys in this store |

```ts
const memory = {
  enabled: true,
  expose_tools: true,
  stores: [
    { name: "user", inject: "always", description: "Stable user profile" },
    { name: "notes", inject: "on_recall", description: "Searchable notes" },
  ],
};
```

- **`inject: "always"`** — Facts appear in the system prompt at run start (subject to `inject_into_prompt`). With more than one store, keys are prefixed as `{store}/{key}`. Soft `char_budget` trims what is injected (does not delete from the store).
- **`inject: "on_recall"`** — Facts stay out of the prompt until the agent calls `memory.search` / `memory.list`.

When `stores` is empty, tools and inject use a single store named `default`.

## Memory tool plugin

When `enabled: true` and `expose_tools: true`, the runner registers the `memory` plugin:

| Tool | What it does |
|------|--------------|
| `memory.write` | Save a durable fact (`key`, `value`, optional `store`) |
| `memory.search` | Substring or provider search (`query`, optional `store`, `k`) |
| `memory.list` | List all facts in a store |
| `memory.remove` | Delete a fact by key |
| `memory.approve` | Move a pending fact into the injectable store (`require_approval` only) |
| `memory.reject` | Discard a pending fact (`require_approval` only) |
| `memory.edit` | Change a pending fact before approving it (`require_approval` only) |

Writes are skipped when `RunContext.userId` is missing or `shouldPersist` is `false` (cron / subagent / `persistable: false`).

## Memory providers

When `memory.provider` is unset, the runner and `MemoryPlugin` call `load` / `save` / `mergeEntities` on `crossSessionMemoryStore`. Custom stores need **zero** edits.

When `memory.provider` is set, tools and prompt injection go through `MemoryProvider`:

| Method | What it does |
|--------|--------------|
| `prefetch(ctx)` | Facts injected into the system prompt |
| `search(ctx, query, k)` | Semantic or keyword search |
| `write` / `remove` | Mutate one fact |
| `listStores(ctx)` | Named store list |
| `curate(ctx, turnSummary)` | Optional provider-side write after a turn |

| Provider id | Extra | Notes |
|-------------|-------|--------|
| `builtin_semantic` / `builtin_kv` | none | Wraps `CrossSessionMemoryStore` and adds token-overlap search |
| `custom_class` | your module | `provider_class` import path |

Vendor SDKs such as Mem0 or Honcho are **not** bundled. Write a `custom_class` wrapper if you need them.

## Human review (`require_approval`)

Default is `false`: the curator writes injectable facts immediately.

When `true`:

1. Curator and `memory.write` write to a `pending` store.
2. Prompt injection (`prefetch`) returns only approved facts.
3. The agent (or an operator via `resume()`) calls `memory.approve`, `memory.reject`, or `memory.edit`.

## Isolation scope

Cross-chat memory is **not** shared across an entire tenant. Facts are stored per **tenant + user + namespace** (and per named store as a namespace suffix). Custom stores may also scope by **company** via the optional `companyId` argument on `load` / `save` / `mergeEntities`.

| Scope | Shared across users in the same tenant? |
|-------|----------------------------------------|
| Tenant only | No |
| Tenant + user | Yes (this is the unit of memory) |
| Tenant + company + user | Yes, when the custom store uses `companyId` |
| Chat thread (`sessionId`) | Yes — a user’s facts follow them into new threads |
| Agent (`memory.namespace`, or agent name by default) | No — each agent keeps its own fact set |
| Named store | No — `user` and `notes` are separate namespaces |

Pass `RunContext.tenantId` and a stable `RunContext.userId` on every run.

## Requirements

When `memory.enabled` is true, you also need:

1. `crossSessionMemoryStore` on `AgentRunner` / orchestrator — a **live store instance** (not a config object). Chat history still uses `storageConfig` separately.
2. `RunContext.userId` on every run

If either is missing, load and write are skipped silently.

With YAML orchestration, `PersistenceFactory` can build a matching store from `SessionStorageConfig`. On the TypeScript `AgentRunner` path you usually construct and pass the store yourself.

## Built-in cross-session stores

| Store | When to use |
|-------|-------------|
| `InMemoryCrossSessionMemoryStore` | Tests and single-process apps; lost on exit |
| `SQLiteCrossSessionMemoryStore` | Durable facts. `tenant_scoped: true` (default) writes `{data_root}/{tenant}/users/{user}/memory.db`. `tenant_scoped: false` uses `db_path` (one file, e.g. per company). |
| `PostgreSQLCrossSessionMemoryStore` | Shared Postgres. Same DSN / pool as the session adapter when `adapter: postgresql`. Requires the `postgres` package. |

`PersistenceFactory.fromStorageConfig` builds the matching store: `sqlite`/`file` → SQLite store, `postgresql` → Postgres store. Redis memory is not implemented yet. Chat history still uses a separate `StorageAdapter` — see [storage.md](storage.md).

`AgentRunner` registers `memory.*` tools when `enabled && expose_tools`, runs `MemoryCurator` after turns / at end when those flags are on, and prefers `MemoryProvider.prefetch` when a provider is passed.

## Prompt injection

Facts appear in the system prompt as the Nunjucks variable `user_memory` (a dict of key/value strings). The default template includes an "About this user" block when `user_memory` is non-empty.

The runner loads `user_memory` at run start, passes it on every context build, and reloads after the curator updates the store.

## When to skip memory

If you only need within-chat context, rely on chat history and RCS. Memory is fully opt-out: leave `memory.enabled` false (the default).

## Note on `MemoryStorageAdapter`

`MemoryStorageAdapter` is the in-process **session** storage backend (chat history). It is unrelated to the memory feature described here.

## Next steps

- [RAG](rag.md) — document retrieval (separate from user facts)
- [Agent config](agent-config.md)
- [Storage](storage.md)
- [Run context](run-context.md)
