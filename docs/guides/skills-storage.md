# Skills storage (learned skills)

**Who this is for:** Developers who want agents to save and reuse learned skills per tenant, company, or user.

## Key terms

- **Learned skill** — Instructions saved at runtime (not only shipped as static folders).
- **Skill scope** — The partition key derived from `RunContext` (global / company / user).
- **Store backend** — Where learned skills live: memory, files, or your own class.

Static agentskills.io folders are unchanged. This guide covers the **learned** path.

## Why scope matters

Without a partition, every customer would share the same learned skills. The **scope resolver** builds a `SessionScope` from selected `RunContext` fields. The skill store uses that scope as a bucket key.

## Scope resolver

`SkillsConfig.scope` is a `SkillScopeConfig`:

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `keys` | No | `["tenantId", "companyId", "userId"]` | Which identity fields form the partition |
| `resolverClass` | No | `null` | Custom `SkillScopeResolver` import path |

### Common patterns

| Goal | Config |
|------|--------|
| Shared by everyone | `scope: { keys: [] }` |
| Per tenant | `scope: { keys: ["tenantId"] }` |
| Per company | `scope: { keys: ["tenantId", "companyId"] }` |
| Per user (default) | `scope: { keys: ["tenantId", "companyId", "userId"] }` |

```ts
import { createRunContext } from "nexus-enterprise-agent";
import { defaultSkillsConfig, type SkillsConfig } from "nexus-enterprise-agent/skills";

const skills: SkillsConfig = {
  ...defaultSkillsConfig(),
  enabled: true,
  storeBackend: "file",
  storeConfig: { root: "./learned_skills" },
  scope: { keys: ["tenantId", "companyId"] },
  injectLearned: true,
  retrievalK: 6,
  exposeManageTools: true,
};
```

YAML (pass the same keys your `SkillsConfig` expects — this package uses camelCase on the TypeScript object):

```yaml
skills:
  enabled: true
  storeBackend: file
  storeConfig:
    root: ./learned_skills
  scope:
    keys: [tenantId, companyId]
  injectLearned: true
  retrievalK: 6
  exposeManageTools: true
```

Pass matching identity on every run:

```ts
createRunContext({ tenantId: "acme", companyId: "co-1", userId: "u-42" });
```

## File vs memory backends

| Backend | When to use | Durability |
|---------|-------------|------------|
| `memory` | Unit tests, single-process demos | Lost when the process exits |
| `file` | Dev and single-server apps | Survives restarts; agentskills.io `SKILL.md` folders |
| `custom` | Your database or object store | You implement `SkillStore` |

### Memory

```yaml
skills:
  enabled: true
  storeBackend: memory
  exposeManageTools: true
```

Uses `InMemorySkillStore` (dict keyed by scope path segments).

### File

```yaml
skills:
  enabled: true
  storeBackend: file
  storeConfig:
    root: ./learned_skills
  scope:
    keys: [tenantId, companyId, userId]
```

`FileSkillStore` writes:

```text
./learned_skills/
  acme/co-1/u-42/
    invoice-tips/
      SKILL.md
```

Each file has YAML front matter plus the skill body — the same layout as static agentskills.io skills, so you can inspect and edit them by hand.

### Custom

```yaml
skills:
  enabled: true
  storeBackend: custom
  storeClass: ./postgres-skill-store.ts#PostgresSkillStore
  storeConfig:
    dsn: ${ENV:DATABASE_URL}
```

Implement the `SkillStore` protocol: `search`, `upsert`, `list`, `delete`, `disable`, `get` — each taking a `SessionScope`.

## Managing skills from the agent

With `exposeManageTools: true`, the model can call:

- `skill_manage.upsert` — create/update
- `skill_manage.list` — list for current scope
- `skill_manage.delete` / `skill_manage.disable`

Cron and subagent runs (`isCron` / `isSubagent`, or `persistable: false`) skip durable writes via `shouldPersist`.

## Injection flow

1. Resolve scope from `RunContext`.
2. Search the store (query from the user message / context), up to `retrievalK`.
3. If `injectLearned` is true, append a “Learned Skills” markdown block to the system prompt.

## Next steps

- [Custom storage adapter](custom-storage-adapter.md) — same scope idea for chat history
- [Runtime control](runtime-control.md)
- [SaaS example](saas-example.md)
