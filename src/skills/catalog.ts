/** Build skill catalog blocks for system prompt injection. */

import type { FileSkill } from "./models.js";

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSkillsCatalog(skills: FileSkill[]): string {
  if (!skills.length) return "";
  const lines = [
    "## Available Skills",
    "",
    "The following skills are available. Use the `skills.load_skill` tool to load ",
    "full instructions when a task matches a skill's description. Use ",
    "`skills.read_skill_resource` to read supplementary files on demand.",
    "",
    "<skills>",
  ];
  for (const skill of skills) {
    const name = xmlEscape(skill.frontmatter.name);
    const desc = xmlEscape(skill.frontmatter.description);
    lines.push(`  <skill name="${name}" description="${desc}" />`);
  }
  lines.push("</skills>");
  return lines.join("\n");
}

export function buildExplicitSkillsBlock(skills: FileSkill[]): string {
  if (!skills.length) return "";
  const lines = ["## Active Skills", ""];
  for (const skill of skills) {
    lines.push(skill.formatExplicitBlock());
  }
  return lines.join("\n");
}
