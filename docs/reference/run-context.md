# Run context

**Who this is for:** Developers wiring multi-tenant apps or tools that need request-scoped data.

## Key terms

- **Tenant** — One customer or organization in a multi-tenant app.
- **Company** — A company inside a tenant (multi-company products).
- **User** — One person using your app.
- **Session** — One chat thread (conversation). Same as **chat thread id**.
- **Metadata** — Extra key/value data your tools can read.
- **Service registry** — Private handles (DB pools, HTTP clients) on `RunContext` that are never serialized.
- **SessionScope** — Ownership filter (tenant / company / user) for chat-history load/list/delete. Built with `toScope()`. Not the chat thread id (`sessionId`). See [Four objects people mix up](../architecture.md#four-objects-people-mix-up).

TypeScript fields are **camelCase** (`tenantId`, `userId`). Snake_case getters (`tenant_id`, `user_id`) exist for YAML / Python-shaped code.

## RunContext fields

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `tenantId` | No | `null` | Which customer/org owns this call |
| `companyId` | No | `null` | Which company within the tenant (multi-company products) |
| `userId` | No | `null` | Which person (needed for cross-chat memory) |
| `userName` | No | `null` | Display name (copied onto the saved session when present) |
| `sessionId` | No | `null` | Default chat thread id if `run()` omits `sessionId` |
| `requestId` | No | `null` | Your tracing or correlation id |
| `channel` | No | `"web"` | Where the request came from (`web`, `voice`, `cron`, …) |
| `branchId` | No | `null` | Optional branch / environment id for your app |
| `auth` | No | `{}` | Auth claims your tools can read (never sent to the LLM) |
| `isCron` | No | `false` | Marks a scheduled job; turns off persistence via `shouldPersist` |
| `isSubagent` | No | `false` | Marks a nested agent run; turns off persistence via `shouldPersist` |
| `persistable` | No | `true` | Explicit off-switch for saving chat history and durable side effects |
| `metadata` | No | `{}` | Arbitrary bag; tools read via `ctx.get("key")` (per request; not checkpointed) |
| `state` | No | `{}` | Durable checkpoint state for this chat thread; synced to `AgentSession.state` when persisting |

Both `AgentRunner` and `AgentOrchestrator` default to an empty `createRunContext()` if you omit it.

### Persistence helper

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `shouldPersist` | — (getter) | derived | `false` when `persistable` is `false`, or when `isCron` / `isSubagent` is `true`; otherwise `true` |

The runner skips session save/append when `shouldPersist` is `false`. Memory and `skill_manage` write tools also skip durable writes in that case.

## Service registry methods

Services (database pools, HTTP clients, feature flags) live in a private map. They are **not** part of `metadata` and are never serialized with the session.

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `service(key, default?)` | No | — | Look up one registered service |
| `withService(key, value)` | No | — | Register one service; returns `this` for chaining |
| `bindServices(services)` | No | — | Register many services at once; returns `this` |
| `toScope()` | No | — | Build a `SessionScope` ownership filter from `tenantId` / `companyId` / `userId` (not the chat id) |

```ts
import { createRunContext } from "nexus-enterprise-agent";

const ctx = createRunContext({
  tenantId: "acme",
  companyId: "co-1",
  userId: "u-42",
})
  .withService("db", dbPool)
  .bindServices({ http: httpClient, flags: featureFlags });

const pool = ctx.service("db");
const scope = ctx.toScope(); // SessionScope for storage load/list/delete
```

## Nested runs: `deriveChild()`

When the orchestrator (or your code) starts a sub-agent, it builds a member context with:

```ts
const child = parent.deriveChild({
  sessionId: "team-sess_researcher",
  isSubagent: true,
  includeContext: true, // false when group context_sharing is isolated
});
```

**Always copied:** identity fields, `auth`, `channel`, flags, and all entries from `bindServices()` / `withService()`.

**Copied when `includeContext` is `true`:** shallow copies of `metadata` and `state` (refreshed again at run time when `context_sharing` is `inherit` or `shared`).

## When you need it

Use an explicit `RunContext` when you have:

- Multiple customers (tenants) or companies
- Per-user chat history
- Cross-chat memory (needs `userId`)
- Tools that need request data (plan tier, database handle, etc.)
- Cron or subagent runs that must not write chat history (`isCron` / `isSubagent`)

For a local script with one user, you can skip it and pass `sessionId` only on `run()`.

## Tool injection

If a tool declares a `ctx` or `run_context` parameter, the registry injects `RunContext` automatically. That parameter is **not** sent to the LLM.

```ts
import { defineTool, createRunContext } from "nexus-enterprise-agent";

const tenantSettings = defineTool(
  (ctx) => `Settings for tenant ${ctx.tenantId} company ${ctx.companyId}`,
  { name: "tenant_settings", description: "Read tenant settings" },
);
```

Tools can also **write** metadata for later tools in the same run:

```ts
const reserveSlot = defineTool(
  (ctx, slotId: string) => {
    ctx.set("reserved_slot", slotId);
    return `Reserved ${slotId}`;
  },
  { name: "reserve_slot" },
);
```

Use **`ctx.setState()` / `ctx.getState()`** when a value must survive the next message on the same `sessionId`. Use **`ctx.set()` / `ctx.get()`** for per-request data only. See [agent-runner.md](agent-runner.md).

## Multi-agent teams

Pass one `RunContext` into `AgentOrchestrator` or `OrchestrationRuntime`. Member runners get derived chat ids: `{groupSessionId}_{memberName}` and, by default, `isSubagent: true` (see `AgentGroupConfig.persist_members`).

Members are constructed with `RunContext.deriveChild()` so they inherit identity and services from the group context. See [multi-agent.md](multi-agent.md) for `context_sharing`.

Set `sessionId` **before** creating the orchestrator/runtime.

## Per-request skills

Pass skill names in metadata (with `activation_mode` `explicit` or `both`):

```ts
createRunContext({ metadata: { skills: ["code-review"] } });
```

See [skills.md](skills.md).

## Voice agents

The cascaded voice pipeline writes language and IVR keys into `metadata` before each LLM turn. Tools read and write the same bag on `RunContext`:

| Key | Written by | Read in tools |
|-----|------------|---------------|
| `reply_language`, `reply_language_name`, `detected_language`, `allowed_languages` | Pipeline (hi, en, gu, ta, te, bn, mr, …) | Optional in custom tools |
| `ivr_actions` | `ivr_menu` tools | Transport / telephony layer |
| `dtmf_buffer` | WebSocket/SIP transport | `collect_dtmf` |
| `dtmf_expected`, `ivr_terminal` | `ivr_menu` tools | Pipeline turn control |

Full table: [realtime-agents.md](realtime-agents.md#voice-metadata-prompts-and-tools).

## Next steps

- [Architecture](../architecture.md)
- [Storage](storage.md)
- [Runner](agent-runner.md)
