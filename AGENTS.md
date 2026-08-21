# Instructions for AI assistants and contributors

When you change Nexus code, update the matching documentation in the same change. Even if you ever find this Agents.md file is out of order, update it with new patterns and file paths.

Before making any new feature or code, make sure we do not already have it. No DRY unless that gives more profit.

Always keep things simple. Keep things modular and easy to understand. Avoid unnecessary complexity. Do not over-engineer.

## Documentation style

Follow [docs/style-guide.md](docs/style-guide.md). Write for beginners. Define terms on first use.
When checking behaviour, read the docs first, then the code; if they disagree, update the docs in the same change.

## What to update when code changes

| If you change… | Update these docs |
|----------------|-------------------|
| `src/orchestration/schema.ts` or `src/orchestration/resolver.ts` | `docs/reference/manifest-schema.md`, `docs/assets/complete-manifest.annotated.yaml` |
| `src/config/*.ts` (fields, defaults, descriptions) | Matching file under `docs/reference/` |
| `src/scope.ts` | `docs/reference/scope.md` |
| `src/guardrails/*` | `docs/reference/guardrails.md` |
| `src/mcp/*` | `docs/reference/mcp.md` |
| `src/rag/*` | `docs/reference/rag.md` |
| `src/memory/*` | `docs/reference/memory.md` |
| `src/skills/models.ts` or `src/skills/plugin.ts` | `docs/reference/skills.md` |
| `src/multiagent/orchestrator.ts` | `docs/reference/multi-agent.md` |
| `src/cli/*` | `docs/reference/serve.md` |
| `src/events/emitter.ts` or `src/guardrails/redaction.ts` / `audit.ts` | `docs/reference/events.md`, `docs/reference/guardrails.md` |
| `src/eval/*` | `docs/reference/eval.md` |
| `src/jobs/*`, `src/artifacts/*`, `src/cache/*`, `src/runner/checkpoint.ts` | `docs/reference/jobs.md` |
| `src/tools/decorators.ts` or `src/tools/registry.ts` | `docs/reference/tools.md` |
| Any new `docs/reference/*.md` page | Add it to the Quick links table in `docs/index.md` |
| `OrchestrationRuntime` or `AgentRunner` signatures | `docs/reference/agent-runner.md`, `docs/assets/complete-run.annotated.ts`, `docs/assets/complete-agent.annotated.ts` |
| `src/llm/content-tool-calls.ts` or assistant history sanitization | `docs/reference/agent-runner.md` (Content-side tool-call recovery) |
| `.env.example` | `docs/reference/environment.md` |
| `examples/orchestration/*` | `docs/getting-started.md`, `docs/examples.md` |
| `src/realtime/*` | `docs/reference/realtime-agents.md`, `docs/guides/voice-lab.md` |
| `src/channels/*` | `docs/reference/realtime-agents.md` |
| `src/llm/adapters/vercel.ts` | `docs/guides/llm-vercel-ai.md`, `docs/reference/agent-config.md` |

## How to run TypeScript

The project is ESM (`"type": "module"`). Use `.js` extensions in imports.

```bash
npm install
npm test
npm run test:live   # real LLM; needs NEXUS_LIVE_LLM=1 and NEXUS_LLM_* in .env
npm run typecheck
npm run build
```

Use `npx tsx` to run examples:

```bash
npx tsx examples/orchestration/run_team.ts "Analyze Q4 revenue"
```

Do not add dependencies with a one-off `npm install` that skips the lockfile on other machines unless you update `package.json`.

## README policy

Keep [README.md](README.md) short. It is a quick start only. Move depth to `docs/`.

## Do not edit

- Do not rewrite the Python [NEXUS_AGENT_PRD.md](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent/blob/main/NEXUS_AGENT_PRD.md). Link to it.
