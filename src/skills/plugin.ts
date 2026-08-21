/** Skills tool plugin for progressive disclosure. */

import type { RunContext } from "../tools/context.js";
import { tool, toolPlugin } from "../tools/decorators.js";
import type { SkillsConfig } from "./config.js";
import { SkillNotFoundError, SkillSecurityError, type FileSkill } from "./models.js";
import { SkillsRegistry } from "./registry.js";
import {
  SkillExecutionDisabledError,
  resolveSandbox,
} from "./sandbox.js";

@toolPlugin({ name: "skills" })
export class SkillsPlugin {
  registry: SkillsRegistry;
  config: SkillsConfig;
  runContext?: RunContext | null;

  constructor(
    registry: SkillsRegistry,
    config: SkillsConfig,
    runContext?: RunContext | null,
  ) {
    this.registry = registry;
    this.config = config;
    this.runContext = runContext;
  }

  @tool({
    name: "load_skill",
    description:
      "Load skill instructions by name. Pass section='all' (default) for the " +
      "full SKILL.md, or a ## heading name (for example 'security') to load " +
      "only that section.",
  })
  loadSkill(skillName: string, section = "all"): string {
    try {
      const skill = this.registry.getSkill(skillName, this.runContext);
      return skill.formatLoadResponse(section);
    } catch (err) {
      if (err instanceof SkillNotFoundError) return `Error: ${err.message}`;
      throw err;
    }
  }

  @tool({
    name: "read_skill_resource",
    description:
      "Read a supplementary file from a skill (references/, assets/, or root). " +
      "Use the resource name exactly as listed by load_skill.",
  })
  readSkillResource(skillName: string, resourceName: string): string {
    try {
      return this.registry.readResource(skillName, resourceName, this.runContext);
    } catch (err) {
      if (err instanceof SkillNotFoundError) return `Error: ${err.message}`;
      if (err instanceof SkillSecurityError) {
        return `Error: security violation — ${err.message}`;
      }
      return `Error: ${String(err)}`;
    }
  }

  @tool({
    name: "run_skill_script",
    requiresApproval: true,
    description:
      "Execute a script bundled with a skill. Only available when script " +
      "execution is enabled and a sandbox adapter is configured.",
  })
  async runSkillScript(
    skillName: string,
    scriptName: string,
    args?: string[] | null,
    runContext?: RunContext | null,
  ): Promise<string> {
    const ctx = runContext ?? this.runContext;
    if (!this.config.allowScripts) {
      return (
        "Error: Script execution is disabled. Enable allowScripts and configure " +
        "a SkillSandboxAdapter in SkillsConfig.sandboxAdapter."
      );
    }
    try {
      const skill = this.registry.getSkill(skillName, ctx);
      const script = findScript(skill, scriptName);
      if (!script) {
        return `Error: Script '${scriptName}' not found in skill '${skillName}'`;
      }
      const sandbox = resolveSandbox(this.config.sandboxAdapter);
      return await sandbox.runScript(skill, script, args, { runContext: ctx });
    } catch (err) {
      if (err instanceof SkillExecutionDisabledError) return `Error: ${err.message}`;
      if (err instanceof SkillNotFoundError) return `Error: ${err.message}`;
      return `Error: ${String(err)}`;
    }
  }
}

function findScript(skill: FileSkill, scriptName: string) {
  for (const script of skill.scripts) {
    if (
      script.name === scriptName ||
      script.relativePath === scriptName ||
      script.relativePath.endsWith(`/${scriptName}.py`) ||
      script.relativePath.endsWith(`/${scriptName}`)
    ) {
      return script;
    }
  }
  return null;
}

export function createSkillsPlugin(
  registry: SkillsRegistry,
  config: SkillsConfig,
  runContext?: RunContext | null,
): SkillsPlugin {
  return new SkillsPlugin(registry, config, runContext);
}
