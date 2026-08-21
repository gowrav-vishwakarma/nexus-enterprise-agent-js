#!/usr/bin/env npx tsx
/**
 * Annotated orchestration runner — every OrchestrationRuntime parameter explained.
 *
 * This is a reference copy for learning. The runnable example is
 * examples/orchestration/run_team.ts
 */

import { randomUUID } from "node:crypto";
import {
  OrchestrationManifest,
  OrchestrationRuntime,
  createRunContext,
} from "nexus-enterprise-agent";

// Optional: build a ToolRegistry in code and pass it to fromManifest(). This is
// the modern path: define flat defineTool() functions, group them with addToolset(),
// and select packs in YAML via `agents.<name>.toolset:`.
// import { defineTool, ToolRegistry } from "nexus-enterprise-agent";
// const webSearch = defineTool((query: string) => `Results for ${query}`, { name: "web_search" });
// const registry = new ToolRegistry();
// registry.addToolset("researcher", [webSearch]);

// Optional: override storage per tenant in SaaS apps.
// import type { PersistenceResolver } from "nexus-enterprise-agent";
// const persistenceResolver = new MyTenantResolver();

async function main(): Promise<void> {
  const manifestPath = "examples/orchestration/research_team.yaml";

  // Load YAML + companion prompts module once (safe to cache in production).
  const manifest = await OrchestrationManifest.load(manifestPath);

  // Chat thread id — use a stable id to continue the same conversation.
  const sessionId = randomUUID();

  // OrchestrationRuntime.fromManifest — builds AgentRunner or AgentOrchestrator from manifest.
  const runtime = await OrchestrationRuntime.fromManifest(manifest, {
    // runContext (required) — who is calling and which chat thread.
    runContext: createRunContext({
      tenantId: "demo-tenant", // optional — which customer/org
      userId: "demo-user", // optional — scopes chat history + cross-session user_memory
      sessionId, // optional — chat thread id; set BEFORE runtime for teams
      requestId: null, // optional — your tracing/correlation id
      metadata: {}, // optional — extra key/value bag for tools
    }),
    // toolRegistry (optional, default: empty registry)
    // Pre-built registry from addTool() / addToolset(). YAML plugins: still
    // loaded and registered on top when plugins: is non-empty.
    toolRegistry: undefined,
    // persistenceResolver (optional, default: from manifest storage)
    // Override manifest storage per tenant/user (SaaS pattern).
    persistenceResolver: undefined,
    // eventEmitter (optional, default: undefined)
    // Hook for structured observability events. Fanned out to member runners
    // when the YAML root is a multi-agent group.
    eventEmitter: undefined,
    // crossSessionEnabled (optional, default: true)
    // When true, builds a cross-chat memory store from manifest storage settings.
    crossSessionEnabled: true,
  });

  // run({ userMessage }) — blocking; returns AgentRunResult or AgentGroupResult.
  const result = await runtime.run({ userMessage: "Summarize recent framework releases." });
  console.log(result.finalResponse);
  console.log(`session_id=${sessionId}`);

  // Streaming alternative (optional):
  // for await (const event of runtime.runStream({ userMessage: "Hello", stream: true })) {
  //   if (event.eventType === "content") process.stdout.write(event.content ?? "");
  // }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
