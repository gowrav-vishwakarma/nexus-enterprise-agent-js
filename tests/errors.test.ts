import { describe, expect, it } from "vitest";
import {
  GuardrailError,
  LLMError,
  NexusError,
  ToolError,
  TurnTimeoutError,
  ValidationError,
} from "../src/errors.js";

describe("error taxonomy", () => {
  it("nests typed errors under NexusError", () => {
    expect(new LLMError("boom")).toBeInstanceOf(NexusError);
    expect(new ToolError("fail", { toolName: "echo" })).toBeInstanceOf(NexusError);
    expect(new GuardrailError("blocked")).toBeInstanceOf(NexusError);
    expect(new TurnTimeoutError("slow")).toBeInstanceOf(NexusError);
    expect(new ValidationError("bad json")).toBeInstanceOf(NexusError);
  });

  it("exposes stable codes", () => {
    expect(new LLMError("x").code).toBe("llm_provider");
    expect(new ToolError("x").code).toBe("tool_execution");
    expect(new GuardrailError("x").code).toBe("guardrail_blocked");
    expect(new TurnTimeoutError("x").code).toBe("turn_timeout");
    expect(new ValidationError("x").code).toBe("validation");
  });

  it("keeps the tool name on ToolError", () => {
    const err = new ToolError("missing", { toolName: "web_search" });
    expect(err.toolName).toBe("web_search");
  });
});
