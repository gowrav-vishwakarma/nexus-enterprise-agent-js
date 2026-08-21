import { describe, expect, it } from "vitest";
import { parseAgentConfig } from "../src/config/agent.js";
import { parseContextSummaryConfig } from "../src/config/context-summary.js";
import { parseMemoryConfig } from "../src/config/memory.js";
import { ContextWindowBuilder } from "../src/context/builder.js";
import { MemoryPromptInjector } from "../src/context/memory-injector.js";
import { ContextSummarizer } from "../src/context/summarizer.js";
import { SummaryPromptInjector } from "../src/context/summary-injector.js";
import { MockLLMAdapter } from "../src/eval/mock-llm.js";
import { LLMProxy } from "../src/llm/proxy.js";
import { SessionManager } from "../src/session/manager.js";
import { AgentSession, TurnRecord } from "../src/session/models.js";
import { testLlmConfig } from "./helpers.js";

describe("context summary", () => {
  // PYTHON: test_memory_injector_appends_when_template_lacks_block
  it("appends a user-memory block when the template lacks one", () => {
    const cfg = parseMemoryConfig({ enabled: true, inject_into_prompt: true });
    const out = MemoryPromptInjector.inject("You are a helper.", { lang: "Spanish" }, cfg);
    expect(out).toContain("About this user");
    expect(out).toContain("Spanish");
  });

  // PYTHON: test_memory_injector_skips_when_block_already_present
  it("skips injection when the memory block is already present", () => {
    const cfg = parseMemoryConfig({ enabled: true, inject_into_prompt: true });
    const existing = "## About this user\n- lang: Spanish";
    expect(MemoryPromptInjector.inject(existing, { lang: "French" }, cfg)).toBe(existing);
  });

  // PYTHON: test_summary_injector_appends_when_template_lacks_block
  it("appends a conversation-summary block when the template lacks one", () => {
    const cfg = parseContextSummaryConfig({ summarize_on: 0.8, inject_into_prompt: true });
    const out = SummaryPromptInjector.inject("You are a helper.", "User asked about Q4.", cfg);
    expect(out).toContain("Conversation Summary");
    expect(out).toContain("Q4");
  });

  // PYTHON: test_context_summarizer_folds_oldest_turns
  it("folds the oldest turns into summary_text", async () => {
    const manager = new SessionManager();
    await manager.createSession("a", "sum-sess");
    await manager.appendTurn(
      "sum-sess",
      new TurnRecord({
        turnIndex: 0,
        userMessage: "First question",
        llmMessages: [{ role: "assistant", content: "First answer" }],
      }),
    );
    await manager.appendTurn(
      "sum-sess",
      new TurnRecord({
        turnIndex: 1,
        userMessage: "Second question",
        llmMessages: [{ role: "assistant", content: "Second answer" }],
      }),
    );
    const session = (await manager.loadSession("sum-sess"))!;
    const adapter = new MockLLMAdapter(testLlmConfig(), [
      { content: "Discussed first and second topics." },
    ]);
    const summarizer = new ContextSummarizer(
      parseContextSummaryConfig({ summarize_on: 0.5, turns_to_fold: 1 }),
      new LLMProxy(testLlmConfig(), adapter),
      manager,
    );
    await summarizer.summarize(session, 1);
    expect(session.summaryText.toLowerCase()).toContain("first and second");
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]!.turnIndex).toBe(1);
    expect(session.summaryThroughTurn).toBe(0);
  });

  // PYTHON: test_should_trigger_respects_ratio_and_disabled
  it("triggers only when the ratio is high and summarization is enabled", () => {
    const session = new AgentSession({
      sessionId: "s",
      agentId: "a",
      turns: [
        new TurnRecord({
          turnIndex: 0,
          userMessage: "Hi",
          llmMessages: [{ role: "assistant", content: "Hello" }],
        }),
      ],
    });
    const llm = new LLMProxy(testLlmConfig(), new MockLLMAdapter(testLlmConfig(), [{ content: "x" }]));
    const active = new ContextSummarizer(
      parseContextSummaryConfig({ summarize_on: 0.8 }),
      llm,
      { saveSession: async () => undefined },
    );
    const disabled = new ContextSummarizer(
      parseContextSummaryConfig({ summarize_on: null }),
      llm,
      { saveSession: async () => undefined },
    );
    expect(active.shouldTrigger(session, 9000, 10000)).toBe(true);
    expect(active.shouldTrigger(session, 5000, 10000)).toBe(false);
    expect(disabled.shouldTrigger(session, 9000, 10000)).toBe(false);
  });

  // PYTHON: test_summary_text_in_system_prompt_via_builder
  it("injects summary_text into the system prompt via the builder", async () => {
    const session = new AgentSession({
      sessionId: "s",
      agentId: "a",
      summaryText: "Prior discussion about revenue.",
    });
    const agent = parseAgentConfig({
      name: "a",
      llm: { provider: "openai", model: "gpt-4o", api_key: "sk" },
      context_summary: { summarize_on: 0.8, inject_into_prompt: true },
    });
    const messages = await new ContextWindowBuilder().build({
      session,
      agentConfig: agent,
      currentUserMessage: "Continue",
      summaryText: session.summaryText,
    });
    expect(String(messages[0]!.content)).toContain("Conversation Summary");
    expect(String(messages[0]!.content)).toContain("revenue");
  });
});
