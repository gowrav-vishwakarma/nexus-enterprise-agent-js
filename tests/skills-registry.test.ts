import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultSkillsConfig } from "../src/skills/config.js";
import { SkillNotFoundError } from "../src/skills/models.js";
import { SkillsRegistry } from "../src/skills/registry.js";
import { createRunContext } from "../src/tools/context.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "skills");

function skillsConfig(overrides: Record<string, unknown> = {}) {
  return { ...defaultSkillsConfig(), enabled: true, globalPaths: [FIXTURES], ...overrides };
}

describe("SkillsRegistry", () => {
  // PYTHON: test_discover_and_get_skill
  it("discovers and returns a skill by name", () => {
    const registry = new SkillsRegistry(skillsConfig());
    const skill = registry.getSkill("code-review");
    expect(skill.name).toBe("code-review");
  });

  // PYTHON: test_enabled_skills_allowlist
  it("filters to the enabled_skills allowlist", () => {
    const registry = new SkillsRegistry(skillsConfig({ enabledSkills: ["commit-messages"] }));
    const skills = registry.listSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("commit-messages");
  });

  // PYTHON: test_resolve_explicit_skills_from_config
  it("resolves explicit skills from config", () => {
    const registry = new SkillsRegistry(skillsConfig({ explicitSkills: ["code-review"] }));
    const explicit = registry.resolveExplicitSkills();
    expect(explicit).toHaveLength(1);
    expect(explicit[0]?.name).toBe("code-review");
  });

  // PYTHON: test_resolve_explicit_skills_from_run_context
  it("resolves explicit skills from run context metadata", () => {
    const registry = new SkillsRegistry(skillsConfig());
    const ctx = createRunContext({ metadata: { skills: ["commit-messages"] } });
    const explicit = registry.resolveExplicitSkills(ctx);
    expect(explicit).toHaveLength(1);
    expect(explicit[0]?.name).toBe("commit-messages");
  });

  // PYTHON: test_skill_not_found
  it("throws SkillNotFoundError for a missing name", () => {
    const registry = new SkillsRegistry(skillsConfig());
    expect(() => registry.getSkill("nonexistent")).toThrow(SkillNotFoundError);
  });

  // PYTHON: test_tenant_skills_gated_off
  it("omits tenant paths when allowTenantSkills is false", () => {
    const registry = new SkillsRegistry(skillsConfig({ allowTenantSkills: false }));
    const ctx = createRunContext({ tenantId: "acme" });
    const paths = (
      registry as unknown as {
        resolveSourcePaths: (ctx?: unknown) => Array<[string, string]>;
      }
    ).resolveSourcePaths(ctx);
    expect(paths.every(([, scope]) => scope === "global")).toBe(true);
  });
});
