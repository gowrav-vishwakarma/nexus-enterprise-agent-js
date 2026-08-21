# Per-tenant storage resolver

**Who this is for:** SaaS developers who need different databases or schemas per customer.

## Key terms

- **Persistence** — How and where Nexus saves session data and cross-chat memory.
- **Resolver** — Your class that picks storage settings per tenant and user.
- **Bundle** — Session manager + cross-session store wired together (`PersistenceBundle`).

## When to use

Use a `PersistenceResolver` when:

- Enterprise customers bring their own database
- Free tier uses in-memory or SQLite and paid tier uses another adapter
- You cannot use one global `storage` block for all tenants

## Protocol

Implement two methods:

| Method | Required? | What it returns |
|--------|-----------|-----------------|
| `resolveStorageConfig(tenantId, userId)` | Yes | `SessionStorageConfig` for this tenant |
| `resolveBundle(tenantId, userId)` | No | Optional full `PersistenceBundle` (or `null` / omit to use storage config only) |

## Example skeleton

```ts
import {
  OrchestrationManifest,
  OrchestrationRuntime,
  PersistenceFactory,
  createRunContext,
  type PersistenceResolver,
  type SessionStorageConfig,
} from "nexus-enterprise-agent";

class MyResolver implements PersistenceResolver {
  resolveStorageConfig(tenantId?: string | null, _userId?: string | null): SessionStorageConfig {
    const tenant = loadTenant(tenantId); // your database
    return {
      adapter: "sqlite",
      adapter_config: {
        data_root: tenant.dataRoot,
        tenant_scoped: true,
      },
    };
  }

  resolveBundle() {
    return null;
  }
}

const bundle = await PersistenceFactory.fromResolver(new MyResolver(), "acme", "u1");
```

Pass to orchestration:

```ts
const manifest = await OrchestrationManifest.load("examples/orchestration/research_team.yaml");
const runtime = await OrchestrationRuntime.fromManifest(manifest, {
  runContext: createRunContext({ tenantId: "acme", userId: "u1", sessionId: "chat-1" }),
  persistenceResolver: new MyResolver(),
});
```

Or use `PersistenceFactory.fromStorageConfig()` for a single global backend.

## Adapter notes

| Adapter | Status in this package |
|---------|------------------------|
| `memory` | Built-in (lost when the process exits) |
| `file` | Built-in |
| `sqlite` | Built-in (needs `@libsql/client` for some setups) |
| `postgresql` / `redis` | Config accepted; fall back to memory until implemented |
| `custom` | Your class via `custom_adapter_class` |

- `schema_mode: existing` — you own DDL; Nexus never creates tables (PostgreSQL config field; used when that adapter ships)
- `auto_migrate` defaults to **false** for PostgreSQL config
- See [custom storage adapter](custom-storage-adapter.md)

## Next steps

- [SaaS example](saas-example.md)
- [Custom storage adapter](custom-storage-adapter.md)
- [Custom memory store](custom-memory-store.md)
