import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultSkillsConfig, type SkillsConfig } from "../src/skills/config.js";
import { createSkillsPlugin, type SkillsPlugin } from "../src/skills/plugin.js";
import { SkillsRegistry } from "../src/skills/registry.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "skills");

function makePlugin(): { registry: SkillsRegistry; plugin: SkillsPlugin; config: SkillsConfig } {
  const config = { ...defaultSkillsConfig(), enabled: true, globalPaths: [FIXTURES] };
  const registry = new SkillsRegistry(config);
  return { registry, plugin: createSkillsPlugin(registry, config), config };
}

describe("skills tool plugin", () => {
  // PYTHON: test_load_skill
  it("loads a skill", () => {
    const { plugin } = makePlugin();
    const result = plugin.loadSkill("code-review");
    expect(result).toContain("Code Review Skill");
    expect(result).toContain("checklist");
  });

  // PYTHON: test_load_skill_section
  it("loads a single section", () => {
    const { plugin } = makePlugin();
    const result = plugin.loadSkill("code-review", "instructions");
    expect(result).toContain("Read the code carefully");
    expect(result.includes("Examples") === false || result.toLowerCase().includes("section: instructions")).toBe(
      true,
    );
  });

  // PYTHON: test_load_skill_missing_section
  it("returns an error for a missing section", () => {
    const { plugin } = makePlugin();
    const result = plugin.loadSkill("code-review", "does-not-exist");
    expect(result).toContain("Error");
  });

  // PYTHON: test_load_skill_not_found
  it("returns an error for a missing skill", () => {
    const { plugin } = makePlugin();
    const result = plugin.loadSkill("missing");
    expect(result).toContain("Error");
  });

  // PYTHON: test_read_skill_resource
  it("reads a skill resource", () => {
    const { plugin } = makePlugin();
    const result = plugin.readSkillResource("code-review", "checklist");
    expect(result).toContain("Error handling");
  });

  // PYTHON: test_run_skill_script_disabled
  it("refuses to run scripts when disabled", async () => {
    const { plugin } = makePlugin();
    const result = await plugin.runSkillScript("code-review", "lint");
    expect(result.toLowerCase()).toContain("disabled");
  });
});
