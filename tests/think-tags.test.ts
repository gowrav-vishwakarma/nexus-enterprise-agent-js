import { describe, expect, it } from "vitest";
import { ThinkTagSplitter, splitThinkTags } from "../src/llm/think-tags.js";

describe("splitThinkTags", () => {
  it("pulls a closed think block out of the answer", () => {
    expect(splitThinkTags("<think>plan</think>hello")).toEqual({
      content: "hello",
      reasoning: "plan",
    });
  });

  it("leaves plain text alone", () => {
    expect(splitThinkTags("just an answer")).toEqual({
      content: "just an answer",
      reasoning: "",
    });
  });
});

describe("ThinkTagSplitter", () => {
  it("splits tags that arrive across chunks", () => {
    const s = new ThinkTagSplitter();
    expect(s.push("<th")).toEqual([]);
    expect(s.push("ink>why")).toEqual([{ reasoning: "why" }]);
    expect(s.push(" now</th")).toEqual([{ reasoning: " now" }]);
    expect(s.push("ink>ok")).toEqual([{ content: "ok" }]);
    expect(s.end()).toEqual([]);
  });
});
