# Getting started with YAML orchestration

**Who this is for:** Developers who want the fastest path to a working multi-agent team using a config file.

## Key terms

- **YAML** — A human-readable text format for configuration files.
- **Manifest** — Your YAML file that lists agents, teams, storage, and tool plugins.
- **Prompts module** — A TypeScript file beside the YAML that holds prompt template strings.
- **Orchestration runtime** — The object that loads the manifest and runs your team.
- **Run context** — Who is calling (customer, user) and which chat thread this is.

## What you will build

Three files:

1. `team.yaml` — what agents exist and how they connect
2. `team_prompts.ts` — how they speak (prompt templates)
3. A short TypeScript script — load manifest, set run context, call `run()`

The repo already includes a working example at [examples/orchestration/](../examples/orchestration/).

## Step 1: Install

```bash
npm install nexus-enterprise-agent
# or, before the package is on npm:
npm install github:gowrav-vishwakarma/nexus-enterprise-agent-js
```

Optional peers (install what you use): `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@libsql/client`. See [guides/llm-vercel-ai.md](guides/llm-vercel-ai.md).

Copy [.env.example](../.env.example) to `.env` and set your LLM API key:

```env
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-4o-mini
```

Nexus does not read LLM keys from the environment by itself. The YAML manifest uses `${ENV:OPENAI_API_KEY}` so **your config file** pulls from the environment.

## Step 2: Understand the manifest

Open [examples/orchestration/research_team.yaml](../examples/orchestration/research_team.yaml).

A manifest has:

- `root` — which agent or team to run (required)
- `agents` — single agents with LLM, persona, and optional tools
- `groups` — teams (supervisor, pipeline, or parallel)
- `defaults` — shared LLM and turn limits
- `storage` — where chat history is saved
- `agents.<name>.toolset` — which named toolset the agent may use

For every field with defaults, see the annotated copy: [assets/complete-manifest.annotated.yaml](assets/complete-manifest.annotated.yaml). Full tables: [reference/manifest-schema.md](reference/manifest-schema.md).

## Step 3: Write prompt templates

Open [assets/research_team_prompts.annotated.ts](assets/research_team_prompts.annotated.ts) (field-by-field comments) or the runnable [examples/orchestration/research_team_prompts.ts](../examples/orchestration/research_team_prompts.ts).

Your prompts module must export:

```ts
export const PROMPTS = {
  researcher_system: "You are {{ role }}. Goal: {{ goal }}",
};
```

In YAML you reference a key:

```yaml
persona:
  role: Researcher
  goal: Gather facts
  prompt: researcher_system
  prompt_args:
    domain: finance
```

**Single render (each LLM turn):** The framework stores the raw template at load time, then renders all variables together — `role`, `goal`, `prompt_args`, `tenant_id` / `tenantId`, `user_memory`, `summary_text`, and `current_date`. Nunjucks understands Jinja-style `{{ }}`; `{% for k, v in user_memory.items() %}` works. See [guides/prompts-jinja.md](guides/prompts-jinja.md).

## Step 4: Run

```bash
npx tsx examples/orchestration/run_team.ts "Analyze Q4 revenue"
```

Or from TypeScript:

```ts
import {
  OrchestrationManifest,
  OrchestrationRuntime,
  createRunContext,
  defineTool,
  ToolRegistry,
} from "nexus-enterprise-agent";

const webSearch = defineTool((query: string) => `Results for ${query}`, {
  name: "web_search",
});

const databaseQuery = defineTool((sql: string) => `Rows for ${sql}`, {
  name: "database_query",
});

const registry = new ToolRegistry();
registry.addToolset("researcher", [webSearch]);
registry.addToolset("analyst", [databaseQuery]);

const manifest = await OrchestrationManifest.load("examples/orchestration/research_team.yaml");
const runtime = await OrchestrationRuntime.fromManifest(manifest, {
  runContext: createRunContext({
    tenantId: "demo-tenant",
    userId: "demo-user",
    sessionId: "chat-1",
  }),
  toolRegistry: registry,
});
const result = await runtime.run({ userMessage: "Analyze Q4 revenue" });
console.log(result.finalResponse);
```

