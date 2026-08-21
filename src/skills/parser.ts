/** Parse and validate SKILL.md files per agentskills.io specification. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createFileSkill,
  SkillParseError,
  type FileSkill,
  type SkillResource,
  type SkillScript,
  type SkillScope,
} from "./models.js";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateName(name: string, directoryName: string): void {
  if (!name || name.length > 64) {
    throw new SkillParseError(`Skill name must be 1-64 characters: ${name}`);
  }
  if (!NAME_RE.test(name)) {
    throw new SkillParseError(
      `Skill name must be lowercase alphanumeric with hyphens: ${name}`,
    );
  }
  if (name !== directoryName) {
    throw new SkillParseError(
      `Skill name ${name} must match parent directory ${directoryName}`,
    );
  }
}

function splitFrontmatter(raw: string): [string, string] {
  if (!raw.startsWith("---")) {
    throw new SkillParseError("SKILL.md must start with YAML frontmatter (---)");
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    throw new SkillParseError("SKILL.md frontmatter must be closed with ---");
  }
  const frontmatter = raw.slice(3, end).trim();
  let body = raw.slice(end + 4);
  if (body.startsWith("\n")) body = body.slice(1);
  return [frontmatter, body];
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    let val: unknown = rawVal!.trim();
    if (typeof val === "string" && val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    out[key!] = val;
  }
  return out;
}

function discoverResources(skillDir: string): SkillResource[] {
  const resources: SkillResource[] = [];
  for (const category of ["references", "assets"] as const) {
    const subdir = join(skillDir, category);
    try {
      if (!statSync(subdir).isDirectory()) continue;
    } catch {
      continue;
    }
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(join(dir, entry.name), rel);
        else if (entry.name !== ".gitkeep") {
          const full = join(dir, entry.name);
          const relPath = join(category, rel).replace(/\\/g, "/");
          const stem = entry.name.includes(".")
            ? entry.name.slice(0, entry.name.lastIndexOf("."))
            : entry.name;
          resources.push({ name: stem, relativePath: relPath, category });
        }
      }
    };
    walk(subdir, "");
  }
  return resources.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function discoverScripts(skillDir: string): SkillScript[] {
  const scripts: SkillScript[] = [];
  const scriptsDir = join(skillDir, "scripts");
  try {
    if (!statSync(scriptsDir).isDirectory()) return scripts;
  } catch {
    return scripts;
  }
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (/\.(py|sh|js)$/.test(entry.name) && entry.name !== ".gitkeep") {
        const relPath = rel.replace(/\\/g, "/");
        const stem = entry.name.slice(0, entry.name.lastIndexOf("."));
        scripts.push({
          name: stem,
          relativePath: relPath,
          fullPath: join(dir, entry.name),
        });
      }
    }
  };
  walk(scriptsDir, "");
  return scripts.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function parseSkillMd(
  skillDir: string,
  opts: { scope?: SkillScope } = {},
): FileSkill {
  const resolved = skillDir;
  const skillMd = join(resolved, "SKILL.md");
  const raw = readFileSync(skillMd, "utf8");
  const [frontmatterRaw, body] = splitFrontmatter(raw);
  const data = parseSimpleYaml(frontmatterRaw);
  const name = data.name;
  if (typeof name !== "string") {
    throw new SkillParseError("SKILL.md frontmatter must include a string 'name' field");
  }
  validateName(name, resolved.split(/[/\\]/).pop() ?? name);
  const description = data.description;
  if (typeof description !== "string" || !description.trim()) {
    throw new SkillParseError("Skill description is required and must be non-empty");
  }
  if (description.length > 1024) {
    throw new SkillParseError("Skill description must be at most 1024 characters");
  }
  const metadataRaw = data.metadata;
  const metadata: Record<string, string> = {};
  if (metadataRaw && typeof metadataRaw === "object") {
    for (const [k, v] of Object.entries(metadataRaw as Record<string, unknown>)) {
      metadata[String(k)] = String(v);
    }
  }
  return createFileSkill({
    frontmatter: {
      name,
      description: description.trim(),
      license: typeof data.license === "string" ? data.license : null,
      compatibility:
        typeof data.compatibility === "string" ? data.compatibility : null,
      allowedTools:
        typeof data["allowed-tools"] === "string"
          ? data["allowed-tools"]
          : typeof data.allowedTools === "string"
            ? data.allowedTools
            : null,
      metadata,
    },
    content: body.trim(),
    directory: resolved,
    resources: discoverResources(resolved),
    scripts: discoverScripts(resolved),
    scope: opts.scope ?? "global",
  });
}
