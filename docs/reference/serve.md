# CLI (`nexus`)

**Who this is for:** Developers running a manifest from the terminal, checking the install, or executing a small eval dataset.

## Key terms

- **CLI** — The `nexus` command installed with this package (`bin` in `package.json`).
- **Manifest** — A YAML file loaded by `OrchestrationManifest.load`.
- **Doctor** — A health check for Node version and optional peers.
- **Consumer app** — Your HTTP / WebSocket server. This package does **not** ship FastAPI or any other HTTP router.

Serving (chat HTTP, SSE, session replay) is done by the consuming project. Use `AgentRunner.run()` / `runStream()` inside your own routes. See [streaming.md](streaming.md).

## Commands

```bash
npx nexus run team.yaml "Hello"
npx nexus doctor
npx nexus manifest validate team.yaml
npx nexus eval dataset.json
```

| Command | Required? | Default | What it does |
|---------|-----------|---------|--------------|
| `nexus run <manifest> [message]` | manifest yes | message=`Hello` | Load YAML, build a single-agent `AgentRunner` with an empty `RunContext()`, print `finalResponse` |
| `nexus doctor` | — | — | Check Node >= 20 and resolve `yaml`, `zod`, `ai`, `nunjucks`, plus optional peers |
| `nexus manifest validate <file>` | file yes | — | Parse the YAML; print `root=` on success |
| `nexus eval [dataset]` | No | built-in smoke case | Run `EvalRunner` (no real model). JSON shape: `{ "cases": [...] }` |

`nexus run` does **not** yet execute group manifests (`root` pointing at a `groups` entry). Set `root` to a single agent, or write a short TypeScript script that uses `OrchestrationRuntime.fromManifest()`.

Identity (tenant, user, session) is not a CLI flag. Pass it in code:

```ts
import { OrchestrationManifest, OrchestrationRuntime, createRunContext } from "nexus-enterprise-agent";

const manifest = await OrchestrationManifest.load("team.yaml");
const runtime = await OrchestrationRuntime.fromManifest(manifest, {
  runContext: createRunContext({ tenantId: "acme", userId: "u-1", sessionId: "chat-1" }),
  toolRegistry: registry,
});
const result = await runtime.run({ userMessage: "Hello" });
```

## What is not in this package

| Python extra | TypeScript |
|--------------|------------|
| `nexus serve` / FastAPI routers | Not shipped — mount `run()` in your app |
| `GET /v1/sessions/{id}/stream` replay | Not shipped — see [streaming.md](streaming.md) |
| `nexus.server up` GPU processes | Stays in the [Python repo](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent) |

## Doctor checks

| Check | Required? | What it reports |
|-------|-----------|-----------------|
| Node.js | Yes | `[ok]` if major version >= 20 |
| `yaml`, `zod`, `ai`, `nunjucks` | Yes | Core dependencies |
| `@ai-sdk/openai`, `@ai-sdk/anthropic` | No | Optional LLM provider peers |
| `postgres`, `ioredis` | No | Optional storage peers |

## Next steps

- [Getting started](../getting-started.md)
- [Eval](eval.md)
- [Streaming](streaming.md)
- [Environment](environment.md)