Every `OrchestrationRuntime` parameter is explained in [assets/complete-run.annotated.ts](assets/complete-run.annotated.ts).

Without a real API key, unit tests use `MockLLMAdapter` so `run()` still returns a result. See [tests/agent-runner.test.ts](../tests/agent-runner.test.ts).

## Step 5: Set run context for teams

For multi-agent teams, set `sessionId` on `createRunContext()` **before** you call `OrchestrationRuntime.fromManifest()`.

Each team member saves chat history under `{sessionId}_{memberName}` (for example `chat-1_researcher`).

## Env interpolation in YAML

Use `${ENV:VAR}` or `${ENV:VAR|default}` in any YAML string:

```yaml
llm:
  model: ${ENV:OPENAI_MODEL|gpt-4o}
  api_key: ${ENV:OPENAI_API_KEY}
```

## Toolsets

Tools are grouped into named packs on a `ToolRegistry`. Build the registry in TypeScript and pass it to `fromManifest()`; then each agent selects the pack it needs.

```ts
const webSearch = defineTool((query: string) => `Results for ${query}`, {
  name: "web_search",
});
const registry = new ToolRegistry();
registry.addToolset("researcher", [webSearch]);
```

```yaml
agents:
  researcher:
    toolset: researcher
```

`toolset` can be a single name or a list (`[researcher, analyst]`). `null` means the agent sees every registered tool. For plan-tier gating, define toolsets per tier and set `toolset` from your config factory. Details: [reference/tools.md](reference/tools.md).

The legacy plugin path still works: declare `plugins:` in YAML and use `tool_plugins:` on an agent. A pre-built `ToolRegistry` passed to `fromManifest()` and YAML `plugins:` can be combined.

## When to use YAML vs TypeScript

| Use YAML orchestration when | Use the TypeScript API when |
|----------------------------|-----------------------------|
| Ops or product owns agent definitions | You build config per tenant/plan in code |
| You want env-based secrets in config | You need dynamic config without files |
| You want one file to describe a whole team | You prefer full programmatic control |

TypeScript walkthrough: [getting-started-typescript.md](getting-started-typescript.md). Annotated API: [assets/complete-agent.annotated.ts](assets/complete-agent.annotated.ts).

## Voice agents (optional)

Nexus supports text agents first. The same manifest can add voice via `RealtimeRuntime`.

- **This package:** client-side cascaded voice with **mock** STT/TTS and energy VAD.
- **Python package:** real gRPC GPU servers + browser Voice Lab.

```yaml
agents:
  voice_local:
    modality: voice_cascaded
    duplex: full
    stt: { provider: mock }
    tts: { provider: mock }
    vad: { provider: energy }
    agent:
      llm: *llm_fast
      persona: { prompt: voice_system }
```

```ts
import { RealtimeRuntime, RealtimeSession, WebSocketTransport } from "nexus-enterprise-agent/realtime";

const runtime = RealtimeRuntime.fromManifest(manifest, { runContext: ctx });
const pipeline = runtime.buildPipeline("voice_local");
const session = new RealtimeSession(pipeline, new WebSocketTransport(socket), sid);
await session.runAudio();
```

For GPU Voice Lab (`./scripts/run_voice_lab.sh`), use the [Python repo](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent). Guides: [guides/voice-lab.md](guides/voice-lab.md), [guides/pipelines.md](guides/pipelines.md).

## Next steps

- [Pipelines guide](guides/pipelines.md) — text, multi-agent, voice, channels: which to use
- [Runtime control](guides/runtime-control.md) — cancel, grantTools, resume, HITL
- [TypeScript API](getting-started-typescript.md)
- [Manifest schema reference](reference/manifest-schema.md)
- [Architecture](architecture.md)
- [SaaS example](guides/saas-example.md)
- [Examples index](examples.md)
