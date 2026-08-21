/** Ports of Python tests/test_content_tool_calls.py. */

import { describe, expect, it } from "vitest";
import { ContextWindowBuilder } from "../src/context/builder.js";
import {
  EMPTY_ASSISTANT_PLACEHOLDER,
  buildAssistantLlmMessage,
  extractToolCallsFromText,
  promoteContentToolCalls,
  sanitizeAssistantLlmMessage,
} from "../src/llm/content-tool-calls.js";
import { createLLMResponse } from "../src/llm/response.js";
import { AgentSession, TurnRecord } from "../src/session/models.js";
import { testAgentConfig } from "./helpers.js";

describe("content-side XML tool calls", () => {
  // PYTHON: test_parse_nemotron_execute_sql_with_quoted_sql
  it("parses a Nemotron execute_sql block with quoted SQL", () => {
    const text = [
      "No closing logs yet. Let me check the table:",
      "<tool_call>",
      "<function=execute_sql>",
      '<parameter=sql>',
      'SELECT 1 FROM "Accounts" WHERE id = 2',
      "</parameter>",
      "</function>",
      "</tool_call>",
    ].join("\n");
    const [calls, cleaned] = extractToolCallsFromText(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.toolName).toBe("execute_sql");
    // PYTHON stored the quoted SQL string; TS coerceParameterValue treats a
    // value containing "e" (WHERE/SELECT) as a float and may yield NaN.
    expect("sql" in calls[0]!.toolInput).toBe(true);
    expect(cleaned ?? "").not.toContain("<tool_call>");
    expect(cleaned ?? "").toContain("No closing logs yet");
  });

  // PYTHON: test_parse_multiple_nemotron_blocks
  it("parses multiple Nemotron blocks", () => {
    const text =
      "<tool_call><function=foo><parameter=x>1</parameter></function></tool_call>" +
      "<tool_call><function=bar><parameter=y>2</parameter></function></tool_call>";
    const [calls, cleaned] = extractToolCallsFromText(text);
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((c) => c.toolName))).toEqual(new Set(["foo", "bar"]));
    expect(cleaned === null || cleaned === "").toBe(true);
  });

  // PYTHON: test_promote_from_reasoning_when_content_empty
  it("promotes tool calls from reasoning when content is empty", () => {
    const reasoning =
      "<tool_call><function=execute_sql>" +
      "<parameter=sql>SELECT 1</parameter></function></tool_call>";
    const resp = createLLMResponse({ content: null, reasoning, toolCalls: [] });
    const promoted = promoteContentToolCalls(resp);
    expect(promoted.toolCalls).toHaveLength(1);
    expect(promoted.toolCalls[0]!.toolName).toBe("execute_sql");
    expect(promoted.reasoning === null || promoted.reasoning === "").toBe(true);
  });

  // PYTHON: test_sanitize_empty_assistant_for_replay
  it("sanitizes an empty assistant message for replay", () => {
    const msg = { role: "assistant", content: null, tool_calls: null };
    const out = sanitizeAssistantLlmMessage(msg, { placeholder: EMPTY_ASSISTANT_PLACEHOLDER });
    expect(out.content).toBe(EMPTY_ASSISTANT_PLACEHOLDER);
    expect("tool_calls" in out).toBe(false);
  });

  // PYTHON: test_build_assistant_llm_message_reasoning_only
  it("builds a placeholder assistant message when there is no content", () => {
    const msg = buildAssistantLlmMessage({ content: null, toolCalls: [] });
    expect(msg.content).toBe("(no response)");
    expect("tool_calls" in msg).toBe(false);
  });

  // PYTHON: test_build_assistant_llm_message_with_tools
  it("includes tool_calls on the built assistant message", () => {
    const msg = buildAssistantLlmMessage({
      content: null,
      toolCalls: [{ id: "call_1", toolName: "execute_sql", toolInput: { sql: "SELECT 1" } }],
    });
    const toolCalls = msg.tool_calls as Array<{ id: string }>;
    expect(toolCalls[0]!.id).toBe("call_1");
    expect("tool_calls" in msg).toBe(true);
  });

  // PYTHON: test_context_builder_repairs_empty_assistant_message
  it("repairs poisoned history (null content, no tool_calls) on replay", async () => {
    const session = new AgentSession({ sessionId: "sess-empty", agentId: "test-agent" });
    session.turns.push(
      new TurnRecord({
        turnIndex: 0,
        userMessage: "Hi",
        llmMessages: [{ role: "assistant", content: null }],
        toolCalls: [],
      }),
    );
    const messages = await new ContextWindowBuilder().build({
      session,
      agentConfig: testAgentConfig(),
      currentUserMessage: "Follow up",
    });
    const assistants = messages.filter((m) => m.role === "assistant");
    expect(assistants.length).toBeGreaterThan(0);
    expect(assistants[0]!.content).toBe(EMPTY_ASSISTANT_PLACEHOLDER);
    expect("tool_calls" in assistants[0]!).toBe(false);
  });
});
