import { describe, expect, it } from "vitest";
import { parseRuntimeContextSummarizerConfig } from "../src/config/rcs.js";
import { defineTool, defineToolPlugin } from "../src/tools/decorators.js";
import { createRunContext } from "../src/tools/context.js";
import { ToolRegistry } from "../src/tools/registry.js";

const addNumbers = defineTool((a: number, b: number) => a + b, {
  name: "add_numbers",
  description: "Adds two numbers.",
});

const getSessionInfo = defineTool(
  (ctx: { sessionId?: string | null }) => ctx.sessionId || "no-session",
  { name: "get_session_info" },
);

class MathPlugin {
  multiply = defineTool((x: number, y: number) => x * y, {
    name: "multiply",
    description: "Multiply two floats.",
  });

  divide = defineTool(
    async (x: number, y: number) => {
      if (y === 0) throw new Error("division by zero");
      return x / y;
    },
    {
      name: "divide",
      description: "Divide two floats asynchronously.",
      requiresApproval: true,
      timeoutSeconds: 30,
    },
  );
}
defineToolPlugin("math_plugin")(MathPlugin);

describe("ToolRegistry", () => {
  it("registers and executes a standalone tool", async () => {
    const registry = new ToolRegistry();
    registry.registerTool(addNumbers);
    const res = await registry.execute("global", "add_numbers", { a: 5, b: 10 }, createRunContext());
    expect(res).toBe(15);
  });

  it("registers plugin methods under a namespace", async () => {
    const registry = new ToolRegistry();
    registry.registerPlugin(new MathPlugin());
    expect(registry.has("math_plugin.multiply")).toBe(true);
    expect(registry.has("math_plugin.divide")).toBe(true);
    const product = await registry.execute(
      "math_plugin",
      "multiply",
      { x: 3, y: 4 },
      createRunContext(),
    );
    expect(product).toBe(12);
    const quotient = await registry.execute(
      "math_plugin",
      "divide",
      { x: 10, y: 2 },
      createRunContext(),
    );
    expect(quotient).toBe(5);
  });

  it("injects RunContext when the parameter is named ctx", async () => {
    const registry = new ToolRegistry();
    registry.registerTool(getSessionInfo);
    const ctx = createRunContext({ sessionId: "test_session_xyz" });
    const res = await registry.execute("global", "get_session_info", {}, ctx);
    expect(res).toBe("test_session_xyz");
  });

  it("keeps a trailing ctx aligned when an optional argument is omitted", async () => {
    const registry = new ToolRegistry();
    registry.registerTool(
      defineTool(
        (key: string, store: string | undefined, ctx?: { sessionId?: string | null }) =>
          `${key}:${store ?? "default"}:${ctx?.sessionId ?? "no-session"}`,
        { name: "scoped_write" },
      ),
    );
    const rc = createRunContext({ sessionId: "s1" });
    expect(await registry.execute("global", "scoped_write", { key: "k" }, rc)).toBe(
      "k:default:s1",
    );
    expect(
      await registry.execute("global", "scoped_write", { key: "k", store: "notes" }, rc),
    ).toBe("k:notes:s1");
  });

  it("injects RCS schema when enabled", () => {
    const registry = new ToolRegistry();
    registry.registerTool(addNumbers);
    const disabled = registry.getToolSchemasForLlm(
      null,
      parseRuntimeContextSummarizerConfig({ enabled: false }),
    );
    const enabled = registry.getToolSchemasForLlm(
      null,
      parseRuntimeContextSummarizerConfig({ enabled: true }),
    );
    const disabledProps = (disabled[0]?.parameters as { properties?: Record<string, unknown> })
      ?.properties;
    const enabledProps = (enabled[0]?.parameters as { properties?: Record<string, unknown> })
      ?.properties;
    expect(disabledProps?._context_updates).toBeUndefined();
    expect(enabledProps?._context_updates).toBeDefined();
  });

  // PYTHON: test_standalone_tool_registration (metadata)
  it("exposes approval metadata on a standalone tool", () => {
    const registry = new ToolRegistry();
    registry.registerTool(addNumbers);
    const metadata = registry.getToolMetadata("global.add_numbers");
    expect(metadata.name).toBe("add_numbers");
    expect(metadata.description).toBe("Adds two numbers.");
    expect(metadata.requires_approval).toBe(false);
    expect(registry.requiresApproval("global.add_numbers")).toBe(false);
  });

  // PYTHON: test_plugin_registration (approval + timeout)
  it("records plugin approval and timeout metadata", () => {
    const registry = new ToolRegistry();
    registry.registerPlugin(new MathPlugin());
    expect(registry.requiresApproval("math_plugin.divide")).toBe(true);
    expect(registry.requiresApproval("math_plugin.multiply")).toBe(false);
    expect(registry.getTimeoutSeconds("math_plugin.divide")).toBe(30);
    expect(registry.getTimeoutSeconds("math_plugin.multiply")).toBeNull();
  });

  // PYTHON: test_rcs_schema_injection (custom param name)
  it("injects a custom RCS parameter name", () => {
    const registry = new ToolRegistry();
    registry.registerTool(addNumbers);
    const enabled = registry.getToolSchemasForLlm(
      null,
      parseRuntimeContextSummarizerConfig({
        enabled: true,
        context_updates_param_name: "_my_updates",
      }),
    );
    const properties = (enabled[0]?.parameters as { properties?: Record<string, unknown> })
      ?.properties;
    expect(properties?._my_updates).toBeDefined();
    expect((properties?._my_updates as { type?: string })?.type).toBe("array");
    expect(properties?._context_updates).toBeUndefined();
  });
});
