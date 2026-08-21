import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { isPathWithinDirectory, validateResourcePath } from "../src/skills/security.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "skills");

describe("skill security", () => {
  // PYTHON: test_is_path_within_directory
  it("accepts a resource inside the skill directory", () => {
    const skillDir = join(FIXTURES, "code-review");
    const resource = join(skillDir, "references", "checklist.md");
    expect(isPathWithinDirectory(resource, skillDir)).toBe(true);
  });

  // PYTHON: test_path_traversal_blocked
  it("blocks path traversal out of the skill directory", () => {
    const skillDir = join(mkdtempSync(join(tmpdir(), "nexus-skill-sec-")), "skill");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "safe.txt"), "ok");
    expect(() => validateResourcePath(skillDir, "../outside.txt")).toThrow(/escapes|Symlink/i);
  });

  // PYTHON: test_symlink_escape_blocked
  it("blocks a symlink that escapes the skill directory", () => {
    const root = mkdtempSync(join(tmpdir(), "nexus-skill-link-"));
    const skillDir = join(root, "skill");
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "secret");
    mkdirSync(skillDir);
    symlinkSync(root, join(skillDir, "references"));
    expect(() => validateResourcePath(skillDir, "references/outside.txt")).toThrow(/Symlink/);
  });
});
