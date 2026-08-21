/** Data models for Agent Skills (agentskills.io compatible). */

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string | null;
  compatibility?: string | null;
  allowedTools?: string | null;
  metadata?: Record<string, string>;
}

export interface SkillResource {
  name: string;
  relativePath: string;
  category: "references" | "assets" | "root";
}

export interface SkillScript {
  name: string;
  relativePath: string;
  fullPath: string;
}

export type SkillScope = "global" | "tenant" | "user";

export interface FileSkill {
  frontmatter: SkillFrontmatter;
  content: string;
  directory: string;
  resources: SkillResource[];
  scripts: SkillScript[];
  scope: SkillScope;
  name: string;
  sectionNames(): string[];
  formatLoadResponse(section?: string): string;
  formatExplicitBlock(): string;
}

export function parseSkillSections(content: string): Record<string, string> {
  if (!content) return {};
  const lines = content.split("\n");
  const sections: Record<string, string[]> = {};
  let current = "_preamble";
  sections[current] = [];
  for (const line of lines) {
    const stripped = line.trim();
    if (stripped.startsWith("## ") && !stripped.startsWith("###")) {
      current = stripped.slice(3).trim().toLowerCase();
      sections[current] = sections[current] ?? [];
      sections[current]!.push(line);
      continue;
    }
    sections[current] = sections[current] ?? [];
    sections[current]!.push(line);
  }
  const out: Record<string, string> = {};
  for (const [key, body] of Object.entries(sections)) {
    const text = body.join("\n").trim();
    if (text && key !== "_preamble") out[key] = text;
  }
  return out;
}

export function lookupSkillSection(
  sections: Record<string, string>,
  name: string,
): string | null {
  const needle = name.trim().toLowerCase();
  if (needle in sections) return sections[needle] ?? null;
  const slug = needle.replace(/ /g, "-");
  for (const [key, value] of Object.entries(sections)) {
    if (key.replace(/ /g, "-") === slug) return value;
  }
  return null;
}

export function createFileSkill(init: {
  frontmatter: SkillFrontmatter;
  content: string;
  directory: string;
  resources?: SkillResource[];
  scripts?: SkillScript[];
  scope?: SkillScope;
}): FileSkill {
  const skill: FileSkill = {
    frontmatter: init.frontmatter,
    content: init.content,
    directory: init.directory,
    resources: init.resources ?? [],
    scripts: init.scripts ?? [],
    scope: init.scope ?? "global",
    name: init.frontmatter.name,
    sectionNames() {
      return Object.keys(parseSkillSections(this.content));
    },
    formatLoadResponse(section = "all") {
      const requested = (section || "all").trim() || "all";
      if (requested.toLowerCase() !== "all") {
        const sections = parseSkillSections(this.content);
        const body = lookupSkillSection(sections, requested);
        if (body == null) {
          const available = Object.keys(sections).join(", ") || "(no ## headings)";
          return `Error: section '${requested}' not found in skill '${this.frontmatter.name}'. Available: ${available}`;
        }
        return [
          `# Skill: ${this.frontmatter.name} (section: ${requested})`,
          "",
          body.trim(),
          "",
        ].join("\n");
      }
      const lines = [`# Skill: ${this.frontmatter.name}`, "", this.content.trim(), ""];
      const sectionNames = this.sectionNames();
      if (sectionNames.length) {
        lines.push("## Sections (request with load_skill section=...)");
        for (const n of sectionNames) lines.push(`- ${n}`);
        lines.push("");
      }
      if (this.resources.length) {
        lines.push("## Available Resources");
        for (const res of this.resources) {
          lines.push(`- ${res.name} (${res.category}/${res.relativePath})`);
        }
        lines.push("");
      }
      if (this.scripts.length) {
        lines.push("## Available Scripts");
        for (const script of this.scripts) {
          lines.push(`- ${script.name} (scripts/${script.relativePath})`);
        }
        lines.push("");
      }
      return lines.join("\n");
    },
    formatExplicitBlock() {
      return `## Skill: ${this.frontmatter.name}\n\n${this.content.trim()}\n`;
    },
  };
  return skill;
}

export class SkillParseError extends Error {}
export class SkillNotFoundError extends Error {}
export class SkillResourceNotFoundError extends Error {}
export class SkillSecurityError extends Error {}
