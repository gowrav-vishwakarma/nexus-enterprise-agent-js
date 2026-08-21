/** Import helpers for orchestration manifests. */

import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";

const FILE_EXT = /\.(ts|js|mts|mjs|cts|cjs)$/i;

function splitImportPath(classPath: string): { modulePart: string; exportName: string } {
  const hashIdx = classPath.lastIndexOf("#");
  if (hashIdx > 0) {
    const exportName = classPath.slice(hashIdx + 1).trim();
    if (!exportName) {
      throw new Error(`Invalid import path: '${classPath}'`);
    }
    return { modulePart: classPath.slice(0, hashIdx), exportName };
  }

  if (FILE_EXT.test(classPath)) {
    throw new Error(
      `Invalid import path: '${classPath}'. Use './file.ts#ExportName' to select an export.`,
    );
  }

  const lastDot = classPath.lastIndexOf(".");
  if (lastDot <= 0) {
    throw new Error(`Invalid import path: '${classPath}'`);
  }
  return {
    modulePart: classPath.slice(0, lastDot),
    exportName: classPath.slice(lastDot + 1),
  };
}

function toRuntimeSpecifier(specifier: string): string {
  if (specifier.endsWith(".ts")) {
    return specifier.replace(/\.ts$/, ".js");
  }
  if (specifier.endsWith(".mts")) {
    return specifier.replace(/\.mts$/, ".mjs");
  }
  if (specifier.endsWith(".cts")) {
    return specifier.replace(/\.cts$/, ".cjs");
  }
  if (FILE_EXT.test(specifier)) {
    return specifier;
  }
  return `${specifier}.js`;
}

function resolveModuleHref(specifier: string, baseDir?: string): string {
  if (specifier.startsWith("file:")) {
    return specifier;
  }
  const withExt = toRuntimeSpecifier(specifier);
  if (specifier.startsWith(".") || isAbsolute(specifier) || specifier.startsWith("/")) {
    const abs = isAbsolute(withExt) ? withExt : resolve(baseDir ?? process.cwd(), withExt);
    return pathToFileURL(abs).href;
  }
  return withExt;
}

/**
 * Import and return an export from a module path.
 *
 * Supported forms:
 * - `./file.ts#ExportName` (preferred for file-relative TS/JS modules)
 * - `./file.js#ExportName`
 * - `package/module.ExportName` (Python-style dotted path)
 */
export async function importFromPath<T = unknown>(
  classPath: string,
  baseDir?: string,
): Promise<T> {
  const { modulePart, exportName } = splitImportPath(classPath);

  let href: string;
  if (modulePart.includes("/") || modulePart.startsWith(".") || FILE_EXT.test(modulePart)) {
    href = resolveModuleHref(modulePart, baseDir);
  } else {
    href = resolveModuleHref(modulePart.replace(/\./g, "/"), baseDir);
  }

  const mod = (await import(href)) as Record<string, unknown>;
  const exported = mod[exportName];
  if (exported === undefined) {
    throw new Error(`Export '${exportName}' not found in ${modulePart}`);
  }
  return exported as T;
}

export async function loadCustomAdapter(
  classPath: string,
  adapterConfig: Record<string, unknown>,
): Promise<import("../session/adapters/base.js").StorageAdapter> {
  const adapterCls = (await importFromPath<new (config: Record<string, unknown>) => import("../session/adapters/base.js").StorageAdapter>(
    classPath,
  ));
  return new adapterCls(adapterConfig);
}
