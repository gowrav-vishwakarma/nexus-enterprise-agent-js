/** Skills registry: discovery, caching, and scope resolution. */

import { join } from "node:path";
import type { RunContext } from "../tools/context.js";
import { defaultSkillsConfig, type SkillsConfig } from "./config.js";
import { discoverSkillsFromPaths } from "./discovery.js";
import {
  SkillNotFoundError,
  SkillResourceNotFoundError,
  SkillSecurityError,
  type FileSkill,
  type SkillResource,
} from "./models.js";
import {
  globalSkillsDir,
  tenantSkillsDir,
  userSkillsDir,
} from "./paths.js";
import { safeReadText, validateResourcePath } from "./security.js";

export class SkillsRegistry {
  config: SkillsConfig;
  private cache: Map<string, FileSkill> | null = null;

  constructor(config?: SkillsConfig) {
    this.config = { ...defaultSkillsConfig(), ...config };
  }

  private resolveSourcePaths(
    runContext?: RunContext | null,
  ): Array<[string, FileSkill["scope"]]> {
    const paths: Array<[string, FileSkill["scope"]]> = [];
    for (const p of this.config.globalPaths ?? []) {
      paths.push([p, "global"]);
    }
    if (this.config.allowTenantSkills && runContext?.tenantId) {
      paths.push([tenantSkillsDir(runContext.tenantId), "tenant"]);
    }
    if (
      this.config.allowUserSkills &&
      runContext?.tenantId &&
      runContext.userId
    ) {
      paths.push([
        userSkillsDir(runContext.tenantId, runContext.userId),
        "user",
      ]);
    }
    return paths;
  }

  discover(
    runContext?: RunContext | null,
    opts: { force?: boolean } = {},
  ): Map<string, FileSkill> {
    if (this.cache && !opts.force) return this.cache;
    const merged = new Map<string, FileSkill>();
    for (const [path, scope] of this.resolveSourcePaths(runContext)) {
      for (const skill of discoverSkillsFromPaths([path], { scope })) {
        merged.set(skill.name, skill);
      }
    }
    if (this.config.enabledSkills != null) {
      const allow = new Set(this.config.enabledSkills);
      for (const key of [...merged.keys()]) {
        if (!allow.has(key)) merged.delete(key);
      }
    }
    this.cache = merged;
    return merged;
  }

  getSkill(name: string, runContext?: RunContext | null): FileSkill {
    const skills = this.discover(runContext);
    const skill = skills.get(name);
    if (!skill) throw new SkillNotFoundError(`Skill not found: ${name}`);
    return skill;
  }

  listSkills(runContext?: RunContext | null): FileSkill[] {
    return [...this.discover(runContext).values()];
  }

  readResource(
    skillName: string,
    resourceName: string,
    runContext?: RunContext | null,
  ): string {
    const skill = this.getSkill(skillName, runContext);
    const resource = findResource(skill, resourceName);
    if (!resource) {
      throw new SkillResourceNotFoundError(
        `Resource '${resourceName}' not found in skill '${skillName}'`,
      );
    }
    try {
      const resolved = validateResourcePath(
        skill.directory,
        resource.relativePath,
      );
      return safeReadText(resolved);
    } catch (err) {
      throw new SkillSecurityError(String(err));
    }
  }

  resolveExplicitSkills(runContext?: RunContext | null): FileSkill[] {
    const names: string[] = [...(this.config.explicitSkills ?? [])];
    const raw = runContext?.metadata?.skills;
    if (typeof raw === "string") names.push(raw);
    else if (Array.isArray(raw)) names.push(...raw.map(String));

    const seen = new Set<string>();
    const result: FileSkill[] = [];
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      try {
        result.push(this.getSkill(name, runContext));
      } catch (err) {
        if (err instanceof SkillNotFoundError) {
          console.warn(`Explicit skill '${name}' not found; skipping`);
        }
      }
    }
    return result;
  }

  hasScripts(runContext?: RunContext | null): boolean {
    return this.listSkills(runContext).some((s) => s.scripts.length > 0);
  }

  invalidateCache(): void {
    this.cache = null;
  }
}

function findResource(
  skill: FileSkill,
  resourceName: string,
): SkillResource | null {
  for (const res of skill.resources) {
    if (
      res.name === resourceName ||
      res.relativePath === resourceName ||
      res.relativePath.endsWith(`/${resourceName}`)
    ) {
      return res;
    }
  }
  return null;
}

export { globalSkillsDir };
