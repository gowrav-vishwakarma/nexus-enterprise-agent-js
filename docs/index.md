# Nexus documentation

**Who this is for:** Developers building chat agents or multi-agent teams with Nexus in TypeScript, including SaaS (software as a service) apps with many customers.

## Key terms

- **Agent** — A program that talks to a large language model (LLM) and can call **tools** (small programs the model can trigger).
- **Config** — Settings that describe what an agent is (model, personality, limits).
- **Run context** — Settings that describe who is calling and which chat thread this is.
- **Manifest** — A YAML file that describes one or more agents and how they work together.
- **Orchestration** — Loading a manifest and running the described agents.
- **Runner** — The object that executes one agent loop (`run()` or `runStream()`).
- **Storage** — Where chat history is saved (memory and file always; SQLite via `@libsql/client`; PostgreSQL / Redis optional peers).
- **Cascaded voice** — A voice pipeline: VAD → STT → LLM → TTS as separate stages (client-side in this package).

## What is Nexus?

Nexus is an agent framework for building production apps. You describe agents in config. You wire who is calling and where data lives at run time. Then you call `run()`.

There is no global settings object. Each agent can use a different LLM provider. Storage and tenant (customer) identity are explicit.

GPU media servers stay in the [Python package](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent). This TypeScript package is the client-side runtime. HTTP serving is done by the consuming project.

## Reading order

1. [Architecture](architecture.md) — What goes where (config vs run time).
2. [Getting started (YAML)](getting-started.md) — Fastest path: manifest + prompts + run.
3. [Getting started (TypeScript)](getting-started-typescript.md) — Build everything in code.
4. [Voice](guides/voice-lab.md) — Client-side realtime; GPU Voice Lab stays in Python.
5. [Reference](reference/manifest-schema.md) — Every parameter and default.
6. [Guides](guides/pipelines.md) — Pipelines, runtime control, SaaS, and prompts.

## Quick links

| Topic | Doc |
|-------|-----|
| YAML manifest fields | [reference/manifest-schema.md](reference/manifest-schema.md) |
| Agent config | [reference/agent-config.md](reference/agent-config.md) |
| Runner and runtime | [reference/agent-runner.md](reference/agent-runner.md) |
| Who is calling | [reference/run-context.md](reference/run-context.md) |
| Save chat history | [reference/storage.md](reference/storage.md) |
| Tools | [reference/tools.md](reference/tools.md) |
| Scope (global, tenant, company, user) | [reference/scope.md](reference/scope.md) |
| Guardrails, cost, and audit | [reference/guardrails.md](reference/guardrails.md) |
| MCP client and server | [reference/mcp.md](reference/mcp.md) |
| Retrieval (RAG) | [reference/rag.md](reference/rag.md) |
| Jobs, artifacts, caching | [reference/jobs.md](reference/jobs.md) |
| CLI | [reference/serve.md](reference/serve.md) |
| Testing and evaluation | [reference/eval.md](reference/eval.md) |
| Memory | [reference/memory.md](reference/memory.md) |
| Context summary | [reference/context-summary.md](reference/context-summary.md) |
| Multi-agent teams | [reference/multi-agent.md](reference/multi-agent.md) |
| Voice, vision, channels | [reference/realtime-agents.md](reference/realtime-agents.md) |
| Media servers (Python sidecar) | [reference/server.md](reference/server.md) |
| Streaming | [reference/streaming.md](reference/streaming.md) |
| Events and observability | [reference/events.md](reference/events.md) |
| Skills | [reference/skills.md](reference/skills.md) |
| Environment variables | [reference/environment.md](reference/environment.md) |
| Custom storage adapter | [guides/custom-storage-adapter.md](guides/custom-storage-adapter.md) |
| Custom memory store | [guides/custom-memory-store.md](guides/custom-memory-store.md) |
| Persistence resolver | [guides/persistence-resolver.md](guides/persistence-resolver.md) |
| Pipelines (text, voice, teams) | [guides/pipelines.md](guides/pipelines.md) |
| Voice Lab (Python) + TS client | [guides/voice-lab.md](guides/voice-lab.md) |
| gRPC media servers (Python) | [guides/model-servers.md](guides/model-servers.md) |
| Runtime control | [guides/runtime-control.md](guides/runtime-control.md) |
| Porting from LangGraph | [guides/porting-from-langgraph.md](guides/porting-from-langgraph.md) |
| Skills storage (learned) | [guides/skills-storage.md](guides/skills-storage.md) |
| LLM via Vercel AI SDK | [guides/llm-vercel-ai.md](guides/llm-vercel-ai.md) |
| SaaS example | [guides/saas-example.md](guides/saas-example.md) |
| Prompt templates | [guides/prompts-jinja.md](guides/prompts-jinja.md) |
| Example index | [examples.md](examples.md) |
| Writing style | [style-guide.md](style-guide.md) |
| Python design spec | [Python NEXUS_AGENT_PRD](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent/blob/main/NEXUS_AGENT_PRD.md) |

## Install

```bash
npm install nexus-enterprise-agent
```

Optional peers:

```bash
npm install @libsql/client          # SQLite sessions
npm install @ai-sdk/openai          # OpenAI via Vercel AI SDK
npm install postgres ioredis        # later PostgreSQL / Redis adapters
```

For local development:

```bash
npm install
npm test
npm run test:live   # real LLM; needs NEXUS_LIVE_LLM=1 and NEXUS_LLM_*
```
