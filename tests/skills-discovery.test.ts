import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { discoverSkillsFromPaths, discoverSkillsInPath } from "../src/skills/discovery.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "skills");

describe("skill discovery", () => {
  // PYTHON: test_discover_skills_in_path
  it("discovers skills in a directory", () => {
    const skills = discoverSkillsInPath(FIXTURES);
    expect(new Set(skills.map((s) => s.name))).toEqual(new Set(["code-review", "commit-messages"]));
  });

  // PYTHON: test_discover_empty_directory
  it("returns [] for an empty directory", () => {
    const empty = mkdtempSync(join(tmpdir(), "nexus-empty-skills-"));
    mkdirSync(empty, { recursive: true });
    expect(discoverSkillsInPath(empty)).toEqual([]);
  });

  // PYTHON: test_discover_nonexistent_path
  it("returns [] for a missing path", () => {
    const root = mkdtempSync(join(tmpdir(), "nexus-missing-skills-"));
    expect(discoverSkillsInPath(join(root, "missing"))).toEqual([]);
  });

  // PYTHON: test_discover_from_multiple_paths
  it("discovers from a list of paths", () => {
    const skills = discoverSkillsFromPaths([FIXTURES]);
    expect(skills).toHaveLength(2);
  });
});
