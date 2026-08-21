/** Resolve manifest documents into AgentConfig / AgentGroupConfig trees. */

import type { AgentConfig, AgentGroupConfig } from "../config/agent.js";
import { parseAgentConfig, parseAgentGroupConfig } from "../config/agent.js";
import type { LLMProviderConfig } from "../config/llm.js";
import { parseLLMProviderConfig } from "../config/llm.js";
import type { RunContext } from "../tools/context.js";
import { ManifestLoadError, MemberNotFoundError, ReferenceCycleError } from "./errors.js";
import { resolvePersonaConfig, type PromptRegistry } from "./prompts.js";
import type { OrchestrationManifestSchema } from "./schema.js";

export type MemberConfig = AgentConfig | AgentGroupConfig;

export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (
      key in result &&
      result[key] != null &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key]) &&
      value != null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = structuredClone(value);
    }
  }
  return result;
}

export function isAgentGroupConfig(
  config: MemberConfig,
): config is AgentGroupConfig {
  return "pattern" in config && "members" in config;
}

function isInlineGroup(entry: Record<string, unknown>): boolean {
  return "pattern" in entry && "members" in entry;
}

function coerceLlmConfig(data: Record<string, unknown>): LLMProviderConfig {
  const llmData = { ...data };
  if (typeof llmData.api_key !== "string" && typeof llmData.apiKey !== "string") {
    llmData.api_key = String(llmData.api_key ?? llmData.apiKey ?? "");
  }
  return parseLLMProviderConfig(llmData);
}

export class ManifestResolver {
  readonly schema: OrchestrationManifestSchema;
  readonly prompts: PromptRegistry;
  readonly runContext: RunContext;

  constructor(
    schema: OrchestrationManifestSchema,
    prompts: PromptRegistry,
    runContext: RunContext,
  ) {
    this.schema = schema;
    this.prompts = prompts;
    this.runContext = runContext;
  }

  async resolveRoot(): Promise<MemberConfig> {
    return this.resolveRootName(this.schema.root);
  }

  async resolveNamedAgent(name: string): Promise<AgentConfig> {
    if (!(name in this.schema.agents)) {
      throw new ManifestLoadError(`Realtime agent '${name}' not found in manifest agents`);
    }
    return this.resolveAgent(name, this.schema.agents[name]!);
  }

  private async resolveRootName(name: string): Promise<MemberConfig> {
    if (name in this.schema.agents) {
      return this.resolveAgent(name, this.schema.agents[name]!);
    }
    if (name in this.schema.groups) {
      return this.resolveGroup(name, this.schema.groups[name]!, []);
    }
    throw new ManifestLoadError(
      `Root '${name}' not found in agents or groups. ` +
        `Available agents: ${Object.keys(this.schema.agents).sort().join(", ")}; ` +
        `groups: ${Object.keys(this.schema.groups).sort().join(", ")}`,
    );
  }

  private async resolveAgent(
    name: string,
    spec: Record<string, unknown>,
  ): Promise<AgentConfig> {
    const merged = deepMerge(this.schema.defaults.agent, spec);
    merged.name = name;

    if (!("llm" in merged) && Object.keys(this.schema.defaults.llm).length) {
      merged.llm = structuredClone(this.schema.defaults.llm);
    }

    if (merged.persona && typeof merged.persona === "object") {
      merged.persona = await resolvePersonaConfig(merged.persona as Record<string, unknown>, {
        prompts: this.prompts,
        runContext: this.runContext,
      });
    }

    const llmData = merged.llm;
    if (llmData && typeof llmData === "object") {
      merged.llm = coerceLlmConfig(llmData as Record<string, unknown>);
    }

    return parseAgentConfig(merged);
  }

  private async resolveGroup(
    name: string,
    spec: Record<string, unknown>,
    resolving: string[],
  ): Promise<AgentGroupConfig> {
    if (resolving.includes(name)) {
      throw new ReferenceCycleError([...resolving, name]);
    }

    const merged = deepMerge(this.schema.defaults.group, spec);
    merged.name = name;

    const pattern = merged.pattern ?? "supervisor";
    if (!["supervisor", "pipeline", "parallel"].includes(String(pattern))) {
      throw new ManifestLoadError(
        `Group '${name}' has unsupported pattern '${pattern}'. Supported: supervisor, pipeline, parallel`,
      );
    }

    const membersSpec = (merged.members as unknown[]) ?? [];
    const resolvedMembers: MemberConfig[] = [];
    const stack = [...resolving, name];

    for (const memberEntry of membersSpec) {
      resolvedMembers.push(
        await this.resolveMemberEntry(memberEntry, { groupName: name, resolving: stack }),
      );
    }

    merged.members = resolvedMembers;
    return parseAgentGroupConfig(merged);
  }

  private async resolveMemberEntry(
    entry: unknown,
    opts: { groupName: string; resolving: string[] },
  ): Promise<MemberConfig> {
    if (typeof entry === "string") {
      return this.resolveMemberRef(entry, opts);
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const dict = entry as Record<string, unknown>;
      if (isInlineGroup(dict)) {
        const inlineName = dict.name;
        if (!inlineName || typeof inlineName !== "string") {
          throw new ManifestLoadError(
            `Inline group in '${opts.groupName}' must include a name`,
          );
        }
        return this.resolveGroup(inlineName, dict, opts.resolving);
      }
      const inlineName =
        typeof dict.name === "string" ? dict.name : `${opts.groupName}_member`;
      return this.resolveAgent(inlineName, dict);
    }
    throw new ManifestLoadError(
      `Invalid member entry in group '${opts.groupName}': expected name ref or mapping`,
    );
  }

  private async resolveMemberRef(
    name: string,
    opts: { groupName: string; resolving: string[] },
  ): Promise<MemberConfig> {
    if (name in this.schema.agents) {
      return this.resolveAgent(name, this.schema.agents[name]!);
    }
    if (name in this.schema.groups) {
      return this.resolveGroup(name, this.schema.groups[name]!, opts.resolving);
    }
    throw new MemberNotFoundError(name, opts.groupName);
  }
}
