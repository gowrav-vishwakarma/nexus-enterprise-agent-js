import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM_TEMPLATE } from "../src/config/defaults.js";
import { renderSystemPrompt } from "../src/utils/jinja.js";

describe("renderSystemPrompt", () => {
  it("renders the default template without user memory", () => {
    const text = renderSystemPrompt({
      persona: { role: "Researcher", goal: "Answer questions" },
      template: DEFAULT_SYSTEM_TEMPLATE,
      currentDate: "2026-08-21",
    });
    expect(text).toContain("You are Researcher.");
    expect(text).toContain("Goal: Answer questions");
    expect(text).not.toContain("About this user");
  });

  it("iterates user memory via Jinja items()", () => {
    const text = renderSystemPrompt({
      persona: { role: "Assistant", goal: "Help" },
      template: DEFAULT_SYSTEM_TEMPLATE,
      userMemory: { name: "Ada" },
      currentDate: "2026-08-21",
    });
    expect(text).toContain("- name: Ada");
  });
});
