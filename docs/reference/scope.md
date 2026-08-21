# Scope primitive

**Who this is for:** Developers partitioning memory, skills, RAG collections, artifacts, caches, and quotas by customer or user.

## Key terms

- **Scope** — A partition key built from identity fields on `RunContext`.
- **Scope level** — How wide the partition is: `global`, `tenant`, `company`, or `user`.
- **Placeholder** — `_` written when a field is missing, so a narrow write never lands in a wider bucket.

Nexus uses one **scope model** for memory, skills, RAG collections, artifacts, caches, and quotas.

## Levels

| Level | Fields used |
|-------|-------------|
| `global` | none |
| `tenant` | `tenantId` |
| `company` | `tenantId`, `companyId` |
| `user` | `tenantId`, `companyId`, `userId` |

## API

```ts
import { createRunContext, ScopeLevel, scopeKey } from "nexus-enterprise-agent";

const ctx = createRunContext({ tenantId: "acme", userId: "u1" });
const key = scopeKey(ctx, ScopeLevel.User, "memory");
// tenant:acme:company:_:user:u1:memory
```

Skills and memory configs that declare `keys: ["tenantId", "userId"]` (or snake_case `tenant_id` / `user_id`) use the same rules via `scopeKeysFromConfig()`.

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `ctx` | Yes | — | The current `RunContext` |
| `level` | Yes | — | `ScopeLevel.Global`, `.Tenant`, `.Company`, or `.User` |
| `namespace` | No | `""` | Extra suffix (`memory`, `rag`, `artifacts`) |

## Missing fields never widen a scope

Every level emits its own segment even when the context left that field empty, using `_` as a placeholder. A request with a tenant but no user gives:

```text
scopeKey(ctx, ScopeLevel.Tenant) -> "tenant:acme"
scopeKey(ctx, ScopeLevel.User)   -> "tenant:acme:company:_:user:_"
```

The two are different strings. If the narrower level collapsed onto the broader one, a user-scoped write for an unidentified user would land in the bucket the whole tenant reads.

## Sanitize before using a key as a path

`scopeKey` builds an identifier, not a filesystem path. Scope values come from request data, so a tenant id can contain `../`. Anything that turns a key into a path must sanitize each segment with `sanitizeSegment()` from `src/storage/paths.ts` and confirm the result stays inside its root — `LocalArtifactStore` does both.

## Formats that predate this primitive

Two storage layouts encode scope themselves and are **deliberately not** rebuilt on `scopeKey`, because both are persisted formats and changing them would orphan live data:

| Format | Shape | Where |
|--------|-------|-------|
| Session files | `tenants/{tenant}/users/{user}/{session}/` | `src/storage/paths.ts` |
| Cross-session memory key | `{tenant}:{user}:{namespace}` | `src/memory/cross-session-store.ts` |

Both are user-scoped in the sense above. The built-in memory store ignores `companyId` on purpose — memory belongs to a user within a tenant. A custom store that needs company separation receives `companyId` on every call and can use it.

## Next steps

- [Storage](storage.md)
- [Memory](memory.md)
- [Skills](skills.md)
- [RAG](rag.md)
