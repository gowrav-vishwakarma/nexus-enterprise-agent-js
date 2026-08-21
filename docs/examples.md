# Examples index

**Who this is for:** Developers looking for runnable code beyond the getting-started guides.

Not sure which example fits your use case? See the [pipelines guide](guides/pipelines.md) for a decision table (text, multi-agent, cascaded voice, S2S, channels) with links to every row below.

## Key terms

- **Example** — A script or config in the `examples/` folder you can run or copy.
- **Fixture** — Test data under `tests/fixtures/` used by Vitest.

## Starter templates

Whole-application skeletons (SaaS chat, personal agent, background worker, voice agent) are **not copied into this package yet**. Use the TypeScript API from your own HTTP framework instead — see [guides/saas-example.md](guides/saas-example.md).

Python starter templates live in the [Python package](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent).

## Orchestration (YAML) — text agents

| Path | What you will learn |
|------|---------------------|
| [examples/orchestration/research_team.yaml](../examples/orchestration/research_team.yaml) | Supervisor + nested pipeline team; agents select toolsets |
| [examples/orchestration/research_team_prompts.ts](../examples/orchestration/research_team_prompts.ts) | `PROMPTS` object, Nunjucks / Jinja-compatible templates |
| [examples/orchestration/run_team.ts](../examples/orchestration/run_team.ts) | CLI to load a manifest, build a `ToolRegistry` with `addToolset()`, and run |

```bash
npx tsx examples/orchestration/run_team.ts "Your question here"
```

Annotated references (not runnable as-is):

- [assets/complete-manifest.annotated.yaml](assets/complete-manifest.annotated.yaml)
- [assets/research_team_prompts.annotated.ts](assets/research_team_prompts.annotated.ts)
- [assets/complete-run.annotated.ts](assets/complete-run.annotated.ts)
- [assets/complete-agent.annotated.ts](assets/complete-agent.annotated.ts)

## SaaS API — text

This package is a **library**, not a shipped HTTP server. Call `AgentRunner` / `OrchestrationRuntime` from Elysia, Hono, Fastify, Express, or any other framework.

Guide: [guides/saas-example.md](guides/saas-example.md).

## Voice — client-side (this package)

TypeScript ships `RealtimeRuntime`, cascaded / S2S pipelines, and **mock** STT/TTS plus an energy VAD so you can test without GPUs.

| What you will learn | Where |
|---------------------|-------|
| Build a cascaded pipeline from a voice agent in a manifest | [guides/pipelines.md](guides/pipelines.md), [guides/voice-lab.md](guides/voice-lab.md) |
| Mock adapters | `src/realtime/adapters/` (`MockSTT`, `MockTTS`, `EnergyVAD`) |

GPU media servers, Voice Lab (browser UI + gRPC), and `./scripts/run_voice_lab.sh` stay in the [Python package](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent).

Guides: [guides/voice-lab.md](guides/voice-lab.md), [guides/model-servers.md](guides/model-servers.md).

## TypeScript API (annotated)

| Path | What you will learn |
|------|---------------------|
| [assets/complete-agent.annotated.ts](assets/complete-agent.annotated.ts) | Every `parseAgentConfig` and `AgentRunner` parameter |
| [guides/porting-from-langgraph.md](guides/porting-from-langgraph.md) | Port a stateful LangGraph support agent to Nexus (side-by-side) |

Walkthrough: [getting-started-typescript.md](getting-started-typescript.md).

## Porting from other frameworks

| Path | What you will learn |
|------|---------------------|
| [guides/porting-from-langgraph.md](guides/porting-from-langgraph.md) | Stateful agents: checkpoint state, HITL, supervisor team vs LangGraph StateGraph |

LangGraph is not installed in this repo; the guide uses illustrative LangGraph snippets and runnable Nexus TypeScript.

## Test fixtures

Under `tests/fixtures/`:

| Path | What it tests |
|------|---------------|
| `tests/fixtures/orchestration/prompts.ts` | Prompt-module loading |
| `tests/fixtures/skills/` | agentskills.io `SKILL.md` folders |
| `tests/fixtures/rag_eval.jsonl` | Retrieval eval rows |

## Next steps

- [Getting started (YAML)](getting-started.md)
- [Getting started (TypeScript)](getting-started-typescript.md)
- [Voice Lab (Python) + TS mocks](guides/voice-lab.md)
- [Documentation index](index.md)
