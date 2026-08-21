/** Orchestration runtime wiring for AgentRunner / AgentOrchestrator. */

import { dirname } from "node:path";
import type { AgentConfig, AgentGroupConfig } from "../config/agent.js";
import { AgentOrchestrator } from "../multiagent/orchestrator.js";
import type { AgentGroupResult } from "../multiagent/results.js";
import { PersistenceFactory, type PersistenceBundle } from "../persistence/factory.js";
import type { PersistenceResolver } from "../persistence/resolver.js";
import { AgentRunner } from "../runner/agent-runner.js";
import type { AgentRunResult, AgentStreamEvent } from "../runner/result.js";
import type { RunContext } from "../tools/context.js";
import { ToolRegistry } from "../tools/registry.js";
import { importFromPath } from "./imports.js";
import type { OrchestrationManifest } from "./manifest.js";
import { isAgentGroupConfig, ManifestResolver } from "./resolver.js";

export type Executor = AgentRunner | AgentOrchestrator;
export type RunResult = AgentRunResult | AgentGroupResult;

export interface OrchestrationRuntimeOptions {
  runContext: RunContext;
  toolRegistry?: ToolRegistry | null;
  persistenceResolver?: PersistenceResolver | null;
  eventEmitter?: unknown;
  crossSessionEnabled?: boolean;
}

export class OrchestrationRuntime {
  readonly manifest: OrchestrationManifest;
  readonly runContext: RunContext;
  readonly eventEmitter?: unknown;
  private readonly _toolRegistry: ToolRegistry;
  private readonly _persistence: PersistenceBundle;
  private readonly _rootConfig: AgentConfig | AgentGroupConfig;
  private readonly _executor: Executor;

  private constructor(opts: {
    manifest: OrchestrationManifest;
    runContext: RunContext;
    toolRegistry: ToolRegistry;
    persistence: PersistenceBundle;
    rootConfig: AgentConfig | AgentGroupConfig;
    executor: Executor;
    eventEmitter?: unknown;
  }) {
    this.manifest = opts.manifest;
    this.runContext = opts.runContext;
    this.eventEmitter = opts.eventEmitter;
    this._toolRegistry = opts.toolRegistry;
    this._persistence = opts.persistence;
    this._rootConfig = opts.rootConfig;
    this._executor = opts.executor;
  }

  static async fromManifest(
    manifest: OrchestrationManifest,
    options: OrchestrationRuntimeOptions,
  ): Promise<OrchestrationRuntime> {
    const toolRegistry = await buildToolRegistry(manifest, options.toolRegistry ?? null);
    const persistence = options.persistenceResolver
      ? await PersistenceFactory.fromResolver(
          options.persistenceResolver,
          options.runContext.tenantId,
          options.runContext.userId,
          { crossSessionEnabled: options.crossSessionEnabled ?? true },
        )
      : await PersistenceFactory.fromStorageConfig(manifest.storageConfig, {
          crossSessionEnabled: options.crossSessionEnabled ?? true,
        });
    const resolver = new ManifestResolver(manifest.schema, manifest.prompts, options.runContext);
    const rootConfig = await resolver.resolveRoot();
    const executor = isAgentGroupConfig(rootConfig)
      ? new AgentOrchestrator({
          config: rootConfig,
          toolRegistry,
          sessionManager: persistence.sessionManager,
          runContext: options.runContext,
          crossSessionMemoryStore: persistence.crossSessionMemoryStore,
          eventEmitter: options.eventEmitter,
        })
      : new AgentRunner({
          config: rootConfig,
          toolRegistry,
          sessionManager: persistence.sessionManager,
          runContext: options.runContext,
          eventEmitter: options.eventEmitter as ConstructorParameters<
            typeof AgentRunner
          >[0]["eventEmitter"],
        });
    return new OrchestrationRuntime({
      manifest,
      runContext: options.runContext,
      toolRegistry,
      persistence,
      rootConfig,
      executor,
      eventEmitter: options.eventEmitter,
    });
  }

  get executor(): Executor {
    return this._executor;
  }

  get rootConfig(): AgentConfig | AgentGroupConfig {
    return this._rootConfig;
  }

  get toolRegistry(): ToolRegistry {
    return this._toolRegistry;
  }

  get persistence(): PersistenceBundle {
    return this._persistence;
  }

  async run(options: {
    userMessage: string;
    sessionId?: string | null;
    stream?: boolean | null;
    maxTurns?: number | null;
  }): Promise<RunResult> {
    return this._executor.run(options);
  }

  async *runStream(options: {
    userMessage: string;
    sessionId?: string | null;
    stream?: boolean | null;
    maxTurns?: number | null;
  }): AsyncGenerator<AgentStreamEvent> {
    yield* this._executor.runStream(options);
  }
}

async function buildToolRegistry(
  manifest: OrchestrationManifest,
  toolRegistry: ToolRegistry | null,
): Promise<ToolRegistry> {
  const registry = toolRegistry ?? new ToolRegistry();
  const baseDir = dirname(manifest.path);
  for (const importPath of Object.values(manifest.plugins)) {
    const pluginCls = await importFromPath<unknown>(importPath, baseDir);
    const plugin =
      typeof pluginCls === "function" ? new (pluginCls as new () => unknown)() : pluginCls;
    registry.registerPlugin(plugin);
  }
  return registry;
}
