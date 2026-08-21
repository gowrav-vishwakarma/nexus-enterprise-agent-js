# Getting started with the TypeScript API

**Who this is for:** Developers who want to build agent config in code without YAML files.

## Key terms

- **Agent config** — A TypeScript object (`AgentConfig`) that describes one agent. Build it with `parseAgentConfig()`.
- **Tool registry** — A catalog (`ToolRegistry`) of tools the LLM can call.
- **Runner** — `AgentRunner` executes the agent loop when you call `run()`.
- **Run context** — `RunContext` (from `createRunContext()`) carries customer id, user id, and chat thread id.

## The flow in four steps

1. Build `AgentConfig` with `parseAgentConfig()` (model, personality, limits).
2. Build `ToolRegistry` and register tools with `defineTool()`.
3. Create `AgentRunner` with config, registry, storage, and run context.
4. Call `await runner.run("...")`.

## Minimal example

```ts
import {
  AgentRunner,
  createRunContext,
  defineTool,
  parseAgentConfig,
  ToolRegistry,
} from "nexus-enterprise-agent";

const echo = defineTool((text: string) => text, { name: "echo" });

const remember = defineTool((fact: string) => `Remembered: ${fact}`, {
  name: "remember",
});

const registry = new ToolRegistry();
registry.addToolset("core", [echo, remember]);

const config = parseAgentConfig({
  name: "assistant",
  llm: {
    provider: "openai",
    model: "gpt-4o-mini",
    api_key: process.env.OPENAI_API_KEY ?? "sk-...",
  },
  persona: {
    role: "Helpful assistant",
    goal: "Answer clearly.",
  },
  toolset: "core",
});

const runner = new AgentRunner({
  config,
  toolRegistry: registry,
  runContext: createRunContext({
    tenantId: "demo",
    userId: "user-1",
    sessionId: "sess-1",
  }),
});

const result = await runner.run("Echo hello");
console.log(result.finalResponse);
```

Without a real API key, pass `llmAdapter: new MockLLMAdapter()` so `run()` still returns a result. See [tests/agent-runner.test.ts](../tests/agent-runner.test.ts).

## Complete annotated example

Every `parseAgentConfig`, `AgentRunner`, and `run()` parameter with defaults:

[assets/complete-agent.annotated.ts](assets/complete-agent.annotated.ts)

## What goes where

| Setting | Object |
|---------|--------|
| Model, persona, turn limits, memory, tools allowed | `AgentConfig` via `parseAgentConfig()` |
| Customer, user, chat thread id | `createRunContext()` |
| Where chat history is saved | `storageConfig` on `AgentRunner` |
| Tools the LLM can call | `ToolRegistry` (required) |

Full diagram: [architecture.md](architecture.md).

## Tools

The LLM cannot call your TypeScript functions directly. You must:

1. Wrap a function with `defineTool()`
2. Register it on a `ToolRegistry`
3. Group tools into named toolsets with `addToolset()`
4. Point an agent at a toolset via `AgentConfig.toolset`

```ts
import { defineTool, parseAgentConfig, ToolRegistry } from "nexus-enterprise-agent";

const webSearch = defineTool((query: string) => `Results for ${query}`, {
  name: "web_search",
});

const databaseQuery = defineTool((sql: string) => `Rows for ${sql}`, {
  name: "database_query",
});

const registry = new ToolRegistry();
registry.addToolset("researcher", [webSearch]);
registry.addToolset("analyst", [databaseQuery]);
registry.addToolset("full_team", [], { includes: ["researcher", "analyst"] });

const config = parseAgentConfig({
  name: "assistant",
  llm: { provider: "openai", model: "gpt-4o-mini", api_key: "sk-..." },
  toolset: "full_team", // or ["researcher", "analyst"] for a union
});
```

`AgentConfig.toolset` is a single toolset name or a list of names. `null` means the agent sees every registered tool. For SaaS plan gating, pick the right toolset per tenant or request.

A tool parameter named `ctx` or `run_context` receives `RunContext` automatically (it is stripped from the LLM schema).

The older `registerTool()` (namespaced) and `tool_plugins` (namespace allow-list) APIs are still supported; use them only when you need class-based plugins. Details: [reference/tools.md](reference/tools.md).

## Storage

Pass `storageConfig` on the runner (preferred in production):

```ts
const runner = new AgentRunner({
  config,
  toolRegistry: registry,
  storageConfig: {
    adapter: "sqlite",
    adapter_config: { tenant_scoped: true },
  },
});
```

Default without `storageConfig`: in-memory only (chat history lost when the process exits).

Built-in adapters today: `memory`, `file`, `sqlite`. `postgresql` and `redis` fall back to memory until those adapters ship. For a product table, implement `StorageAdapter` — [guides/custom-storage-adapter.md](guides/custom-storage-adapter.md).

## Multi-agent teams (TypeScript)

Build one `AgentConfig` per member, wrap them in `parseAgentGroupConfig()`, and use `AgentOrchestrator`:

```ts
import {
  AgentOrchestrator,
  createRunContext,
  parseAgentGroupConfig,
} from "nexus-enterprise-agent";

const group = parseAgentGroupConfig({
  name: "pipeline",
  pattern: "pipeline",
  members: [researcherCfg, analystCfg],
});

const orchestrator = new AgentOrchestrator({
  config: group,
  toolRegistry: registry,
  storageConfig: sessionManager,
  runContext: createRunContext({ sessionId: "group-1" }), // set before init
});
const result = await orchestrator.run({ userMessage: "Analyze Q4 revenue" });
```

Runnable YAML script: [examples/orchestration/run_team.ts](../examples/orchestration/run_team.ts).

Or use YAML orchestration instead: [getting-started.md](getting-started.md).

## When to use TypeScript vs YAML

| Use the TypeScript API when | Use YAML orchestration when |
|-----------------------------|----------------------------|
| Config changes per tenant or subscription plan | Agent definitions are stable files |
| You already have a config factory in your app | Ops team owns agent YAML |
| You need types and IDE autocomplete on config | You want `${ENV:...}` in config files |

## Next steps

- [Getting started (YAML)](getting-started.md)
- [Runner reference](reference/agent-runner.md)
- [SaaS example](guides/saas-example.md)
- [Runtime control](guides/runtime-control.md)
