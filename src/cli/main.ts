/** Nexus command-line interface. */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { OrchestrationManifest } from "../orchestration/manifest.js";
import {
  isAgentGroupConfig,
  ManifestResolver,
} from "../orchestration/resolver.js";
import { AgentRunner } from "../runner/agent-runner.js";
import { createRunContext } from "../tools/context.js";
import { ToolRegistry } from "../tools/registry.js";
import { runEvalCli } from "../eval/runner.js";

const require = createRequire(import.meta.url);

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv;

  if (!command || command === "-h" || command === "--help") {
    printHelp();
    if (!command) process.exit(1);
    return;
  }

  if (command === "doctor") {
    doctor();
    return;
  }

  if (command === "run") {
    const manifest = rest[0];
    const message = rest[1] ?? "Hello";
    if (!manifest) {
      console.error("Usage: nexus run <manifest> [message]");
      process.exit(1);
    }
    await runManifest(manifest, message);
    return;
  }

  if (command === "manifest") {
    const sub = rest[0];
    const file = rest[1];
    if (sub !== "validate" || !file) {
      console.error("Usage: nexus manifest validate <file>");
      process.exit(1);
    }
    await validateManifest(file);
    return;
  }

  if (command === "eval") {
    const dataset = rest[0];
    await runEvalCli(dataset ?? null);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  console.log(`Nexus agent framework CLI

Usage:
  nexus run <manifest> [message]
  nexus doctor
  nexus manifest validate <file>
  nexus eval [dataset]
`);
}

function doctor(): void {
  console.log("Nexus doctor");
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) {
    console.log(`  [ok] node ${process.version}`);
  } else {
    console.log(`  [missing] node >= 20 (found ${process.version})`);
  }
  for (const extra of ["yaml", "zod", "ai", "nunjucks"]) {
    try {
      require.resolve(extra);
      console.log(`  [ok] ${extra}`);
    } catch {
      console.log(`  [missing] ${extra}`);
    }
  }
  for (const extra of ["@ai-sdk/openai", "@ai-sdk/anthropic", "postgres", "ioredis"]) {
    try {
      require.resolve(extra);
      console.log(`  [ok] ${extra}`);
    } catch {
      console.log(`  [missing] ${extra} (optional)`);
    }
  }
}

async function validateManifest(path: string): Promise<void> {
  const manifest = await OrchestrationManifest.load(resolve(path));
  console.log(`Valid manifest: root=${manifest.schema.root}`);
}

async function runManifest(path: string, message: string): Promise<void> {
  if (!existsSync(path)) {
    throw new Error(`Manifest not found: ${path}`);
  }
  const manifest = await OrchestrationManifest.load(resolve(path));
  const runContext = createRunContext();
  const resolver = new ManifestResolver(
    manifest.schema,
    manifest.prompts,
    runContext,
  );
  const root = await resolver.resolveRoot();
  if (isAgentGroupConfig(root)) {
    throw new Error(
      "Group manifests are not runnable from this CLI yet. Set root to a single agent.",
    );
  }
  const runner = new AgentRunner({
    config: root,
    toolRegistry: new ToolRegistry(),
    runContext,
  });
  const result = await runner.run({ userMessage: message });
  console.log(result.finalResponse ?? JSON.stringify(result, null, 2));
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith("cli/main.ts") ||
    process.argv[1].endsWith("cli/main.js") ||
    process.argv[1].endsWith("/nexus") ||
    process.argv[1].endsWith("\\nexus"));

if (isDirect) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
