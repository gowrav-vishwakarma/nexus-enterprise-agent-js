/** YAML-driven agent orchestration bootstrap. */

export {
  OrchestrationError,
  ManifestLoadError,
  PromptNotFoundError,
  ReferenceCycleError,
  MemberNotFoundError,
} from "./errors.js";
export { interpolateEnv } from "./env.js";
export { importFromPath } from "./imports.js";
export { OrchestrationManifest } from "./manifest.js";
export {
  loadPromptsModule,
  resolvePersonaConfig,
  resolvePromptTemplate,
  buildPromptContext,
  type PromptRegistry,
  type PromptValue,
} from "./prompts.js";
export { OrchestrationRuntime } from "./runtime.js";
export type { Executor, RunResult, OrchestrationRuntimeOptions } from "./runtime.js";
export { ManifestResolver, deepMerge, isAgentGroupConfig } from "./resolver.js";
export type { MemberConfig } from "./resolver.js";
export {
  orchestrationManifestSchema,
  parseOrchestrationManifestSchema,
  type OrchestrationManifestSchema,
  type ManifestDefaults,
} from "./schema.js";
