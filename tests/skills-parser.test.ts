import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { SkillParseError } from "../src/skills/models.js";
import { parseSkillMd } from "../src/skills/parser.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "skills");

describe("SKILL.md parser", () => {
  // PYTHON: test_parse_valid_skill
  it("parses a valid skill with resources and scripts", () => {
    const skill = parseSkillMd(join(FIXTURES, "code-review"));
    expect(skill.name).toBe("code-review");
    expect(skill.frontmatter.description).toContain("Review code");
    expect(skill.content).toContain("Read the code carefully");
    expect(skill.resources).toHaveLength(1);
    expect(skill.resources[0]?.name).toBe("checklist");
    expect(skill.scripts).toHaveLength(1);
    expect(skill.scripts[0]?.name).toBe("lint");
  });

  // PYTHON: test_parse_minimal_skill
  it("parses a minimal skill without extras", () => {
    const skill = parseSkillMd(join(FIXTURES, "commit-messages"));
    expect(skill.name).toBe("commit-messages");
    expect(skill.resources).toEqual([]);
    expect(skill.scripts).toEqual([]);
  });

  // PYTHON: test_name_must_match_directory
  it("requires the skill name to match the directory", () => {
    const skillDir = join(mkdtempSync(join(tmpdir(), "nexus-skill-")), "my-skill");
    mkdirSync(skillDir);
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: wrong-name\ndescription: A test skill for validation.\n---\n\nBody.\n",
    );
    expect(() => parseSkillMd(skillDir)).toThrow(SkillParseError);
    expect(() => parseSkillMd(skillDir)).toThrow(/must match parent directory/);
  });

  // PYTHON: test_invalid_name_uppercase
  it("rejects uppercase skill names", () => {
    const skillDir = join(mkdtempSync(join(tmpdir(), "nexus-skill-")), "Bad-Name");
    mkdirSync(skillDir);
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: Bad-Name\ndescription: A test skill for validation.\n---\n\nBody.\n",
    );
    expect(() => parseSkillMd(skillDir)).toThrow(SkillParseError);
  });

  // PYTHON: test_missing_frontmatter
  it("rejects a SKILL.md without frontmatter", () => {
    const skillDir = join(mkdtempSync(join(tmpdir(), "nexus-skill-")), "no-frontmatter");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "SKILL.md"), "# Just markdown\n");
    expect(() => parseSkillMd(skillDir)).toThrow(SkillParseError);
    expect(() => parseSkillMd(skillDir)).toThrow(/frontmatter/);
  });
});
