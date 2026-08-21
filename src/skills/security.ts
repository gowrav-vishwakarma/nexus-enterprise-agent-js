/** Security checks for skill file access. */

import { lstatSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export function isPathWithinDirectory(path: string, directory: string): boolean {
  try {
    resolve(path).startsWith(resolve(directory));
    return true;
  } catch {
    return false;
  }
}

export function hasSymlinkInPath(path: string, directory: string): boolean {
  const dir = resolve(directory);
  try {
    const rel = path.replace(dir, "").split(/[/\\]/).filter(Boolean);
    let current = dir;
    for (const part of rel) {
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
  const candidate = join(skillRoot, resourcePath);
  if (hasSymlinkInPath(candidate, skillRoot)) {
    throw new Error(`Symlink detected in resource path: ${resourcePath}`);
  }
  const resolved = resolve(candidate);
  if (!resolved.startsWith(skillRoot)) {
    throw new Error(`Resource path escapes skill directory: ${resourcePath}`);
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
