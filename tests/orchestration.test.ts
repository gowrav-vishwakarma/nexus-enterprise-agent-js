import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAgentConfig, type AgentGroupConfig } from "../src/config/agent.js";
import { parseSessionStorageConfig } from "../src/config/storage.js";
import { InMemoryCrossSessionMemoryStore } from "../src/memory/cross-session-store.js";
import { AgentOrchestrator } from "../src/multiagent/orchestrator.js";
import {
  ManifestLoadError,
  ManifestResolver,
  OrchestrationManifest,
  OrchestrationRuntime,
  PromptNotFoundError,
  ReferenceCycleError,
  interpolateEnv,
  isAgentGroupConfig,
} from "../src/orchestration/index.js";
import type { PersistenceBundle } from "../src/persistence/factory.js";
import type { PersistenceResolver } from "../src/persistence/resolver.js";
import { AgentRunner } from "../src/runner/agent-runner.js";
import { SessionManager } from "../src/session/manager.js";
import { createRunContext } from "../src/tools/context.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { renderSystemPrompt } from "../src/utils/jinja.js";
import { createLLMResponse } from "../src/llm/response.js";
import {
  FIXTURE_SEARCH_PLUGIN,
  ORCHESTRATION_PROMPTS,
  orchInternals,
  writeTempYaml,
} from "./helpers.js";

function defaultLlmYaml(): string {
  return `    provider: openai
    model: \${ENV:ORCH_TEST_MODEL|gpt-4o-mini}
    api_key: \${ENV:ORCH_TEST_API_KEY|test-key}`;
}

