# Tools

**Who this is for:** Developers exposing TypeScript functions so the LLM can call them.

## Key terms

- **Tool** — A function the LLM can request to run.
- **Tool registry** — `ToolRegistry`; catalog of tools with JSON schemas sent to the model.
- **Toolset** — A named pack of tools (and nested packs) defined on the registry; selected per agent via `AgentConfig.toolset`.
- **Plugin** — A class grouping related tools under one namespace (legacy path).
- **Allow-list** — `AgentConfig.toolset` (modern) or `tool_plugins` (legacy plugin namespace filter).
- **Client tool** — A tool with `execution: "client"`; the run pauses until your UI returns a result via `resume()`.

## Why you need a registry

The LLM cannot call your code directly. Nexus:

1. Sends tool schemas to the model
2. Runs the matching function when the model asks
3. Returns the result to the model

`AgentRunner` **requires** a `toolRegistry` argument.

## defineTool / tool()

```ts
import { defineTool, tool, ToolRegistry } from "nexus-enterprise-agent";

const echo = defineTool((text: string) => text, {
  name: "echo",
  description: "Echo text back",
});

const registry = new ToolRegistry();
registry.addTool(echo); // → echo (flat name, no plugin prefix)
```

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `name` | No | function name | Tool name the LLM sees |
| `description` | No | `""` | Human-readable description |
| `tags` | No | `[]` | Optional tags for metadata |
| `timeoutSeconds` | No | `null` | Max seconds for tool execution. `null` means no per-tool limit |
| `requiresApproval` | No | `false` | Pause the run for human approval before the tool executes |
| `execution` | No | `"server"` | `"server"` runs in-process; `"client"` pauses for `resume()` |
| `parameters` | No | empty object | JSON Schema for arguments (needed when you want typed args) |

`registry.addTool(fn)` is the preferred modern API: it registers a flat tool name with no `plugin.` prefix. The legacy `registerTool(fn, "utilities")` still registers `utilities.echo` if you need namespaces. `executeTool()` resolves bare, flat, and namespaced names.

**About `timeoutSeconds`.** A tool is only cancelled if you declare a timeout. Tools that declare nothing run until the turn-level `TurnConfig.turn_timeout_seconds` (default 300) bounds them. Cancellation uses `Promise.race`; a blocking synchronous tool still runs to completion, so give I/O an internal client timeout.

### Client tools (`execution: "client"`)

Use client tools when the browser or mobile app must run the tool (pick a file, show a form, call a device API):

```ts
const pickFile = defineTool((prompt: string) => "", {
  name: "pick_file",
  execution: "client",
  description: "Ask the user to pick a file",
});
```

When the model calls a client tool:

1. The runner appends a `PendingInteraction` and sets status `paused`
2. Streaming emits `client_tool_call` (or `elicitation` for `*.request_user_input`) then `paused`
3. Your app runs the tool and calls `resume(sessionId, results)`

