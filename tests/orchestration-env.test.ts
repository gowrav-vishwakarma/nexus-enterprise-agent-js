import { describe, expect, it } from "vitest";
import { interpolateEnv } from "../src/orchestration/env.js";

describe("interpolateEnv", () => {
  it("replaces ${ENV:NAME} from process.env", () => {
    process.env.NEXUS_TEST_KEY = "from-env";
    expect(interpolateEnv("key=${ENV:NEXUS_TEST_KEY}")).toBe("key=from-env");
  });

  it("uses a default when the variable is missing", () => {
    delete process.env.NEXUS_TEST_MISSING;
    expect(interpolateEnv("${ENV:NEXUS_TEST_MISSING|fallback}")).toBe("fallback");
  });

  it("walks objects and arrays", () => {
    process.env.NEXUS_TEST_MODEL = "gpt-test";
    const out = interpolateEnv({
      llm: { model: "${ENV:NEXUS_TEST_MODEL|gpt-4o}", extra: ["${ENV:NEXUS_TEST_MODEL}"] },
    });
    expect(out).toEqual({
      llm: { model: "gpt-test", extra: ["gpt-test"] },
    });
  });

  it("leaves strings without the marker alone", () => {
    expect(interpolateEnv("plain")).toBe("plain");
  });
});
