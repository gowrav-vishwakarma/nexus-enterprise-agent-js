# Nexus

**Enterprise-ready agent framework for TypeScript.** Describe agents in config. Wire who is calling and where data lives at run time. Call `run()`.

No global LLM settings. No shared agent singleton. Built for multi-tenant SaaS apps.

> **Beta — under active development.** Import as `nexus-enterprise-agent`.

## Why Nexus?

- **SaaS-native** — tenant, user, API keys, and storage passed per request
- **Context-first (RCS)** — compresses old tool results inline; no extra LLM calls
- **Config-driven** — YAML manifests for teams; TypeScript for wiring and tools
- **Provider-agnostic** — bring your own model; pluggable storage
- **Voice (client-side)** — cascaded STT → LLM → TTS with mock adapters; GPU media servers stay in the Python package

---

## Install

```bash
npm install nexus-enterprise-agent
# or from GitHub (builds via prepare)
npm install github:gowrav-vishwakarma/nexus-enterprise-agent-js
```

Optional peers (install what you use):

| Package | Adds |
|---------|------|
| `@ai-sdk/openai`, `@ai-sdk/anthropic`, … | LLM clients via the Vercel AI SDK |
| `@libsql/client`, `postgres`, `ioredis` | Storage adapters (when implemented) |

**Contributors:**

```bash
git clone https://github.com/gowrav-vishwakarma/nexus-enterprise-agent-js.git
cd nexus-enterprise-agent-js
npm install
cp .env.example .env   # set your LLM API key
npm test
```

---

## Text agents (YAML)

Three files: manifest, prompts module, short runner script.

```bash
npx tsx examples/orchestration/run_team.ts "Analyze Q4 revenue"
```

- Manifest: [examples/orchestration/research_team.yaml](examples/orchestration/research_team.yaml)
- Prompts: [examples/orchestration/research_team_prompts.ts](examples/orchestration/research_team_prompts.ts)

**TypeScript API** (same agents, built in code):

```ts
import { AgentRunner, createRunContext, parseAgentConfig } from "nexus-enterprise-agent";
import { ToolRegistry } from "nexus-enterprise-agent";

const runner = new AgentRunner({
  config: parseAgentConfig({
    name: "researcher",
    llm: { provider: "openai", model: "gpt-4o", api_key: process.env.OPENAI_API_KEY },
    persona: { role: "Researcher", goal: "Answer questions" },
  }),
  toolRegistry: new ToolRegistry(),
  runContext: createRunContext({ tenantId: "acme", userId: "u1", sessionId: "chat-1" }),
});
const result = await runner.run("What is AI?");
```

Walkthrough: [docs/getting-started.md](docs/getting-started.md) (YAML) · [docs/getting-started-typescript.md](docs/getting-started-typescript.md) (TypeScript)

---

## Voice agents (client-side)

Cascaded voice: VAD → STT → LLM → TTS. GPU servers stay in Python. This package ships mock / energy adapters and a WebSocket transport.

```ts
import { OrchestrationManifest } from "nexus-enterprise-agent";
import { RealtimeRuntime, RealtimeSession } from "nexus-enterprise-agent/realtime";
import { WebSocketTransport } from "nexus-enterprise-agent/realtime";

const manifest = await OrchestrationManifest.load("team.yaml");
const runtime = RealtimeRuntime.fromManifest(manifest, { runContext: ctx });
const pipeline = await runtime.buildPipeline("voice_agent");
const session = new RealtimeSession(pipeline, new WebSocketTransport(ws), sid);
await session.runAudio();
```

---

## Learn more

Full docs: **[docs/index.md](docs/index.md)**

| Topic | Doc |
|-------|-----|
| Architecture | [docs/architecture.md](docs/architecture.md) |
| YAML walkthrough | [docs/getting-started.md](docs/getting-started.md) |
| TypeScript API | [docs/getting-started-typescript.md](docs/getting-started-typescript.md) |
| Voice / channels | [docs/reference/realtime-agents.md](docs/reference/realtime-agents.md) |
| Pipelines | [docs/guides/pipelines.md](docs/guides/pipelines.md) |
| SaaS wiring | [docs/guides/saas-example.md](docs/guides/saas-example.md) |
| All examples | [docs/examples.md](docs/examples.md) |
