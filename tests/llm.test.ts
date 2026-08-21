/** Ports of Python tests/test_llm.py — TokenCounter. */

import { describe, expect, it } from "vitest";
import { TokenCounter } from "../src/llm/token-counter.js";

describe("TokenCounter", () => {
  // PYTHON: test_token_counter_string
  it("counts tokens in raw strings", () => {
    expect(TokenCounter.countString("")).toBe(0);
    const tokens = TokenCounter.countString("Hello world! This is a simple test.", "gpt-4o");
    expect(tokens).toBeGreaterThan(0);
  });

  // PYTHON: test_token_counter_messages
  it("counts message tokens with overheads", () => {
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello!" },
    ];
    const tokens = TokenCounter.countMessages(messages, "gpt-4o");
    expect(tokens).toBeGreaterThan(0);

    messages.push({ role: "assistant", content: "Hi there!" });
    const tokensAfter = TokenCounter.countMessages(messages, "gpt-4o");
    expect(tokensAfter).toBeGreaterThan(tokens);
  });

  // PYTHON: test_token_counter_fallback
  it("returns a positive integer for an unknown model name", () => {
    const count = TokenCounter.countString("a".repeat(40), "unsupported-model");
    expect(count).toBeGreaterThan(0);
  });
});
