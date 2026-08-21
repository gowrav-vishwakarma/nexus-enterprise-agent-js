/** Load orchestration manifests from YAML and companion prompt modules. */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SessionStorageConfig } from "../config/storage.js";
import { interpolateEnv } from "./env.js";
import { ManifestLoadError } from "./errors.js";
import {
  loadPromptsModule,
  type PromptRegistry,
} from "./prompts.js";
import {
  parseOrchestrationManifestSchema,
  type OrchestrationManifestSchema,
} from "./schema.js";

export class OrchestrationManifest {
  readonly path: string;
  readonly schema: OrchestrationManifestSchema;
  readonly prompts: PromptRegistry;
  readonly raw: Record<string, unknown>;

  constructor(opts: {
    path: string;
    schema: OrchestrationManifestSchema;
    prompts: PromptRegistry;
    raw: Record<string, unknown>;
  }) {
    this.path = opts.path;
    this.schema = opts.schema;
    this.prompts = opts.prompts;
    this.raw = opts.raw;
  }

  get storageConfig(): SessionStorageConfig {
    return this.schema.storage;
  }

  get plugins(): Record<string, string> {
    return this.schema.plugins;
  }

  static async load(path: string): Promise<OrchestrationManifest> {
    const manifestPath = resolve(path);
    let rawText: string;
    try {
      rawText = readFileSync(manifestPath, "utf-8");
    } catch {
      throw new ManifestLoadError(`Manifest not found: ${manifestPath}`);
    }

    let rawData: unknown;
    try {
      rawData = parseYaml(rawText) ?? {};
    } catch (err) {
      throw new ManifestLoadError(`Invalid YAML in ${manifestPath}: ${err}`);
    }

    if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
      throw new ManifestLoadError(`Manifest root must be a mapping: ${manifestPath}`);
    }

    const expanded = interpolateEnv(rawData) as Record<string, unknown>;
    let schema: OrchestrationManifestSchema;
    try {
      schema = parseOrchestrationManifestSchema(expanded);
    } catch (err) {
      throw new ManifestLoadError(`Invalid manifest schema in ${manifestPath}: ${err}`);
    }

    const promptsPath = resolvePromptsPath(manifestPath, schema.promptsModule ?? null);
    let prompts: PromptRegistry = {};
    try {
      prompts = await loadPromptsModule(promptsPath);
    } catch (err) {
      if (err instanceof ManifestLoadError) {
        throw err;
      }
      throw new ManifestLoadError(`Prompts module not found: ${promptsPath}`);
    }

    validateRoot(schema);
    return new OrchestrationManifest({
      path: manifestPath,
      schema,
      prompts,
      raw: expanded,
    });
  }

  static fromDict(
    data: Record<string, unknown>,
    opts: {
      path?: string | null;
      prompts?: PromptRegistry | null;
    } = {},
  ): OrchestrationManifest {
    const expanded = interpolateEnv(data) as Record<string, unknown>;
    const schema = parseOrchestrationManifestSchema(expanded);
    validateRoot(schema);
    const manifestPath = opts.path ? resolve(opts.path) : resolve("manifest.yaml");
    const promptRegistry = opts.prompts ?? {};
    return new OrchestrationManifest({
      path: manifestPath,
      schema,
      prompts: promptRegistry,
      raw: expanded,
    });
  }
}

function resolvePromptsPath(manifestPath: string, promptsModule: string | null): string {
  if (promptsModule) {
    return resolve(dirname(manifestPath), promptsModule);
  }
  const stem = manifestPath.replace(/\.[^.]+$/, "").split("/").pop() ?? "manifest";
  return resolve(dirname(manifestPath), `${stem}_prompts.ts`);
}

function validateRoot(schema: OrchestrationManifestSchema): void {
  if (schema.root in schema.agents || schema.root in schema.groups) {
    return;
  }
  throw new ManifestLoadError(
    `Root '${schema.root}' not found in agents or groups. ` +
      `Available agents: ${Object.keys(schema.agents).sort().join(", ")}; ` +
      `groups: ${Object.keys(schema.groups).sort().join(", ")}`,
  );
}
