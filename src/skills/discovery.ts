/** Discover SKILL.md files in configured directories. */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SkillParseError, type FileSkill, type SkillScope } from "./models.js";
import { parseSkillMd } from "./parser.js";

const MAX_SCAN_DEPTH = 2;

export function discoverSkillsInPath(
  root: string,
  opts: { scope?: SkillScope; maxDepth?: number } = {},
): FileSkill[] {
  const scope = opts.scope ?? "global";
  const maxDepth = opts.maxDepth ?? MAX_SCAN_DEPTH;
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];

  const skills: FileSkill[] = [];
  const seenDirs = new Set<string>();

  const tryParse = (skillDir: string) => {
    if (seenDirs.has(skillDir)) return;
    seenDirs.add(skillDir);
    try {
      skills.push(parseSkillMd(skillDir, { scope }));
    } catch (err) {
      if (err instanceof SkillParseError) {
        console.warn(`Skipping invalid skill at ${skillDir}: ${err.message}`);
      }
    }
  };

  for (const child of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!child.isDirectory()) continue;
    const skillMd = join(root, child.name, "SKILL.md");
    if (existsSync(skillMd) && statSync(skillMd).isFile()) {
      tryParse(join(root, child.name));
    }
  }

  if (maxDepth >= 2) {
    for (const child of readdirSync(root, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      const nestedRoot = join(root, child.name);
      for (const nested of readdirSync(nestedRoot, { withFileTypes: true })) {
        if (!nested.isDirectory()) continue;
        const skillMd = join(nestedRoot, nested.name, "SKILL.md");
        if (existsSync(skillMd) && statSync(skillMd).isFile()) {
          tryParse(join(nestedRoot, nested.name));
        }
      }
    }
  }

  return skills;
}

export function discoverSkillsFromPaths(
  paths: string[],
  opts: { scope?: SkillScope } = {},
): FileSkill[] {
  const all: FileSkill[] = [];
  for (const path of paths) {
    all.push(...discoverSkillsInPath(path, opts));
  }
  return all;
}
