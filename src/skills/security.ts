/** Security checks for skill file access. */

import { lstatSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * True when `path` is the directory itself or sits inside it.
 * The separator matters: `/skills-evil` must not pass for root `/skills`.
 */
export function isPathWithinDirectory(path: string, directory: string): boolean {
  try {
    const root = resolve(directory);
    const target = resolve(path);
    return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep);
  } catch {
    return false;
  }
}

export function hasSymlinkInPath(path: string, directory: string): boolean {
  const dir = resolve(directory);
  try {
    const rel = relative(dir, resolve(path));
    if (rel.startsWith("..")) return true;
    let current = dir;
    for (const part of rel.split(sep).filter(Boolean)) {
      current = join(current, part);
      try {
        if (lstatSync(current).isSymbolicLink()) return true;
      } catch {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

export function validateResourcePath(
  skillDir: string,
  resourcePath: string,
): string {
  const skillRoot = resolve(skillDir);
  const resolved = resolve(join(skillRoot, resourcePath));
  if (!isPathWithinDirectory(resolved, skillRoot)) {
    throw new Error(`Resource path escapes skill directory: ${resourcePath}`);
  }
  if (hasSymlinkInPath(resolved, skillRoot)) {
    throw new Error(`Symlink detected in resource path: ${resourcePath}`);
  }
  if (!statSync(resolved).isFile()) {
    throw new Error(`Resource not found: ${resourcePath}`);
  }
  return resolved;
}

export function safeReadText(path: string, maxBytes = 512_000): string {
  const size = statSync(path).size;
  if (size > maxBytes) {
    throw new Error(`Resource too large (${size} bytes, max ${maxBytes})`);
  }
  return readFileSync(path, "utf8");
}
