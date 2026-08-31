# Skills

**Who this is for:** Developers using portable skill folders (agentskills.io standard) and optional learned skills that persist per tenant/company/user.

## Key terms

- **Skill** — A folder with `SKILL.md` instructions the agent can load on demand.
- **Catalog** — Names and descriptions injected into the system prompt at run start.
- **Activation** — Loading the full `SKILL.md` body into context.
- **Learned skill** — A skill written at runtime (by tools or a subagent) into a skill store.
- **Skill scope** — Which `RunContext` fields partition learned skills (global / company / user).
- **Skill store** — Backend that saves learned skills (`none`, `memory`, `file`, or `custom`).

## How it works (static skills)

| Stage | What loads | When |
|-------|------------|------|
| Advertise | Skill name + description | Start of run (`activation_mode` auto or both) |
| Activate | Full `SKILL.md`, or one `##` section | Agent calls `skills.load_skill` (optional `section`) |
| Execute | Files in `references/`, `assets/` | Agent calls `skills.read_skill_resource` |

## Folder layout (agentskills.io)

```text
skills/
└── code-review/
    ├── SKILL.md
    ├── references/
    └── assets/
```

Set the path with `NEXUS_SKILLS_ROOT` (default `./skills`).

## SkillsConfig

YAML uses snake_case; TypeScript prefers camelCase (`activationMode`, `globalPaths`).

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `enabled` | No | `false` | Turn skills on for this agent |
| `activation_mode` / `activationMode` | No | `"auto"` | `"auto"`, `"explicit"`, or `"both"` |
| `global_paths` / `globalPaths` | No | `[NEXUS_SKILLS_ROOT]` | Directories to scan for static skills |
| `explicit_skills` / `explicitSkills` | No | `[]` | Skill names to pre-load every run |
| `enabled_skills` / `enabledSkills` | No | `null` | Allowlist; `null` = all discovered |
| `allow_scripts` / `allowScripts` | No | `false` | Expose script execution tool |
| `allow_tenant_skills` / `allowTenantSkills` | No | `false` | Per-tenant static skill dirs |
| `allow_user_skills` / `allowUserSkills` | No | `false` | Per-user static skill dirs |
| `scope` | No | see SkillScopeConfig | Which identity fields partition **learned** skills |
| `store_backend` / `storeBackend` | No | `"none"` | `"none"`, `"memory"`, `"file"`, or `"custom"` |
| `store_class` / `storeClass` | No | `null` | Import path when `store_backend` is `custom` |
| `store_config` / `storeConfig` | No | `{}` | Backend kwargs (e.g. `root` for file store) |
| `retrieval_k` / `retrievalK` | No | `6` | Max learned skills injected per turn from search |
| `inject_learned` / `injectLearned` | No | `true` | Inject relevant learned skills into the system prompt |
| `expose_manage_tools` / `exposeManageTools` | No | `false` | Register `skill_manage` tools on the main agent |

When `enabled: true`, the runner auto-registers the `skills` tool plugin. You do **not** add `"skills"` to `tool_plugins` yourself. Also do **not** add `"skills"` to a `toolset` allow-list; the runner manages skill tools independently of your registry-defined toolsets.

### SkillScopeConfig

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `keys` | No | `["tenantId", "companyId", "userId"]` | Ordered `RunContext` fields that form the learned-skill partition |
| `resolver_class` | No | `null` | Optional import path for a custom `SkillScopeResolver` |

Examples:

| `keys` | Meaning |
|--------|---------|
| `[]` | Global learned skills shared by everyone |
| `["tenantId"]` | Per tenant |
| `["tenantId", "companyId"]` | Per company |
| `["tenantId", "companyId", "userId"]` | Per user (default) |

## Activation modes

| Mode | System prompt | Tools |
|------|---------------|-------|
| `auto` | Catalog only | `load_skill` (optional `section`), `read_skill_resource` |
| `explicit` | Full bodies of listed skills | Same |
| `both` | Explicit bodies + catalog for rest | Same |

Per-request skills via `createRunContext({ metadata: { skills: ["code-review"] } })` with `explicit` or `both` mode.

## Section disclosure (`section=`)

`skills.load_skill(skill_name, section="all")` is the default: the full body plus a short index of `##` headings.

Pass `section` (matched case-insensitively against a heading) to inject only that part:

```text
skills.load_skill("code-review", section="security")
```

Unknown sections return an error that lists the available headings. This keeps the prompt small (catalog → body → one section) instead of always dumping the whole file.

## Learned skills

Learned skills sit beside static agentskills.io folders. They are stored under a **skill scope** and optionally injected each turn.

### Store backends

| `store_backend` | What it does |
|-----------------|--------------|
| `none` | No learned-skill persistence (default) |
| `memory` | In-process dict store (tests / single process) |
| `file` | Folders with `SKILL.md` under a root (agentskills.io layout) |
| `custom` | Your class via `store_class` |

### FileSkillStore layout

With `store_backend: file` and a root path, skills are written as:

```text
{root}/
  {tenant_id}/{company_id}/{user_id}/
    my-skill/
      SKILL.md
  _global/          # when all scope fields are empty
    shared-skill/
      SKILL.md
```

Each `SKILL.md` uses YAML front matter (`name`, `trigger`, `source`, `enabled`, `use_count`) plus a markdown body.

### skill_manage tools

When `expose_manage_tools: true` and a store is configured, the runner registers:

| Tool | What it does |
|------|--------------|
| `skill_manage.upsert` | Create or update a learned skill (`name`, `trigger`, `content`) |
| `skill_manage.list` | List learned skills for the current scope |
| `skill_manage.delete` | Delete by name |
| `skill_manage.disable` | Soft-disable a skill |

Writes are skipped when `RunContext.shouldPersist` is `false`.

### Injection

When `inject_learned: true`, the runner searches the store (up to `retrieval_k` matches) and appends a “Learned Skills” block to the system prompt.

## Static skills limits

- Install skills you trust — text is injected into prompts
- Script execution off by default (`allowScripts: false`)
- Tenant/user static folders require `allow_tenant_skills` / `allow_user_skills`

### Resource path confinement

`read_skill_resource` goes through `validateResourcePath`, which rejects a path unless it resolves to the skill directory itself or something beneath it, and refuses any symlink along the way. The comparison is separator-aware, so a sibling folder that merely shares a name prefix (`code-review-evil` for root `code-review`) is rejected.

Reuse `isPathWithinDirectory(path, directory)` if you build your own file tool. It returns `true` only for the directory itself or a genuine descendant.

The script sandbox is a different matter: `LocalProcessSandbox` spawns a child process with a timeout and **no filesystem confinement**. Treat enabling `allowScripts` as running that code with your process's own permissions.

```ts
import { createRunContext, SkillsRegistry } from "nexus-enterprise-agent";

const ctx = createRunContext({
  tenantId: "acme",
  userId: "u-1",
  metadata: { skills: ["code-review"] },
});
```

## Next steps

- [Tools](tools.md)
- [Environment](environment.md) — `NEXUS_SKILLS_ROOT`
- [Run context](run-context.md)
