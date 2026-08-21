# Custom memory stores

**Who this is for:** Developers whose product already has a user-memory table (or needs company-scoped facts) and want Nexus to load/save that layout.

## Key terms

- **Cross-session memory store** — Implements `CrossSessionMemoryStore` (`load` / `save` / `mergeEntities`).
- **Named store** — A bucket inside memory (for example `user` vs `memory`) selected via `MemoryConfig.stores`.
- **Namespace** — Isolation key: base namespace (agent name or `memory.namespace`), plus `:{store_name}` for named stores.
- **Memory plugin** — Built-in tools `memory.write` / `search` / `list` / `remove` registered when `memory.expose_tools` is true.

## When to implement a custom store

| Situation | Use |
|-----------|-----|
| In-memory is fine for tests or a single process | `InMemoryCrossSessionMemoryStore` |
| Your table has different columns / company scope / char caps | Custom class implementing `CrossSessionMemoryStore` |

`SQLiteCrossSessionMemoryStore`, `PostgreSQLCrossSessionMemoryStore`, and `RedisCrossSessionMemoryStore` are currently **aliases** of the in-memory store. For durable product memory, implement the interface yourself.

Keep the runner on flat `entityMemory` dicts. Adapt at the store boundary only.

## CrossSessionMemoryStore — required methods

Implement these three methods (all `async`). Optional `companyId` is passed from `RunContext.companyId` by the runner, curator, and memory plugin. The built-in in-memory store ignores it; product stores may require it.

| Method | Required? | What it does |
|--------|-----------|--------------|
| `load(tenantId, userId, namespace, { companyId })` | Yes | Return one `CrossSessionMemoryRecord`, or `null` |
| `save(record, { companyId })` | Yes | Upsert the full record (replace `entityMemory`) |
| `mergeEntities(tenantId, userId, namespace, entities, { maxEntities, companyId })` | Yes | Merge key/value facts; enforce `maxEntities` |

```ts
import {
  createCrossSessionMemoryRecord,
  type CrossSessionMemoryRecord,
  type CrossSessionMemoryStore,
} from "nexus-enterprise-agent";

class MyProductMemoryStore implements CrossSessionMemoryStore {
  async load(
    tenantId: string | null | undefined,
    userId: string,
    namespace: string,
    opts?: { companyId?: string | null },
  ): Promise<CrossSessionMemoryRecord | null> {
    return null;
  }

  async save(
    record: CrossSessionMemoryRecord,
    opts?: { companyId?: string | null },
  ): Promise<void> {
    /* upsert */
  }

  async mergeEntities(
    tenantId: string | null | undefined,
    userId: string,
    namespace: string,
    entities: Record<string, string>,
    opts: { maxEntities: number; companyId?: string | null },
  ): Promise<CrossSessionMemoryRecord> {
    const existing =
      (await this.load(tenantId, userId, namespace, opts)) ??
      createCrossSessionMemoryRecord({ tenantId, userId, namespace });
    existing.entityMemory = { ...existing.entityMemory, ...entities };
    await this.save(existing, opts);
    return existing;
  }
}
```

`CrossSessionMemoryRecord` fields: `tenantId`, `userId`, `namespace`, `entityMemory` (string key → string value), `updatedAt`.

## Optional: `search` hook

The memory plugin’s `memory.search` tool looks for an optional method on your store:

```ts
async search(
  tenantId: string | null | undefined,
  userId: string,
  namespace: string,
  query: string,
  opts?: { k?: number; companyId?: string | null },
): Promise<Array<{ key: string; value: string }>> {
  return [];
}
```

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `search(...)` | No | — | If missing, the plugin loads the record and does a simple substring filter |

## Wire it

**Directly on the runner (preferred for SaaS apps):**

```ts
const runner = new AgentRunner({
  config, // include memory: { enabled: true, ... }
  toolRegistry: registry,
  crossSessionMemoryStore: new MyProductMemoryStore(),
  runContext: ctx,
});
```

**Via PersistenceFactory:**

```ts
import { PersistenceFactory } from "nexus-enterprise-agent";

const bundle = await PersistenceFactory.fromStorageConfig({
  adapter: "memory", // session backend; independent of memory store
  custom_memory_adapter_class: "./memory-store.ts#MyProductMemoryStore",
  adapter_config: { dsn: "..." },
});
```

`adapter_config` is passed as constructor args to your store.

When `memory.expose_tools` is `true`, the runner registers the memory plugin and tool calls hit `mergeEntities` / `load` / `save` / optional `search` on this store.

## Named stores and inject

When `MemoryConfig.stores` lists buckets with `inject: "always"`, the runner loads **each** of those namespaces and merges them for the system prompt. Keys from multiple stores are prefixed as `{store}/{key}`. Soft `char_budget` trims inject only (it does not delete rows).

Namespace rule (same as the memory plugin):

- Base = `memory.namespace` or the agent name
- Named store `user` → `{base}:user`
- Store name `default` (or empty stores list) → base only

## Next steps

- [Custom storage adapters](custom-storage-adapter.md) (chat sessions)
- [Persistence resolver](persistence-resolver.md)
- [Prompt templates](prompts-jinja.md)
