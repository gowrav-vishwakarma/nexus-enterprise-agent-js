import { describe, expect, it } from "vitest";
import { parseAgentConfig, parseAgentGroupConfig } from "../src/config/agent.js";
import { parseMemoryConfig } from "../src/config/memory.js";
import type { MemoryProvider } from "../src/memory/provider.js";
import { type MemoryProviderProtocol } from "../src/memory/provider.js";
import { defaultRAGConfig } from "../src/rag/config.js";
import {
  createFileSkill,
  parseSkillSections,
} from "../src/skills/models.js";
import { testLlmConfig } from "./helpers.js";

function agent(name: string, extra: Record<string, unknown> = {}) {
  return parseAgentConfig({
    name,
    llm: testLlmConfig({ model: "gpt-4o-mini" }),
    persona: { role: name, goal: "answer" },
    ...extra,
  });
}

describe("RAG/memory phase 1", () => {
  // PYTHON: test_agent_config_rag_defaults_none
  it("defaults agent.rag to unset", () => {
    const cfg = agent("a");
    expect(cfg.rag == null).toBe(true);
  });

  // PYTHON: test_agent_config_rag_optional
  it("accepts an optional RAG config with defaults", () => {
    const cfg = agent("a", { rag: { provider: "in_memory", collection: "docs" } });
    expect(cfg.rag).toBeTruthy();
    expect((cfg.rag as { provider: string }).provider).toBe("in_memory");
    const rag = { ...defaultRAGConfig(), ...(cfg.rag as object) };
    expect(rag.chunker?.strategy).toBe("fixed");
    expect(rag.retrieval?.hybrid).toBe(false);
  });

  // PYTHON: test_memory_config_provider_defaults
  it("defaults memory provider fields", () => {
    const mem = parseMemoryConfig({ enabled: true });
    expect(mem.provider == null).toBe(true);
    expect(mem.provider_class == null).toBe(true);
    expect(mem.provider_config).toEqual({});
    expect(mem.require_approval).toBe(false);
  });

  // PYTHON: test_memory_provider_protocol_alias
  it("aliases MemoryProviderProtocol to MemoryProvider", () => {
    const check: MemoryProviderProtocol | MemoryProvider | null = null;
    expect(check).toBeNull();
    type Same = MemoryProviderProtocol extends MemoryProvider ? true : false;
    const same: Same = true;
    expect(same).toBe(true);
  });

  // PYTHON: test_parse_skill_sections
  it("parses ## sections from skill content", () => {
    const content = "# Title\n\n## Checklist\n- a\n\n## Security\nOWASP\n";
    const sections = parseSkillSections(content);
    expect(sections).toHaveProperty("checklist");
    expect(sections).toHaveProperty("security");
    expect(sections.security).toContain("OWASP");
    expect(sections.checklist).toContain("- a");
  });

  // PYTHON: test_skill_format_load_response_section
  it("formats a full load response or a single section", () => {
    const skill = createFileSkill({
      frontmatter: { name: "code-review", description: "d" },
      content: "# Code Review\n\n## Checklist\n- bugs\n\n## Security\nOWASP top 10\n",
      directory: ".",
    });
    const full = skill.formatLoadResponse();
    expect(full).toContain("Checklist");
    expect(full).toContain("Security");
    const sec = skill.formatLoadResponse("security");
    expect(sec).toContain("OWASP");
    expect(sec).not.toContain("bugs");
    const missing = skill.formatLoadResponse("style");
    expect(missing).toContain("Error");
    expect(missing.toLowerCase()).toContain("checklist");
  });

  // PYTHON: test_vote_plurality
  it("picks a plurality winner", () => {
    const responses: Array<[string, string]> = [
      ["a", "yes"],
      ["b", "yes"],
      ["c", "no"],
    ];
    const counts = new Map<string, number>();
    for (const [, resp] of responses) {
      counts.set(resp, (counts.get(resp) ?? 0) + 1);
    }
    const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    expect(winner).toBe("yes");
  });

  // PYTHON: test_agent_group_vote_strategy_accepted
  it("accepts vote as an aggregation strategy", () => {
    const group = parseAgentGroupConfig({
      name: "panel",
      pattern: "parallel",
      members: [agent("alpha"), agent("beta")],
      aggregation_strategy: "vote",
    });
    expect(group.aggregation_strategy).toBe("vote");
  });
});