async function writeBasicYaml(): Promise<string> {
  return writeTempYaml(
    "basic.yaml",
    `version: "1"
prompts_module: ${ORCHESTRATION_PROMPTS}
root: research_pipeline

defaults:
  agent:
    turns:
      max_turns: 3
  llm: &default_llm
${defaultLlmYaml()}

storage:
  adapter: memory

plugins:
  fixture_search: ${FIXTURE_SEARCH_PLUGIN}

agents:
  researcher:
    llm: *default_llm
    tool_plugins: [fixture_search]
    persona:
      role: Researcher
      goal: Gather facts
      prompt: researcher_system
      prompt_args:
        domain: finance

  analyst:
    llm: *default_llm
    persona:
      role: Analyst
      goal: Analyze findings
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

async function writeMissingPromptYaml(): Promise<string> {
  return writeTempYaml(
    "missing_prompt.yaml",
    `version: "1"
root: missing_prompt_agent
prompts_module: ${ORCHESTRATION_PROMPTS}

defaults:
  llm:
    provider: openai
    model: gpt-4o-mini
    api_key: test-key

agents:
  missing_prompt_agent:
    persona:
      role: Tester
      goal: Test
      prompt: does_not_exist
`,
  );
}

async function writeCycleYaml(): Promise<string> {
  return writeTempYaml(
    "cycle.yaml",
    `version: "1"
root: loop_a
prompts_module: ${ORCHESTRATION_PROMPTS}

defaults:
  llm:
    provider: openai
    model: gpt-4o-mini
    api_key: test-key

agents:
  helper:
    persona:
      role: Helper
      goal: Help

groups:
  loop_a:
    pattern: pipeline
    members: [loop_b]
  loop_b:
    pattern: pipeline
    members: [loop_a]
`,
  );
}

async function writeParallelYaml(): Promise<string> {
  return writeTempYaml(
    "parallel.yaml",
    `version: "1"
root: parallel_group
prompts_module: ${ORCHESTRATION_PROMPTS}

defaults:
  llm:
    provider: openai
    model: gpt-4o-mini
    api_key: test-key

agents:
  worker:
    persona:
      role: Worker
      goal: Work

groups:
  parallel_group:
    pattern: parallel
    members: [worker]
`,
  );
}

async function writeNestedYaml(): Promise<string> {
  return writeTempYaml(
    "nested.yaml",
    `version: "1"
root: nested_team
prompts_module: ${ORCHESTRATION_PROMPTS}

defaults:
  llm:
    provider: openai
    model: gpt-4o-mini
    api_key: test-key

agents:
  supervisor:
    persona:
      role: Supervisor
      goal: Coordinate
      prompt: researcher_system
      prompt_args:
        domain: ops

  researcher:
    tool_plugins: [fixture_search]
    persona:
      role: Researcher
      goal: Gather
      prompt: researcher_system
      prompt_args:
        domain: ops

  analyst:
    persona:
      role: Analyst
      goal: Analyze
      prompt: analyst_system
      prompt_args:
        domain: ops

plugins:
  fixture_search: ${FIXTURE_SEARCH_PLUGIN}

groups:
  analysis_pipeline:
    pattern: pipeline
    session_id_prefix: pipe_
    members: [researcher, analyst]

  nested_team:
    pattern: supervisor
    session_id_prefix: team_
    members: [supervisor, analysis_pipeline]
`,
  );
}

class OverrideResolver implements PersistenceResolver {
  resolveStorageConfig() {
    return parseSessionStorageConfig({ adapter: "memory" });
  }

  resolveBundle(): PersistenceBundle {
    return {
      sessionManager: new SessionManager(),
      crossSessionMemoryStore: new InMemoryCrossSessionMemoryStore(),
    };
  }
}

describe("orchestration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // PYTHON: test_env_interpolation_with_default
  it("interpolates env with a default", () => {
    expect(interpolateEnv("${ENV:ORCH_MISSING_VAR|fallback}")).toBe("fallback");
  });

  // PYTHON: test_env_interpolation_from_env
  it("interpolates env from process.env", () => {
    process.env.ORCH_TEST_ENV = "resolved";
    expect(interpolateEnv("${ENV:ORCH_TEST_ENV}")).toBe("resolved");
    delete process.env.ORCH_TEST_ENV;
  });

  // PYTHON: test_manifest_load_basic
  it("loads a basic manifest", async () => {
    const manifest = await OrchestrationManifest.load(await writeBasicYaml());
    expect(manifest.schema.root).toBe("research_pipeline");
    expect(manifest.prompts).toHaveProperty("researcher_system");
    expect(manifest.storageConfig.adapter).toBe("memory");
    expect(manifest.plugins).toHaveProperty("fixture_search");
  });

  // PYTHON: test_manifest_missing_prompt_raises
  it("raises when a prompt name is missing", async () => {
    const manifest = await OrchestrationManifest.load(await writeMissingPromptYaml());
    const resolver = new ManifestResolver(manifest.schema, manifest.prompts, createRunContext());
    await expect(resolver.resolveRoot()).rejects.toBeInstanceOf(PromptNotFoundError);
  });

  // PYTHON: test_reference_cycle_detection
  it("detects group reference cycles", async () => {
    const manifest = await OrchestrationManifest.load(await writeCycleYaml());
    const resolver = new ManifestResolver(manifest.schema, manifest.prompts, createRunContext());
    try {
      await resolver.resolveRoot();
      throw new Error("expected ReferenceCycleError");
    } catch (err) {
      expect(err).toBeInstanceOf(ReferenceCycleError);
      expect((err as ReferenceCycleError).cyclePath).toContain("loop_a");
    }
  });

  // PYTHON: test_parallel_pattern_is_implemented
  it("preserves the parallel pattern", async () => {
    const manifest = await OrchestrationManifest.load(await writeParallelYaml());
    const resolver = new ManifestResolver(manifest.schema, manifest.prompts, createRunContext());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = await resolver.resolveRoot();
    expect(isAgentGroupConfig(config)).toBe(true);
    expect((config as AgentGroupConfig).pattern).toBe("parallel");
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/falling back to pipeline/i);
  });

  // PYTHON: test_unimplemented_pattern_raises
  it("raises on an unsupported group pattern", async () => {
    const manifest = await OrchestrationManifest.load(await writeParallelYaml());
    manifest.schema.groups[manifest.schema.root]!.pattern = "swarm";
    const resolver = new ManifestResolver(manifest.schema, manifest.prompts, createRunContext());
    await expect(resolver.resolveRoot()).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ManifestLoadError && /unsupported pattern/i.test((err as Error).message),
    );
  });

  // PYTHON: test_nested_group_resolution
  it("resolves nested groups", async () => {
    const manifest = await OrchestrationManifest.load(await writeNestedYaml());
    const resolver = new ManifestResolver(
      manifest.schema,
      manifest.prompts,
      createRunContext({ tenantId: "tenant-1" }),
    );
    const config = await resolver.resolveRoot();
    expect(isAgentGroupConfig(config)).toBe(true);
    const group = config as AgentGroupConfig;
    expect(group.pattern).toBe("supervisor");
    expect(group.members).toHaveLength(2);
    const nested = group.members[1];
    expect(isAgentGroupConfig(nested!)).toBe(true);
    expect((nested as AgentGroupConfig).pattern).toBe("pipeline");
  });

  // PYTHON: test_prompt_template_and_callable_resolution
  it("resolves string and callable prompt templates without rendering tenant yet", async () => {
    const manifest = await OrchestrationManifest.load(await writeBasicYaml());
    const runContext = createRunContext({ tenantId: "tenant-42" });
    const resolver = new ManifestResolver(manifest.schema, manifest.prompts, runContext);
    const config = await resolver.resolveRoot();
    expect(isAgentGroupConfig(config)).toBe(true);
    const group = config as AgentGroupConfig;
    const researcher = group.members[0]!;
    expect("pattern" in researcher).toBe(false);
    const researcherCfg = parseAgentConfig(researcher);
    expect(researcherCfg.persona.system_prompt_template).toContain("{{ tenant_id }}");
    expect(researcherCfg.persona.system_prompt_template).not.toContain("Tenant: tenant-42");
    const analyst = parseAgentConfig(group.members[1]!);
    expect(analyst.persona.system_prompt_template).toContain("{{ tenant_id }}");
    expect(analyst.persona.system_prompt_template).not.toContain("Tenant=tenant-42");

    const rendered = renderSystemPrompt(researcherCfg.persona as Record<string, unknown>, {
      runContext,
    });
    expect(rendered).toContain("Tenant: tenant-42");
  });

  // PYTHON: test_persistence_resolver_override
  it("accepts a persistence resolver override", async () => {
    const manifest = await OrchestrationManifest.load(await writeBasicYaml());
    const runtime = await OrchestrationRuntime.fromManifest(manifest, {
      runContext: createRunContext({ tenantId: "t1", sessionId: "sess-1" }),
      persistenceResolver: new OverrideResolver(),
    });
    expect(runtime.executor).toBeTruthy();
  });

  // PYTHON: test_tool_plugin_import_from_manifest
  it("imports tool plugins from the manifest", async () => {
    const manifest = await OrchestrationManifest.load(await writeBasicYaml());
    const runtime = await OrchestrationRuntime.fromManifest(manifest, {
      runContext: createRunContext({ sessionId: "sess-tools" }),
    });
    expect(runtime.toolRegistry.has("fixture_search.search")).toBe(true);
  });

  // PYTHON: test_runtime_builds_orchestrator_with_member_session_prefix
  it("prefixes member session ids from the group", async () => {
    const manifest = await OrchestrationManifest.load(await writeNestedYaml());
    const runtime = await OrchestrationRuntime.fromManifest(manifest, {
      runContext: createRunContext({ sessionId: "root-session", tenantId: "t1" }),
    });
    expect(runtime.executor).toBeInstanceOf(AgentOrchestrator);
    const supervisor = orchInternals(runtime.executor as AgentOrchestrator).members.get(
      "supervisor",
    );
    expect(supervisor).toBeInstanceOf(AgentRunner);
    expect((supervisor as AgentRunner).runContext.sessionId).toBe("team_root-session_supervisor");
  });

  // PYTHON: test_runtime_integration_renders_tenant_in_system_prompt
  it("renders tenant into the system prompt during a mocked run", async () => {
    const manifest = await OrchestrationManifest.load(await writeBasicYaml());
    const runtime = await OrchestrationRuntime.fromManifest(manifest, {
      runContext: createRunContext({ tenantId: "tenant-integration", sessionId: "sess-int" }),
    });
    expect(runtime.executor).toBeInstanceOf(AgentOrchestrator);
    const orch = runtime.executor as AgentOrchestrator;
    const researcher = orchInternals(orch).members.get("researcher");
    const analyst = orchInternals(orch).members.get("analyst");
    expect(researcher).toBeInstanceOf(AgentRunner);
    expect(analyst).toBeInstanceOf(AgentRunner);

    const response = createLLMResponse({
      content: "Done researching.",
      toolCalls: [],
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10, cachedTokens: 0 },
      finishReason: "stop",
    });
    const chat = vi.fn().mockResolvedValue(response);
    vi.spyOn((researcher as AgentRunner).llmProxy, "chat").mockImplementation(chat);
    vi.spyOn((analyst as AgentRunner).llmProxy, "chat").mockImplementation(chat);

    const result = await runtime.run({ userMessage: "Analyze revenue", sessionId: "sess-int" });
    expect(result.finalResponse).toBe("Done researching.");
    expect(chat).toHaveBeenCalledTimes(2);
    const researcherMessages = chat.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(String(researcherMessages[0]!.content)).toContain("Tenant: tenant-integration");
  });

  // PYTHON: test_single_agent_root
  it("builds a single-agent root as AgentRunner", async () => {
    const data = {
      root: "solo",
      agents: {
        solo: {
          llm: { provider: "openai", model: "gpt-4o-mini", api_key: "k" },
          persona: { role: "Solo", goal: "Go" },
        },
      },
    };
    const manifest = OrchestrationManifest.fromDict(data, { prompts: { ignored: "unused" } });
    const runtime = await OrchestrationRuntime.fromManifest(manifest, {
      runContext: createRunContext({ sessionId: "solo-sess" }),
    });
    expect(runtime.executor).toBeInstanceOf(AgentRunner);
    expect((runtime.executor as AgentRunner).config.name).toBe("solo");
  });

  // PYTHON: test_prebuilt_tool_registry_is_not_replaced
  it("registers plugins onto a prebuilt tool registry", async () => {
    const manifest = await OrchestrationManifest.load(await writeBasicYaml());
    const registry = new ToolRegistry();
    const runtime = await OrchestrationRuntime.fromManifest(manifest, {
      runContext: createRunContext({ sessionId: "sess-shared" }),
      toolRegistry: registry,
    });
    expect(runtime.toolRegistry).toBe(registry);
    expect(registry.has("fixture_search.search")).toBe(true);
  });
});
