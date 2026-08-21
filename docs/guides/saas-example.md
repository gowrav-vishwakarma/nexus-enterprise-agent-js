# Call Nexus from any HTTP framework

**Who this is for:** Developers building a multi-tenant chat API with plan tiers and per-tenant storage.

This package is a **library**. It does not ship an HTTP server. You call `AgentRunner` / `OrchestrationRuntime` from Elysia, Hono, Fastify, Express, or any other Node/Bun framework.

## Key terms

- **Tenant** — One customer organization (often an `X-Tenant-ID` header).
- **Plan tier** — Subscription level that gates tools, turns, and memory.
- **BYOK** — Bring your own key; the tenant supplies their LLM API key.
- **Config factory** — Your function that turns tenant + plan into `AgentConfig` + `ToolRegistry`.

## What you wire (every request)

1. Read tenant / user from headers or your auth layer.
2. Build `AgentConfig` from the plan (toolset, memory, RCS, skills).
3. Build `createRunContext({ tenantId, userId, sessionId })`.
4. Resolve storage (`storageConfig` or a `PersistenceResolver`).
5. Call `runner.run()` or `runner.runStream()`.

```ts
import {
  AgentRunner,
  createRunContext,
  parseAgentConfig,
  ToolRegistry,
} from "nexus-enterprise-agent";

function buildRunner(tenantId: string, userId: string, plan: string) {
  const config = parseAgentConfig({
    name: "assistant",
    llm: {
      provider: "openai",
      model: "gpt-4o-mini",
      api_key: process.env.OPENAI_API_KEY ?? "",
    },
    turns: { max_turns: plan === "free" ? 3 : 10 },
    toolset: plan === "free" ? "core" : "full",
    memory: { enabled: plan !== "free" },
  });
  const registry = registryForPlan(plan);
  return new AgentRunner({
    config,
    toolRegistry: registry,
    storageConfig: storageForTenant(tenantId),
    runContext: createRunContext({
      tenantId,
      userId,
      sessionId: `${tenantId}:${userId}:chat-1`,
      metadata: { plan_tier: plan },
    }),
  });
}
```

## Headers

| Header | Required? | Default (demo) | What it does |
|--------|-----------|----------------|--------------|
| `X-Tenant-ID` | Yes in production | — | Which customer owns the request |
| `X-User-ID` | Yes in production | `demo-user` | Which person within that tenant |

Chat history and cross-chat memory are scoped to **tenant + user**, not tenant alone. If every caller omits the user id, they all share one bucket inside the tenant.

## Framework sketches

Same library call. Only the HTTP wrapper changes.

**Elysia**

```ts
import { Elysia } from "elysia";

new Elysia()
  .post("/v1/chat", async ({ request, body }) => {
    const tenantId = request.headers.get("x-tenant-id") ?? "";
    const userId = request.headers.get("x-user-id") ?? "demo-user";
    const runner = buildRunner(tenantId, userId, planFor(tenantId));
    const result = await runner.run((body as { message: string }).message);
    return { reply: result.finalResponse, sessionId: result.sessionId };
  })
  .listen(3000);
```

**Hono**

```ts
import { Hono } from "hono";

const app = new Hono();
app.post("/v1/chat", async (c) => {
  const tenantId = c.req.header("x-tenant-id") ?? "";
  const userId = c.req.header("x-user-id") ?? "demo-user";
  const { message } = await c.req.json<{ message: string }>();
  const result = await buildRunner(tenantId, userId, planFor(tenantId)).run(message);
  return c.json({ reply: result.finalResponse, sessionId: result.sessionId });
});
```

**Fastify**

```ts
fastify.post("/v1/chat", async (req, reply) => {
  const tenantId = String(req.headers["x-tenant-id"] ?? "");
  const userId = String(req.headers["x-user-id"] ?? "demo-user");
  const { message } = req.body as { message: string };
  const result = await buildRunner(tenantId, userId, planFor(tenantId)).run(message);
  return reply.send({ reply: result.finalResponse, sessionId: result.sessionId });
});
```

**Express**

```ts
app.post("/v1/chat", async (req, res) => {
  const tenantId = String(req.header("x-tenant-id") ?? "");
  const userId = String(req.header("x-user-id") ?? "demo-user");
  const result = await buildRunner(tenantId, userId, planFor(tenantId)).run(req.body.message);
  res.json({ reply: result.finalResponse, sessionId: result.sessionId });
});
```

## Streaming

`runStream()` yields `AgentStreamEvent` objects (`content`, `tool_call`, `final_response`, …). Map those to Server-Sent Events (SSE) or a WebSocket in your framework. Do not look for a shipped `/v1/chat` router in this package.

```ts
for await (const event of runner.runStream(message)) {
  if (event.eventType === "content") {
    sendSse({ type: "delta", text: event.content });
  }
  if (event.eventType === "final_response") {
    sendSse({ type: "done", data: event.data });
  }
}
```

## Config factory priority (LLM)

1. Platform `base_url` set → all tenants use that custom endpoint (LiteLLM proxy, vLLM, …)
2. Tenant BYOK key from your tenant table
3. Platform keys from your env (`OPENAI_API_KEY`, …) passed into `parseAgentConfig`

Nexus does not read keys from the environment by itself. Your factory passes them in. See [llm-vercel-ai.md](llm-vercel-ai.md).

## Architecture fit

| Concern | Where |
|---------|--------|
| Agent behavior | Your factory → `parseAgentConfig()` |
| Who is calling | `createRunContext()` from headers / auth |
| Storage | `storageConfig` on the runner, or `PersistenceResolver` |
| Shared tools | One `ToolRegistry` with `addToolset()` + per-agent `toolset` |

## Voice and channels

GPU Voice Lab and gRPC media servers stay in the [Python package](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent). This package has client-side `RealtimeRuntime` plus mock STT/TTS. Messaging adapters (`ChannelRouter`, Telegram, WhatsApp) normalize inbound payloads to `UserInput` + `RunContext`. See [pipelines.md](pipelines.md) and [voice-lab.md](voice-lab.md).

## Next steps

- [Architecture](../architecture.md)
- [Persistence resolver](persistence-resolver.md)
- [Runtime control](runtime-control.md)
- [Getting started (TypeScript)](../getting-started-typescript.md)
