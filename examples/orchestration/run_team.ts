#!/usr/bin/env npx tsx
/** Run a YAML-defined multi-agent team. */

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OrchestrationManifest,
  OrchestrationRuntime,
  createRunContext,
  defineTool,
  ToolRegistry,
} from "../../src/index.js";

const webSearch = defineTool(
  (query: string) => `Web search result for: '${query}' - found research releases.`,
  { name: "web_search", description: "Search the web for a query." },
);

const databaseQuery = defineTool(
  (sql: string) => `Database result: queried '${sql}' (returned 0 rows).`,
  { name: "database_query", description: "Query the company database." },
);

const EXAMPLE_DIR = dirname(fileURLToPath(import.meta.url));

export function buildExampleRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.addToolset("researcher", [webSearch]);
  registry.addToolset("analyst", [databaseQuery]);
  return registry;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let manifestPath = resolve(EXAMPLE_DIR, "research_team.yaml");
  let tenantId = "demo-tenant";
  let userId = "demo-user";
  let sessionId: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--manifest") manifestPath = resolve(args[++i]!);
    else if (arg === "--tenant-id") tenantId = args[++i]!;
    else if (arg === "--user-id") userId = args[++i]!;
    else if (arg === "--session-id") sessionId = args[++i];
    else positional.push(arg);
  }
  const message = positional.join(" ") || "Summarize recent framework releases.";

  const manifest = await OrchestrationManifest.load(manifestPath);
  const sid = sessionId ?? randomUUID();
  const runtime = await OrchestrationRuntime.fromManifest(manifest, {
    runContext: createRunContext({
      tenantId,
      userId,
      sessionId: sid,
    }),
    toolRegistry: buildExampleRegistry(),
  });

  const result = await runtime.run(message);
  console.log(result.finalResponse);
  console.log(`session_id=${sid}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
