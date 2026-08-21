import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli/main.js";
import { OrchestrationManifest } from "../src/orchestration/manifest.js";
import { interpolateEnv } from "../src/orchestration/env.js";
import { AgentRunner } from "../src/runner/agent-runner.js";
import { createRunContext } from "../src/tools/context.js";
import { ORCHESTRATION_PROMPTS, writeTempYaml } from "./helpers.js";

async function writeSoloYaml(): Promise<string> {
  return writeTempYaml(
    "solo.yaml",
    `version: "1"
prompts_module: ${ORCHESTRATION_PROMPTS}
root: solo

defaults:
  llm:
    provider: openai
    model: gpt-4o-mini
    api_key: test-key

agents:
  solo:
    persona:
      role: Solo
      goal: Answer
      prompt: researcher_system
      prompt_args:
        domain: ops
`,
  );
}

async function writeGroupYaml(): Promise<string> {
  return writeTempYaml(
    "basic.yaml",
    `version: "1"
prompts_module: ${ORCHESTRATION_PROMPTS}
root: research_pipeline

defaults:
  llm:
    provider: openai
    model: gpt-4o-mini
    api_key: test-key

agents:
  researcher:
    persona:
      role: Researcher
      goal: Gather
      prompt: researcher_system
      prompt_args:
        domain: finance
  analyst:
    persona:
      role: Analyst
      goal: Analyze
      prompt: analyst_system
      prompt_args:
        domain: finance

groups:
  research_pipeline:
    pattern: pipeline
    members: [researcher, analyst]
`,
  );
}

describe("CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // PYTHON: test_run_manifest_loads_yaml_and_passes_run_context
  it("loads a YAML path and passes a RunContext into the runner", async () => {
    const captured: { manifest?: OrchestrationManifest; runContext?: unknown } = {};
    const path = await writeSoloYaml();
    const load = OrchestrationManifest.load.bind(OrchestrationManifest);
    vi.spyOn(OrchestrationManifest, "load").mockImplementation(async (manifestPath: string) => {
      const manifest = await load(manifestPath);
      captured.manifest = manifest;
      return manifest;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const run = vi.fn().mockResolvedValue({
      sessionId: "s",
      finalResponse: "ok",
      turnsUsed: 1,
      status: "completed",
    });
    vi.spyOn(AgentRunner.prototype, "run").mockImplementation(function (
      this: AgentRunner,
      ...args: unknown[]
    ) {
      captured.runContext = this.runContext;
      return run.apply(this, args as never);
    });

    await main(["run", path, "hello"]);

    expect(captured.manifest).toBeInstanceOf(OrchestrationManifest);
    expect(captured.manifest?.schema.root).toBe("solo");
    expect(captured.runContext).toBeTruthy();
    expect(run).toHaveBeenCalled();
    const firstArg = run.mock.calls[0]?.[0];
    const message =
      firstArg === "hello"
        ? firstArg
        : (firstArg as { userMessage?: string } | undefined)?.userMessage;
    expect(message).toBe("hello");
  });

  it("validates a group manifest without running it", async () => {
    const path = await writeGroupYaml();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    await main(["manifest", "validate", path]);
    expect(logs.join("\n")).toContain("research_pipeline");
  });

  it("interpolates env markers used by CLI-loaded YAML", () => {
    process.env.CLI_ORCH_MODEL = "cli-model";
    expect(interpolateEnv("${ENV:CLI_ORCH_MODEL|fallback}")).toBe("cli-model");
    delete process.env.CLI_ORCH_MODEL;
    expect(interpolateEnv("${ENV:CLI_ORCH_MISSING|fallback}")).toBe("fallback");
  });

  it("creates a RunContext for CLI runs", () => {
    const ctx = createRunContext();
    expect(ctx).toBeTruthy();
  });
});
