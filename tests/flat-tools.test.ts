/** Ports of Python tests/test_flat_tools.py — flat registration and RunContext injection. */

import { describe, expect, it } from "vitest";
import { createRunContext, type RunContext } from "../src/tools/context.js";
import { defineTool } from "../src/tools/decorators.js";
import { ToolRegistry } from "../src/tools/registry.js";

const executeSql = defineTool((sql: string) => `ok:${sql.length}`, {
  name: "execute_sql",
  description: "Run SQL",
  parameters: {
    type: "object",
    properties: { sql: { type: "string" } },
    required: ["sql"],
  },
});

const askClarification = defineTool(
  (question: string, options: object[], ctx?: RunContext) =>
    `q=${question};n=${options.length};sid=${ctx?.sessionId ?? null}`,
  {
    name: "ask_clarification",
    description: "Ask the user a clarifying question",
    execution: "client",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: { type: "array" },
      },
      required: ["question", "options"],
    },
  },
);

const toolPep604RunContext = defineTool(
  (label: string, run_context?: RunContext | null) =>
    `${label}:${run_context?.sessionId ?? null}`,
  {
    name: "tool_pep604_run_context",
    description: "PEP 604 RunContext union",
    parameters: {
      type: "object",
      properties: { label: { type: "string" } },
      required: ["label"],
    },
  },
);

const toolBareRunContextName = defineTool(
  (label: string, run_context?: RunContext | null) =>
    `${label}:${run_context?.sessionId ?? null}`,
  {
    name: "tool_bare_run_context_name",
    description: "run_context by name only",
    parameters: {
      type: "object",
      properties: { label: { type: "string" } },
      required: ["label"],
    },
  },
);

function schemaProps(reg: ToolRegistry): Record<string, unknown> {
  const schemas = reg.getToolSchemasForLlm();
  return ((schemas[0]?.parameters as { properties?: Record<string, unknown> })?.properties ??
    {}) as Record<string, unknown>;
}

describe("flat tools", () => {
  // PYTHON: test_flat_register_tool
  it("registers a tool with an empty plugin prefix", () => {
    const reg = new ToolRegistry();
    reg.registerTool(executeSql, "");
    expect(reg.has("execute_sql")).toBe(true);
    const names = new Set(reg.getToolSchemasForLlm().map((s) => s.name));
    expect(names.has("execute_sql")).toBe(true);
    expect(reg.getToolMetadata("execute_sql").plugin).toBe("");
  });

  // PYTHON: test_flat_tool_survives_plugin_filter
  it("keeps flat tools when a plugin allow-list is applied", () => {
    const reg = new ToolRegistry();
    reg.registerTool(executeSql, "");
    const names = new Set(reg.getToolSchemasForLlm(["other_plugin"]).map((s) => s.name));
    expect(names.has("execute_sql")).toBe(true);
  });

  // PYTHON: test_optional_run_context_and_kwargs_excluded_from_schema
  it("excludes Optional RunContext and rest kwargs from the LLM schema", () => {
    const reg = new ToolRegistry();
    reg.registerTool(askClarification, "");
    const props = schemaProps(reg);
    expect(Object.keys(props).sort()).toEqual(["options", "question"]);
    expect(props.ctx).toBeUndefined();
    expect(props.kwargs).toBeUndefined();
    expect(reg.getToolSchemasForLlm()[0]!.name).toBe("ask_clarification");
    expect(reg.getExecutionMode("ask_clarification")).toBe("client");
  });

  // PYTHON: test_optional_run_context_injected_on_execute
  it("injects Optional RunContext on execute", async () => {
    const reg = new ToolRegistry();
    reg.registerTool(askClarification, "");
    const result = await reg.execute(
      "ask_clarification",
      "",
      {
        question: "Which report?",
        options: [
          { label: "A", value: "a" },
          { label: "B", value: "b" },
        ],
      },
      createRunContext({ sessionId: "sess-1" }),
    );
    expect(result).toBe("q=Which report?;n=2;sid=sess-1");
  });

  // PYTHON: test_pep604_run_context_excluded_from_schema
  it("excludes a run_context union parameter from the schema", () => {
    const reg = new ToolRegistry();
    reg.registerTool(toolPep604RunContext, "");
    const props = schemaProps(reg);
    expect(Object.keys(props)).toEqual(["label"]);
    expect(props.run_context).toBeUndefined();
  });

  // PYTHON: test_pep604_run_context_injected_on_execute
  it("injects a run_context union parameter on execute", async () => {
    const reg = new ToolRegistry();
    reg.registerTool(toolPep604RunContext, "");
    const result = await reg.execute(
      "tool_pep604_run_context",
      "",
      { label: "x" },
      createRunContext({ sessionId: "pep604-sess" }),
    );
    expect(result).toBe("x:pep604-sess");
  });

  // PYTHON: test_bare_run_context_name_excluded_from_schema
  it("excludes a bare run_context parameter from the schema", () => {
    const reg = new ToolRegistry();
    reg.registerTool(toolBareRunContextName, "");
    const props = schemaProps(reg);
    expect(Object.keys(props)).toEqual(["label"]);
    expect(props.run_context).toBeUndefined();
  });

  // PYTHON: test_bare_run_context_name_injected_on_execute
  it("injects a bare run_context parameter on execute", async () => {
    const reg = new ToolRegistry();
    reg.registerTool(toolBareRunContextName, "");
    const result = await reg.execute(
      "tool_bare_run_context_name",
      "",
      { label: "y" },
      createRunContext({ sessionId: "bare-sess" }),
    );
    expect(result).toBe("y:bare-sess");
  });
});
