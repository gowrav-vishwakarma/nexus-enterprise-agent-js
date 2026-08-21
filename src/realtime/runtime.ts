/** Realtime runtime: build voice pipelines from a manifest. */

import type { AgentConfig } from "../config/agent.js";
import {
  createRealtimeAgentConfig,
  createVoiceTeamConfig,
  effectiveStt,
  effectiveTts,
  effectiveVad,
  type RealtimeAgentConfig,
  type VoiceTeamConfig,
} from "./config.js";
import { CascadedVoicePipeline } from "./pipelines/cascaded.js";
import { SpeechToSpeechPipeline } from "./pipelines/speech-to-speech.js";
import {
  logValidationIssues,
  validateVoiceLanguagesStatic,
} from "./validation.js";
import type { RunContext } from "../tools/context.js";
import { ToolRegistry } from "../tools/registry.js";

export interface OrchestrationManifestLike {
  schema: {
    root?: string;
    agents?: Record<string, Record<string, unknown>>;
    groups?: Record<string, Record<string, unknown>>;
    servers?: Record<string, unknown>;
  };
}

const REALTIME_KEYS = new Set([
  "modality",
  "duplex",
  "stt",
  "tts",
  "vad",
  "lid",
  "languages",
  "initial_response",
  "s2s",
  "agent",
]);

export function resolveRealtimeAgent(
  name: string,
  manifest: OrchestrationManifestLike,
  _runContext: RunContext,
): RealtimeAgentConfig {
  const spec = manifest.schema.agents?.[name];
  if (!spec) {
    throw new Error(`Realtime agent '${name}' not found in manifest agents`);
  }
  const agentSpec =
    (spec.agent as Record<string, unknown> | undefined) ??
    Object.fromEntries(Object.entries(spec).filter(([k]) => !REALTIME_KEYS.has(k)));
  return createRealtimeAgentConfig({
    name,
    modality: (spec.modality as RealtimeAgentConfig["modality"]) ?? "voice_cascaded",
    duplex: (spec.duplex as RealtimeAgentConfig["duplex"]) ?? "full",
    agent: agentSpec as unknown as AgentConfig,
    stt: spec.stt as RealtimeAgentConfig["stt"],
    tts: spec.tts as RealtimeAgentConfig["tts"],
    vad: spec.vad as RealtimeAgentConfig["vad"],
    lid: spec.lid as RealtimeAgentConfig["lid"],
    languages: spec.languages as RealtimeAgentConfig["languages"],
    initial_response: spec.initial_response as RealtimeAgentConfig["initial_response"],
    s2s: spec.s2s as RealtimeAgentConfig["s2s"],
  });
}

export function resolveVoiceTeam(
  name: string,
  manifest: OrchestrationManifestLike,
  runContext: RunContext,
): VoiceTeamConfig {
  const spec = manifest.schema.groups?.[name];
  if (!spec) throw new Error(`Voice team '${name}' not found in manifest groups`);
  const members = (spec.members as Array<string | Record<string, unknown>>) ?? [];
  const findMember = (role: string): string | null => {
    for (const member of members) {
      if (typeof member === "string" && member === role) return member;
      if (typeof member === "object" && member) {
        if (member.role === role || member.name === role) {
          return String(member.name ?? role);
        }
      }
    }
    return null;
  };
  const responderName = findMember("responder");
  if (!responderName) {
    throw new Error(`voice_team '${name}' requires a member named/role 'responder'`);
  }
  return createVoiceTeamConfig({
    name,
    duplex: (spec.duplex as VoiceTeamConfig["duplex"]) ?? "full",
    responder: resolveRealtimeAgent(responderName, manifest, runContext),
    context_injection_var: String(spec.context_injection_var ?? "live_context"),
  });
}

export class RealtimeRuntime {
  constructor(
    readonly manifest: OrchestrationManifestLike,
    readonly runContext: RunContext,
    readonly toolRegistry: ToolRegistry = new ToolRegistry(),
  ) {}

  static fromManifest(
    manifest: OrchestrationManifestLike,
    opts: { runContext: RunContext; toolRegistry?: ToolRegistry | null },
  ): RealtimeRuntime {
    return new RealtimeRuntime(
      manifest,
      opts.runContext,
      opts.toolRegistry ?? new ToolRegistry(),
    );
  }

  buildPipeline(name?: string | null) {
    const agentName = name ?? this.manifest.schema.root ?? "";
    const rtConfig = resolveRealtimeAgent(agentName, this.manifest, this.runContext);
    const issues = validateVoiceLanguagesStatic(rtConfig);
    logValidationIssues(issues, { rtConfig });
    return this.pipelineFor(rtConfig);
  }

  pipelineFor(rtConfig: RealtimeAgentConfig) {
    if (rtConfig.modality === "voice_s2s") {
      return new SpeechToSpeechPipeline(rtConfig, {
        toolRegistry: this.toolRegistry,
        runContext: this.runContext,
      });
    }
    return new CascadedVoicePipeline(rtConfig, { runContext: this.runContext });
  }

  buildVoiceTeam(name?: string | null): VoiceTeamConfig {
    const groupName = name ?? this.manifest.schema.root ?? "";
    return resolveVoiceTeam(groupName, this.manifest, this.runContext);
  }
}

export { effectiveStt, effectiveTts, effectiveVad };
