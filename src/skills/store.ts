/** SkillStore — persist learned skills. */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { SessionScope } from "../session/scope.js";

export type SkillRecordSource = "agentskills" | "learned" | "manual";

export interface SkillRecord {
  name: string;
  trigger: string;
  content: string;
  source: SkillRecordSource;
  enabled: boolean;
  useCount: number;
  updatedAt: Date;
}

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/ /g, "_")
    .replace(/\//g, "__")
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 200);
}

export interface SkillStore {
  search(scope: SessionScope, query: string, k?: number): Promise<SkillRecord[]>;
  upsert(scope: SessionScope, skill: SkillRecord): Promise<SkillRecord>;
  list(
    scope: SessionScope,
    opts?: { includeDisabled?: boolean },
  ): Promise<SkillRecord[]>;
  delete(scope: SessionScope, name: string): Promise<void>;
  disable(scope: SessionScope, name: string): Promise<void>;
  get(scope: SessionScope, name: string): Promise<SkillRecord | null>;
}

function bucket(scope: SessionScope): string {
  const parts = new SessionScopeImplLike(scope).pathSegments();
  return parts.length ? parts.join("/") : "_global";
}

class SessionScopeImplLike {
  constructor(private scope: SessionScope) {}
  pathSegments(keys?: string[]): string[] {
    const order = keys ?? ["tenantId", "companyId", "userId"];
    const segments: string[] = [];
    for (const key of order) {
      const value = (this.scope as unknown as Record<string, unknown>)[key];
      if (value == null || value === "") continue;
      segments.push(String(value).replace(/\//g, "_"));
    }
    return segments;
  }
}

export class InMemorySkillStore implements SkillStore {
  private readonly data = new Map<string, Map<string, SkillRecord>>();

  async search(scope: SessionScope, query: string, k = 6): Promise<SkillRecord[]> {
    const q = query.toLowerCase();
    const matches: SkillRecord[] = [];
    for (const skill of await this.list(scope)) {
      const hay = `${skill.trigger} ${skill.content}`.toLowerCase();
      if (!q || hay.includes(q)) {
        skill.useCount += 1;
        matches.push(skill);
      }
    }
    return matches.slice(0, k);
  }

  async upsert(scope: SessionScope, skill: SkillRecord): Promise<SkillRecord> {
    skill.name = normalizeName(skill.name);
    skill.updatedAt = new Date();
    const b = bucket(scope);
    if (!this.data.has(b)) this.data.set(b, new Map());
    this.data.get(b)!.set(skill.name, { ...skill });
    return skill;
  }

  async list(
    scope: SessionScope,
    opts: { includeDisabled?: boolean } = {},
  ): Promise<SkillRecord[]> {
    const skills = [...(this.data.get(bucket(scope))?.values() ?? [])];
    if (!opts.includeDisabled) {
      return skills.filter((s) => s.enabled);
    }
    return skills;
  }

  async delete(scope: SessionScope, name: string): Promise<void> {
    this.data.get(bucket(scope))?.delete(normalizeName(name));
  }

  async disable(scope: SessionScope, name: string): Promise<void> {
    const skill = await this.get(scope, name);
    if (skill) {
      skill.enabled = false;
      skill.updatedAt = new Date();
    }
  }

  async get(scope: SessionScope, name: string): Promise<SkillRecord | null> {
    return this.data.get(bucket(scope))?.get(normalizeName(name)) ?? null;
  }
}

export class FileSkillStore implements SkillStore {
  constructor(
    private readonly root: string,
    private readonly scopeKeys = ["tenantId", "companyId", "userId"],
  ) {
    mkdirSync(root, { recursive: true });
  }

  private dir(scope: SessionScope): string {
    const segments = new SessionScopeImplLike(scope).pathSegments(this.scopeKeys);
    const path = segments.length
      ? join(this.root, ...segments)
      : join(this.root, "_global");
    mkdirSync(path, { recursive: true });
    return path;
  }

  private skillPath(scope: SessionScope, name: string): string {
    return join(this.dir(scope), normalizeName(name), "SKILL.md");
  }

  private parse(path: string): SkillRecord | null {
    if (!existsSync(path)) return null;
    const text = readFileSync(path, "utf8");
    const meta: Record<string, string> = {};
    let body = text;
    if (text.startsWith("---")) {
      const parts = text.split("---");
      if (parts.length >= 3) {
        for (const line of parts[1]!.trim().split("\n")) {
          const idx = line.indexOf(":");
          if (idx === -1) continue;
          meta[line.slice(0, idx).trim()] = line
            .slice(idx + 1)
            .trim()
            .replace(/^['"]|['"]$/g, "");
        }
        body = parts.slice(2).join("---").trim();
      }
    }
    return {
      name: meta.name ?? path.split(/[/\\]/).slice(-2, -1)[0] ?? "skill",
      trigger: meta.trigger ?? "",
      content: body,
      source: (meta.source as SkillRecordSource) ?? "learned",
      enabled: (meta.enabled ?? "true").toLowerCase() !== "false",
      useCount: parseInt(meta.use_count ?? "0", 10) || 0,
      updatedAt: new Date(),
    };
  }

  private write(path: string, skill: SkillRecord): void {
    mkdirSync(join(path, ".."), { recursive: true });
    const front = [
      "---",
      `name: ${skill.name}`,
      `trigger: ${JSON.stringify(skill.trigger)}`,
      `source: ${skill.source}`,
      `enabled: ${String(skill.enabled)}`,
      `use_count: ${skill.useCount}`,
      "---",
      "",
      skill.content.trim(),
      "",
    ].join("\n");
    writeFileSync(path, front, "utf8");
  }

  async search(scope: SessionScope, query: string, k = 6): Promise<SkillRecord[]> {
    const q = query.toLowerCase();
    const matches: SkillRecord[] = [];
    for (const skill of await this.list(scope)) {
      const hay = `${skill.trigger} ${skill.content}`.toLowerCase();
      if (!q || hay.includes(q)) {
        skill.useCount += 1;
        this.write(this.skillPath(scope, skill.name), skill);
        matches.push(skill);
      }
    }
    return matches.slice(0, k);
  }

  async upsert(scope: SessionScope, skill: SkillRecord): Promise<SkillRecord> {
    skill.name = normalizeName(skill.name);
    skill.updatedAt = new Date();
    this.write(this.skillPath(scope, skill.name), skill);
    return skill;
  }

  async list(
    scope: SessionScope,
    opts: { includeDisabled?: boolean } = {},
  ): Promise<SkillRecord[]> {
    const base = this.dir(scope);
    const skills: SkillRecord[] = [];
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = join(base, entry.name, "SKILL.md");
      if (!existsSync(skillMd) || !statSync(skillMd).isFile()) continue;
      const parsed = this.parse(skillMd);
      if (!parsed) continue;
      if (!opts.includeDisabled && !parsed.enabled) continue;
      skills.push(parsed);
    }
    return skills;
  }

  async delete(scope: SessionScope, name: string): Promise<void> {
    const path = this.skillPath(scope, name);
    if (existsSync(path)) {
      rmSync(join(path, ".."), { recursive: true, force: true });
    }
  }

  async disable(scope: SessionScope, name: string): Promise<void> {
    const skill = await this.get(scope, name);
    if (skill) {
      skill.enabled = false;
      await this.upsert(scope, skill);
    }
  }

  async get(scope: SessionScope, name: string): Promise<SkillRecord | null> {
    return this.parse(this.skillPath(scope, name));
  }
}

export function buildLearnedSkillsBlock(skills: SkillRecord[]): string {
  if (!skills.length) return "";
  const lines = ["## Learned Skills (apply these patterns where relevant)", ""];
  for (const skill of skills) {
    lines.push(`### ${skill.name}`);
    if (skill.trigger) lines.push(`**When**: ${skill.trigger}`);
    lines.push(`**How**: ${skill.content}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
