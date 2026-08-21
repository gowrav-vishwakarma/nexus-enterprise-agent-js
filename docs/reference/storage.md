# Storage

**Who this is for:** Developers choosing where chat history is saved.

## Key terms

- **Adapter** (`StorageAdapter`) — The backend that reads and writes chat-history JSON (memory, file, SQLite, and later PostgreSQL / Redis, or custom).
- **SessionScope** — Ownership filter (tenant / company / user) for load, list, delete, and append. Not the chat thread id.
- **Codec** — Converts an `AgentSession` to/from the JSON shape stored on disk or in a database.
- **Tenant-scoped** — Files organized by customer and user under a data root folder.
- **Session JSON** — The saved record for one chat thread (turns, tool calls, checkpoint `state`, metadata).

For how these relate to `RunContext` and cross-chat memory, see [Four objects people mix up](../architecture.md#four-objects-people-mix-up).

## Where to configure

**Preferred:** `storageConfig` on `AgentRunner` or `AgentOrchestrator`.

**Fallback:** `AgentConfig.storage` (simple local scripts only).

### Two ways to pass `storageConfig`

The runner argument wires **chat-history** persistence. It is not itself the adapter.

1. **Declarative** — Pass a `SessionStorageConfig`. Nexus builds a `StorageAdapter`, wraps it in a `SessionManager`, and uses that.
2. **Ready manager** — Pass a `SessionManager` that already holds your adapter (common in products with a custom table).

```text
SessionStorageConfig  →  StorageAdapter  →  SessionManager  →  runner
SessionManager(adapter)  ─────────────────→  runner  (skip the config step)
```

Cross-chat **user facts** use a different runner arg (`crossSessionMemoryStore`). See [Memory](memory.md).

Use `SessionManager.fromConfigAsync()` when the adapter is SQLite (or a custom class). The sync `fromConfig()` path only builds **memory** and **file** adapters.

## SessionStorageConfig

YAML fields stay snake_case.

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `adapter` | No | `"memory"` | Backend type (`memory`, `file`, `sqlite`, `postgresql`, `redis`, `custom`) |
| `adapter_config` | No | `{}` | Adapter-specific settings |
| `custom_adapter_class` | No | `null` | Import path when `adapter: custom` |
| `custom_memory_adapter_class` | No | `null` | Import path for a custom `CrossSessionMemoryStore` (used by `PersistenceFactory`, not chat JSON) |
| `codec_class` | No | `null` | Import path for a `SessionCodec`; empty uses `DefaultSessionCodec` |

## SessionScope

A **SessionScope** is an ownership filter for storage operations — like a WHERE clause on identity columns. Build it from `runContext.toScope()` (or from an `AgentSession.toScope()`).

It answers: “whose chat rows may this call touch?” It does **not** identify which chat thread. The chat thread id is `sessionId` (passed separately to `loadSession` / `run()`).

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `tenantId` | No | `null` | Customer / org id; `null` means do not filter on tenant |
| `companyId` | No | `null` | Company within a tenant; `null` means do not filter on company |
| `userId` | No | `null` | End-user id; `null` means do not filter on user |

Empty fields mean “do not filter on this dimension”. The runner wires scope from the current `RunContext` automatically.

### What happens when you change scope fields

| Scope you pass | Effect on `loadSession` / `listSessions` |
|----------------|------------------------------------------|
| `tenantId: "A"` only | Rows for tenant A (any company / user). Never tenant B. |
| `tenantId: "A", companyId: "12"` | Only company 12 under tenant A (typical multi-company ERP sidebar). |
| `tenantId: "A", companyId: "12", userId: "U"` | Only that user’s chats in that company (stricter; `toScope()` does this). |
| Wrong tenant / company / user | No match — load returns `null`; list is empty. Isolation, not a different session object. |

**Not the same as skill scope.** Learned skills use a separate skill `scope` setting (`global` / `tenant` / `user`). See [Skills](skills.md).

Adapters accept `scope` on:

- `loadSession`
- `listSessions` / `listSessionsByPrefix`
- `deleteSession`
- `appendTurn` / `updateTcSummary`

```ts
const scope = runContext.toScope();
const session = await adapter.loadSession(sessionId, scope);
```

## StorageAdapter interface

Every chat-history backend implements `StorageAdapter`. If you write a backend from scratch, implement all of these (`async`):

| Method | Required? | What it does |
|--------|-----------|--------------|
| `saveSession(session)` | Yes | Upsert one chat thread |
| `loadSession(sessionId, scope?)` | Yes | Load one thread (or `null`) |
| `listSessions({ agent_id, scope, limit, offset })` | Yes | List threads |
| `listSessionsByPrefix(prefix, { scope, exclude_session_ids })` | Yes | Multi-agent history by id prefix |
| `deleteSession(sessionId, scope?)` | Yes | Delete one thread |
| `appendTurn(sessionId, turn, scope?)` | Yes | Append a turn after each agent loop |
| `updateTcSummary(...)` | Yes | Patch a tool-call summary (RCS) |

## SessionCodec

A **SessionCodec** maps between the in-memory `AgentSession` and the JSON blob you store.

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `SessionCodec` | — | protocol | Implement `dumps(session)` → object and `loads(data, { ctx })` → `AgentSession` |
| `DefaultSessionCodec` | — | used when `codec_class` is unset | Canonical JSON |

Set `codec_class` on `SessionStorageConfig` to an import path such as `myapp/codecs.js#LegacyChatCodec`.

## Adapters

| Adapter | Extra | What it does |
|---------|-------|--------------|
| `memory` | none (always available) | In-process only; lost when the process exits |
| `file` | none (always available) | One `session.json` per chat under tenant/user folders |
| `sqlite` | `@libsql/client` | One database file per user with one row per chat |
| `postgresql` | `postgres` (optional peer) | Planned; currently falls back to memory |
| `redis` | `ioredis` (optional peer) | Planned; currently falls back to memory |
| `custom` | your module | Your class via `custom_adapter_class` |

```bash
# SQLite (libSQL client)
npm install @libsql/client

# Optional peers for later PostgreSQL / Redis adapters
npm install postgres ioredis
```

```ts
import { SessionManager } from "nexus-enterprise-agent";

const manager = await SessionManager.fromConfigAsync({
  adapter: "sqlite",
  adapter_config: { tenant_scoped: true },
});
```

## Tenant-scoped layout

Default data root: `./tenants` (override with `NEXUS_DATA_ROOT`):

```text
{NEXUS_DATA_ROOT}/
  _index/sessions.json
  {tenant_id}/users/{user_id}/
    sessions.db
    memory.db
    {session_id}/session.json
```

Missing `tenant_id` or `user_id` map to `_default`.

Set `tenant_scoped: false` on adapter config for legacy flat paths.

### File adapter config

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `data_root` | No | `NEXUS_DATA_ROOT` or `./tenants` | Root folder |
| `tenant_scoped` | No | `true` | Organize by tenant/user |
| `base_path` | No | `./nexus_sessions` | Legacy flat path when not tenant-scoped |
| `filename_template` | No | `{session_id}.json` | File name pattern |
| `overwrite_mode` | No | `full_rewrite` | `full_rewrite` or `append_jsonl` |
| `pretty_print` | No | `false` | Indent JSON |

### SQLite adapter config

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `data_root` | No | `NEXUS_DATA_ROOT` or `./tenants` | Root folder |
| `tenant_scoped` | No | `true` | One `sessions.db` per tenant/user |
| `db_path` | No | derived | Explicit database file |
| `table_prefix` | No | `nexus_` | Table name prefix |
| `wal_mode` | No | `true` | Write-ahead logging |
| `auto_migrate` | No | `true` | Create tables on first use |

## What is saved in each session

| Field | What it stores |
|-------|----------------|
| `turns[]` | User message, LLM messages, token counts |
| `tool_calls[]` | Tool name, input, raw and summarized responses, provider `call_id` |
| `summary_text` | Rolling narrative from folded turns (when `context_summary` is enabled) |
| `summary_through_turn` | Last turn index included in `summary_text` |
| `tenant_id`, `company_id`, `user_id`, `user_name` | Identity copied from `RunContext` |
| `title`, `pinned` | Sidebar title and pin flag |
| `attachment_ids` | Session-scoped staged attachment ids |
| `pending_interactions` | Client tools / elicitations waiting for `resume()` |
| `state` | Durable app checkpoint (survives the next request on the same chat thread) |
| `stream_seq` | Last emitted stream event number (for reconnects in your app) |
| timestamps, `metadata` | Created/updated times and arbitrary bag |

### ToolCallRecord extras

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `call_id` / `callId` | No | `""` | Provider tool-call id; links the assistant tool_call message to the tool result |

## Multi-agent chat history

Each team member gets its own session JSON, not one merged file:

```text
group-sess-1_researcher  →  own session
group-sess-1_analyst     →  own session
```

Use **one** `storageConfig` for the whole team.

## Environment variables

See [environment.md](environment.md) for `NEXUS_DATA_ROOT`.

## Next steps

- [Architecture](../architecture.md)
- [Run context](run-context.md)
- [Memory](memory.md)
