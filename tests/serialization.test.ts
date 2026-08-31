import { describe, expect, it } from "vitest";
import { toolResultToString } from "../src/utils/serialization.js";

describe("toolResultToString", () => {
  it("leaves strings unchanged", () => {
    expect(toolResultToString("already text")).toBe("already text");
  });

  it("serializes objects as JSON so the model does not see [object Object]", () => {
    expect(toolResultToString({ matches: [{ key: "region", value: "Gujarat" }] })).toBe(
      '{"matches":[{"key":"region","value":"Gujarat"}]}',
    );
  });

  it("treats null and undefined as empty", () => {
    expect(toolResultToString(null)).toBe("");
    expect(toolResultToString(undefined)).toBe("");
  });
});