See [agent-runner.md](agent-runner.md#agentrunnerresume).

## defineToolPlugin (legacy)

Class-based plugins are still supported but are no longer the primary path. Prefer flat `defineTool` functions + `addToolset()` for new code.

```ts
import { defineTool, defineToolPlugin, ToolRegistry } from "nexus-enterprise-agent";

class MathPlugin {
  multiply = defineTool((x: number, y: number) => x * y, { name: "multiply" });
}
defineToolPlugin("math_plugin")(MathPlugin);

const registry = new ToolRegistry();
registry.registerPlugin(new MathPlugin());
// tools: math_plugin.multiply
```

`tool()` / `toolPlugin()` are method-decorator aliases for the same metadata (`experimentalDecorators`).

## RunContext injection

Tools often need request-scoped data (tenant id, user id, plan tier) that the LLM should not choose. Name a parameter `ctx` or `run_context` — Nexus strips it from the schema sent to the model and injects it at execution time.

```ts
const lookupAccount = defineTool(
  (accountId: string, ctx) => {
    const plan = ctx.get("plan_tier", "free");
    return `[tenant=${ctx.tenantId}, plan=${plan}] Account ${accountId}: active`;
  },
  { name: "lookup_account", description: "Look up a customer account by id." },
);
```

| Parameter kind | Who sets it | Visible to LLM? |
|----------------|-------------|-----------------|
| Typed tool args (e.g. `accountId`) | LLM in the tool call | Yes |
| `ctx` / `run_context` | Your app via `runContext` | No |

Read extra per-request values from `ctx.metadata` with `ctx.get("key")`. Full field list: [run-context.md](run-context.md).

A tool may return a string or a plain object. Strings go to the model as-is. Objects are JSON-serialized so the model sees the fields (for example `{"matches":[...]}`) instead of `[object Object]`.

Optional arguments are safe to leave out: an omitted argument is passed as `undefined`, so your parameter default applies and later parameters (including `ctx`) stay in place.

**Caution:** injection matches the parameter *name*, read from the compiled function source. A bundler may rename a parameter when it shadows an outer variable of the same name (e.g. `ctx` becomes `ctx2`), and injection then silently stops. If your tool is created per request anyway, prefer closing over the `RunContext` value instead of declaring a `ctx` parameter.

## Toolsets

A **toolset** is a named pack of tools (and optional nested packs) defined on the `ToolRegistry`. Use toolsets when a product UI lets users toggle capability packs per chat, or when you want a flat-name tool allow-list.

### tool_plugins allow-list (legacy)

`tool_plugins` is the legacy namespace filter for class-based plugins.

| Value | Effect |
|-------|--------|
| `[]` (default) | All registered tools eligible |
| `["web_search"]` | Only `web_search.*` tools sent to LLM |

Prefer `AgentConfig.toolset` for new code.

### Defining a toolset

Toolsets are **owned by the `ToolRegistry`**. You define them on the same registry that holds the tools, so every referenced tool is validated at define time.

```ts
registry.addToolset("memory", [memoryWrite, memorySearch]);
registry.addToolset("chat_core", [], {
  includes: ["memory"],
  description: "Core chat tools",
});
```

You can still pass registered tool name strings. Define child toolsets before parents (`includes` must already exist).

`addToolset` / `defineToolset` throws if any tool name is not registered, or if an `includes` entry is not an already-defined toolset.

### addToolset / defineToolset arguments

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `name` | Yes | — | Pack id |
| `tools` | No | `[]` | Registered tool name strings **or** `defineTool` callables |
| `includes` | No | `[]` | Other toolset names to pull in recursively (must be defined first) |
| `description` | No | `""` | Shown in UI catalogs |
| `visibility` | No | `"hidden"` | `"hidden"` or `"frontend"` (only frontend packs appear in the catalog) |
| `default_enabled` | No | `false` | Hint for UIs; does not auto-enable by itself |

### Pointing an agent at a toolset

```ts
const config = parseAgentConfig({
  name: "chat",
  llm,
  toolset: "chat_core",
  // toolset: ["chat_core", "attachments"],
});
```

```yaml
agents:
  researcher:
    toolset: researcher
```

At run time the runner calls `registry.resolveToolset(config.toolset)` to build the tool allow-list. When `toolset` is `null` there is no restriction. A per-run `runContext` metadata key `toolset_override` (name or list) takes precedence over `config.toolset`.

When a toolset allow-list is active, the runner uses it as the **allow-list**. It does **not** also apply the `tool_plugins` namespace filter on that pass. Use a `toolset` instead of `tool_plugins` when you use flat names.

### Runtime tool granting

Widen or narrow a live agent's allow-list between turns (schemas are re-filtered every turn):

```ts
runner.grantTools("tenant.new_tool");
runner.grantToolset("attachments");
runner.revokeTools(["tenant.old_tool"]);
```

Brand-new tools registered on the shared registry at runtime become callable once granted — or immediately if the agent has no toolset restriction. When the agent is unrestricted, `grantTools` / `grantToolset` are no-ops.

### Frontend catalog

```ts
const catalog = registry.listFrontendToolsets({
  "memory.write": "Save a fact",
});
```

Expose this from your `/tools` or settings API so the UI can show toggleable packs.

## Public registry helpers

| Method | Purpose |
|--------|---------|
| `has(fullName)` | Whether a tool is registered |
| `toolNames()` | Sorted list of registered names |
| `getTool(fullName)` | Callable + optional plugin instance |
| `count()` | Number of registered tools |
| `schemasFor(names)` | LLM schema dicts for a name list |
| `addTool(fn)` | Register a flat `defineTool` |
| `registerPlugin(instance)` | Register a `defineToolPlugin` class instance |
| `defineToolset(...)` / `addToolset(...)` | Define a named toolset (validates tools/includes) |
| `hasToolset(name)` / `getToolset(name)` | Look up a defined toolset |
| `listToolsets()` | All defined toolsets |
| `listFrontendToolsets(...)` | Catalog of `visibility: "frontend"` packs |
| `resolveToolset(nameOrNames)` | Expand toolset name(s) → concrete tool name set (`null` → no restriction) |
| `executeTool(name, args, ctx)` | Run by flat or namespaced name |

## One registry, many agents

Build one `ToolRegistry` at app startup. Define its toolsets, then pass the same instance to every runner. Per-agent differences come from the single `toolset` field on each `AgentConfig`.

## YAML orchestration toolsets

Build the registry in TypeScript and pass it to `OrchestrationRuntime.fromManifest()`:

```ts
const registry = new ToolRegistry();
registry.addToolset("researcher", [webSearch]);
const runtime = await OrchestrationRuntime.fromManifest(manifest, {
  runContext: ctx,
  toolRegistry: registry,
});
```

The legacy `plugins:` block still works for class-based plugins:

```yaml
plugins:
  web_search: ./plugins/web-search.js#WebSearchPlugin
```

## Next steps

- [Agent runner](agent-runner.md) — `toolset`, runtime grants, and `resume()`
- [Skills](skills.md) — different from custom tools; uses agentskills.io folders
- [MCP](mcp.md)
