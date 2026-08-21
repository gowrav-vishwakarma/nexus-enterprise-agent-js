/** Zod schema and types for orchestration manifest documents. */

import { z } from "zod";
import { sessionStorageConfigSchema } from "../config/storage.js";

export const manifestDefaultsSchema = z.object({
  agent: z.record(z.unknown()).default({}),
  llm: z.record(z.unknown()).default({}),
  group: z.record(z.unknown()).default({}),
});

export type ManifestDefaults = z.infer<typeof manifestDefaultsSchema>;

export const orchestrationManifestSchema = z.object({
  version: z.string().default("1"),
  root: z.string().min(1, "root must be a non-empty agent or group name"),
  promptsModule: z.string().optional().nullable(),
  defaults: manifestDefaultsSchema.default({}),
  storage: sessionStorageConfigSchema.default({ adapter: "memory" }),
  plugins: z.record(z.string()).default({}),
  agents: z.record(z.record(z.unknown())).default({}),
  groups: z.record(z.record(z.unknown())).default({}),
  channels: z.record(z.record(z.unknown())).default({}),
  servers: z.record(z.record(z.unknown())).default({}),
});

export type OrchestrationManifestSchema = z.infer<typeof orchestrationManifestSchema>;

/** Normalize YAML keys (snake_case) into schema shape (camelCase). */
export function normalizeManifestRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  if ("prompts_module" in out && out.promptsModule === undefined) {
    out.promptsModule = out.prompts_module;
    delete out.prompts_module;
  }
  return out;
}

export function parseOrchestrationManifestSchema(
  data: unknown,
): OrchestrationManifestSchema {
  const normalized =
    data && typeof data === "object"
      ? normalizeManifestRaw(data as Record<string, unknown>)
      : data;
  return orchestrationManifestSchema.parse(normalized);
}
