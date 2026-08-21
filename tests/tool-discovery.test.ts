/** Ports of Python tests/test_tool_discovery.py — toolsets and runtime grants. */

import { describe, expect, it } from "vitest";
import { createRunContext } from "../src/tools/context.js";
import { defineTool } from "../src/tools/decorators.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { makeRunner, runnerInternals, testAgentConfig, testLlmConfig } from "./helpers.js";

const sampleTool = defineTool((x: string) => x, { name: "sample_tool", description: "Sample" });
const otherTool = defineTool((x: string) => x, { name: "other_tool", description: "Other" });

describe("tool discovery and toolsets", () => {
  // PYTHON: test_add_toolset_registers_tool_objects
  it("registers tool objects via addToolset", () => {
    const reg = new ToolRegistry();
    reg.addToolset("pack", [sampleTool, otherTool]);
    expect(reg.has("sample_tool")).toBe(true);
    expect(reg.has("other_tool")).toBe(true);
    expect(reg.resolveToolset("pack")).toEqual(new Set(["sample_tool", "other_tool"]));
  });

  // PYTHON: test_add_tool_flat_name
  it("adds a tool under its flat name", () => {
    const reg = new ToolRegistry();
    const name = reg.addTool(sampleTool);
    expect(name).toBe("sample_tool");
    expect(reg.has("sample_tool")).toBe(true);
  });

  // PYTHON: test_execute_tool_flat_name
  it("executes a tool by flat name", async () => {
    const reg = new ToolRegistry();
    reg.addTool(sampleTool);
    const out = await reg.executeTool("sample_tool", { x: "hi" }, createRunContext());
    expect(out).toBe("hi");
  });

  // PYTHON: test_discover_package_namespaced
  it("registers namespaced tools (closest to discover_package)", () => {
    const discovered = defineTool((x: string) => x, { name: "discovered_one", description: "One" });
    const reg = new ToolRegistry();
    reg.registerTool(discovered, "demo");
    expect(reg.has("demo.discovered_one")).toBe(true);
    expect(reg.count()).toBe(1);
  });

  // PYTHON: test_define_toolset_ok_and_resolve
  it("defines and resolves nested toolsets", () => {
    const reg = new ToolRegistry();
    reg.registerTool(sampleTool, "app");
    reg.registerTool(otherTool, "app");
    reg.defineToolset("leaf", ["app.other_tool"]);
    reg.defineToolset("core", ["app.sample_tool"], { includes: ["leaf"] });

    expect(reg.hasToolset("core")).toBe(true);
    expect(reg.resolveToolset("core")).toEqual(new Set(["app.sample_tool", "app.other_tool"]));
    expect(reg.resolveToolset(["leaf", "app.sample_tool"])).toEqual(
      new Set(["app.other_tool", "app.sample_tool"]),
    );
    expect(reg.resolveToolset(null)).toBeNull();
  });

  // PYTHON: test_define_toolset_missing_tool_raises
  it("throws when a toolset references a missing tool", () => {
    const reg = new ToolRegistry();
    expect(() => reg.defineToolset("core", ["app.missing_tool"])).toThrow("app.missing_tool");
  });

  // PYTHON: test_define_toolset_missing_include_raises
  it("throws when a toolset includes an undefined child", () => {
    const reg = new ToolRegistry();
    reg.registerTool(sampleTool, "app");
    expect(() =>
      reg.defineToolset("core", ["app.sample_tool"], { includes: ["undefined_child"] }),
    ).toThrow("undefined_child");
  });

  // PYTHON: test_runtime_grant_widens_allow_list
  it("widens the allow-list via grantTools / grantToolset", () => {
    const reg = new ToolRegistry();
    reg.registerTool(sampleTool, "app");
    reg.registerTool(otherTool, "app");
    reg.defineToolset("core", ["app.sample_tool"]);
    reg.defineToolset("extra", ["app.other_tool"]);

    const { runner } = makeRunner({
      registry: reg,
      config: testAgentConfig({
        name: "grant_agent",
        llm: testLlmConfig({ model: "gpt-4o-mini" }),
        persona: { role: "Helper", goal: "Help" },
        toolset: "core",
      }),
    });
    const internals = runnerInternals(runner);
    internals.resolveToolsets();
    expect(internals.allowedTools).toEqual(new Set(["app.sample_tool"]));

    runner.grantTools("app.other_tool");
    expect(internals.allowedTools).toEqual(new Set(["app.sample_tool", "app.other_tool"]));

    runner.revokeTools("app.other_tool");
    expect(internals.allowedTools).toEqual(new Set(["app.sample_tool"]));

    runner.grantToolset("extra");
    expect(internals.allowedTools).toEqual(new Set(["app.sample_tool", "app.other_tool"]));
  });

  // PYTHON: test_runtime_grant_noop_when_unrestricted
  it("is a no-op when the runner has no toolset restriction", () => {
    const reg = new ToolRegistry();
    reg.registerTool(sampleTool, "app");
    const { runner } = makeRunner({
      registry: reg,
      config: testAgentConfig({
        name: "grant_agent",
        toolset: null,
      }),
    });
    const internals = runnerInternals(runner);
    internals.resolveToolsets();
    expect(internals.allowedTools).toBeNull();
    runner.grantTools("app.sample_tool");
    expect(internals.allowedTools).toBeNull();
  });
});
