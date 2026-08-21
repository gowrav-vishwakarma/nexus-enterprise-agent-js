import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSkillsConfig } from "../src/skills/config.js";

describe("SkillsConfig", () => {
  const previous = process.env.NEXUS_SKILLS_ROOT;

  afterEach(() => {
    if (previous == null) delete process.env.NEXUS_SKILLS_ROOT;
    else process.env.NEXUS_SKILLS_ROOT = previous;
  });

  // PYTHON: test_global_paths_defaults_to_nexus_skills_root
  it("defaults globalPaths to NEXUS_SKILLS_ROOT", () => {
    const custom = join(mkdtempSync(join(tmpdir(), "nexus-skills-root-")), "custom-skills");
    process.env.NEXUS_SKILLS_ROOT = custom;
    const config = defaultSkillsConfig();
    expect(config.globalPaths).toEqual([custom]);
  });
});
