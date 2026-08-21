# Custom storage adapters

**Who this is for:** Developers whose product already has a chats table (or a non-canonical JSON shape) and need Nexus to read/write that layout.

## Key terms

- **Adapter** — Owns how rows or files are stored (connection, table name, WHERE clause).
- **Codec** — Owns how an `AgentSession` becomes a JSON dict (and back).
- **SessionScope** — Tenant / company / user filter passed into load/list/delete/append.
- **StorageAdapter** — The full interface every chat-history backend must implement.

## When to use a codec vs a custom adapter

| Situation | Use |
|-----------|-----|
| Same table/files as a built-in adapter, but different JSON keys inside the blob | `SessionCodec` via `codec_class` |
| Different columns, composite primary key, or product table name | Custom adapter implementing `StorageAdapter` |
| Both different columns **and** different JSON | Custom adapter **plus** a codec |

Keep the runner on `AgentSession`. Adapt at the storage boundary only.

This package does not ship a SQL helper base class. Implement `StorageAdapter` yourself (or wrap your existing repository).

## StorageAdapter — full interface

All methods are `async`. Pass `scope` on every read/mutate so tenants cannot see each other’s chats.

| Method | Required? | What it does |
|--------|-----------|--------------|
| `saveSession(session)` | Yes | Upsert the full chat thread |
| `loadSession(sessionId, scope?)` | Yes | Load one thread; return `null` if missing or out of scope |
| `listSessions({ agent_id, scope, limit, offset })` | Yes | List threads (newest first is typical) |
| `listSessionsByPrefix(sessionIdPrefix, { scope, exclude_session_ids })` | Yes | Multi-agent: sessions whose id starts with the prefix; sort by `createdAt` ascending |
| `deleteSession(sessionId, scope?)` | Yes | Delete one thread |
| `appendTurn(sessionId, turn, scope?)` | Yes | Atomically append one turn (used after each agent turn) |
| `updateTcSummary(sessionId, tcId, summarizedResponse, summarizedByTurn, scope?)` | Yes | Patch one tool-call summary inside the JSON (RCS) |

```ts
import { SessionManager } from "nexus-enterprise-agent";

// Implement every method on StorageAdapter (session module).
// Then wrap it: new SessionManager(adapter).

class MyStorageAdapter {
  async saveSession(session: AgentSession): Promise<void> {
    /* upsert */
  }

  async loadSession(
    sessionId: string,
    scope?: SessionScope | null,
  ): Promise<AgentSession | null> {
    return null;
  }

  async listSessions(options?: {
    agent_id?: string | null;
    scope?: SessionScope | null;
    limit?: number;
    offset?: number;
  }): Promise<AgentSession[]> {
    return [];
  }

  async listSessionsByPrefix(
    sessionIdPrefix: string,
    options?: {
      scope?: SessionScope | null;
      exclude_session_ids?: Set<string> | null;
    },
  ): Promise<AgentSession[]> {
    return [];
  }

  async deleteSession(sessionId: string, scope?: SessionScope | null): Promise<void> {
    /* delete */
  }

  async appendTurn(
    sessionId: string,
    turn: TurnRecord,
    scope?: SessionScope | null,
  ): Promise<void> {
    /* append one turn */
  }

  async updateTcSummary(
    sessionId: string,
    tcId: string,
    summarizedResponse: string,
    summarizedByTurn: number,
    scope?: SessionScope | null,
  ): Promise<void> {
    /* patch RCS summary */
  }
}
```

The public package export surface is `SessionManager` plus `PersistenceFactory`. Import adapter types from the session modules when you implement a backend.

## SessionCodec sketch

```ts
import type { AgentSession } from "nexus-enterprise-agent";

class SlimUiCodec {
  dumps(session: AgentSession): Record<string, unknown> {
    return {
      id: session.sessionId,
      title: session.title,
      turns: session.turns.map((t) => t.toJSON()),
    };
  }

  loads(data: string | Record<string, unknown>): AgentSession {
    // Parse your shape, then AgentSession.fromJSON(...)
    throw new Error("implement");
  }
}
```

Wire it:

```yaml
storage:
  adapter: file
  codec_class: ./slim-ui-codec.ts#SlimUiCodec
  adapter_config:
    data_root: ${ENV:NEXUS_DATA_ROOT|./data}
```

Or in TypeScript: set `codec_class` on `SessionStorageConfig`. Built-in adapters that accept a codec use `loadCodecAsync()`.

## Product-table example

Map your chats table to `AgentSession` fields:

- Identity: `tenantId` + `chatId` (`session.sessionId`)
- JSON blob column: your chat JSON
- Side columns: `companyId`, `userId`, `userName`
- Composite primary key: implement `saveSession` as an upsert on `(tenantId, chatId)`

```ts
class ProductChatsAdapter implements StorageAdapter {
  async saveSession(session: AgentSession): Promise<void> {
    session.updateTimestamp();
    await this.db.upsertChat({
      tenantId: session.tenantId,
      chatId: session.sessionId,
      companyId: session.companyId,
      userId: session.userId,
      userName: session.userName,
      chatJson: session.toJSON(),
    });
  }

  // ...load / list / delete / appendTurn / updateTcSummary, always filter by scope
}
```

Register with `adapter: custom` and `custom_adapter_class` pointing at your module.

## Scope checklist

1. Build `createRunContext({ tenantId, companyId, userId })`.
2. Let the runner call `toScope()` (or pass the same scope into your adapter).
3. Filter every load/list/delete/append with that scope so tenants cannot read each other’s chats.

## Next steps

- [Persistence resolver](persistence-resolver.md)
- [Custom memory stores](custom-memory-store.md)
- [SaaS example](saas-example.md)
