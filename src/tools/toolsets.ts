/** Toolset packs — base + optional bundles with recursive includes. */

import { z } from "zod";

export const toolsetSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  visibility: z.enum(["hidden", "frontend"]).default("hidden"),
  default_enabled: z.boolean().default(false),
  includes: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
});

export type Toolset = z.infer<typeof toolsetSchema>;

export const toolsetCatalogSchema = z.object({
  toolset: z.string(),
  description: z.string(),
  default: z.boolean(),
  visibility: z.string(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
    }),
  ),
});

export type ToolsetCatalog = z.infer<typeof toolsetCatalogSchema>;

export function resolveToolsetTools(
  name: string,
  toolsets: Record<string, Toolset>,
  seen: Set<string> = new Set(),
): Set<string> {
  if (seen.has(name)) {
    return new Set();
  }
  seen.add(name);
  const ts = toolsets[name];
  if (!ts) {
    return name.includes(".") ? new Set([name]) : new Set();
  }
  const out = new Set(ts.tools);
  for (const child of ts.includes) {
    for (const toolName of resolveToolsetTools(child, toolsets, seen)) {
      out.add(toolName);
    }
  }
  return out;
}

export function listFrontendToolsets(
  toolsets: Record<string, Toolset>,
  toolDescriptions: Record<string, string> = {},
): ToolsetCatalog[] {
  const out: ToolsetCatalog[] = [];
  for (const ts of Object.values(toolsets)) {
    if (ts.visibility !== "frontend") {
      continue;
    }
    const expanded = [...resolveToolsetTools(ts.name, toolsets)].sort();
    out.push({
      toolset: ts.name,
      description: ts.description,
      default: ts.default_enabled,
      visibility: ts.visibility,
      tools: expanded.map((toolName) => ({
        name: toolName,
        description: toolDescriptions[toolName] ?? "",
      })),
    });
  }
  return out;
}

export function filterSchemasByTools(
  schemas: Array<Record<string, unknown>>,
  allowed: Set<string> | null | undefined,
): Array<Record<string, unknown>> {
  if (allowed == null) {
    return schemas;
  }
  return schemas.filter((schema) => allowed.has(String(schema.name ?? "")));
}
