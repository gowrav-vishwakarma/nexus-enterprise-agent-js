import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ContextWindowBuilder } from "../src/context/builder.js";
import { AgentSession } from "../src/session/models.js";
import { buildExplicitSkillsBlock, buildSkillsCatalog } from "../src/skills/catalog.js";
import { defaultSkillsConfig } from "../src/skills/config.js";
import { createSkillsPlugin } from "../src/skills/plugin.js";
import { SkillsRegistry } from "../src/skills/registry.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { testAgentConfig } from "./helpers.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "skills");

function skillsConfig(overrides: Record<string, unknown> = {}) {
  return {
    ...defaultSkillsConfig(),
    enabled: true,
    globalPaths: [FIXTURES],
    ...overrides,
  };
}

describe("skills integration", () => {
  // PYTHON: test_runner_injects_skills_catalog
  it("injects the skills catalog into the system prompt", async () => {
    const registry = new SkillsRegistry(skillsConfig({ activationMode: "auto" }));
    const catalog = buildSkillsCatalog(registry.listSkills());
    const messages = await new ContextWindowBuilder().build({
      session: new AgentSession({ sessionId: "skills-sess-1", agentId: "skills-agent" }),
      agentConfig: testAgentConfig({ name: "skills-agent", skills: skillsConfig({ activationMode: "auto" }) }),
      currentUserMessage: "Hello",
      skillsCatalog: catalog,
    });
    const systemMsg = messages[0];
    expect(systemMsg?.role).toBe("system");
    expect(systemMsg?.content).toContain("code-review");
    expect(systemMsg?.content).toContain("commit-messages");
    expect(systemMsg?.content).toContain("skills.load_skill");
  });

  // PYTHON: test_runner_explicit_skills_injected
  it("injects explicit skill bodies and omits the catalog", async () => {
    const config = skillsConfig({ activationMode: "explicit", explicitSkills: ["code-review"] });
    const registry = new SkillsRegistry(config);
    const explicit = buildExplicitSkillsBlock(registry.resolveExplicitSkills());
    const messages = await new ContextWindowBuilder().build({
      session: new AgentSession({ sessionId: "skills-sess-2", agentId: "skills-agent" }),
      agentConfig: testAgentConfig({ name: "skills-agent", skills: config }),
      currentUserMessage: "Hello",
      explicitSkillsContent: explicit,
    });
    const systemMsg = messages[0];
    expect(systemMsg?.content).toContain("Active Skills");
    expect(systemMsg?.content).toContain("Read the code carefully");
    expect(systemMsg?.content).not.toContain("<skills>");
  });

  // PYTHON: test_runner_exposes_skills_tools
  it("exposes load and read tools (script runner stays registered but disabled)", () => {
    const config = skillsConfig({ activationMode: "auto" });
    const registry = new SkillsRegistry(config);
    const tools = new ToolRegistry();
    tools.registerPlugin(createSkillsPlugin(registry, config));
    const names = new Set(tools.toolNames());
    expect(names.has("skills.load_skill")).toBe(true);
    expect(names.has("skills.read_skill_resource")).toBe(true);
    // JS always registers run_skill_script; the plugin itself returns "disabled".
    expect(names.has("skills.run_skill_script")).toBe(true);
  });
});
