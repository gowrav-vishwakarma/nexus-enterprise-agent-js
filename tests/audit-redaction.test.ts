import { afterEach, describe, expect, it, vi } from "vitest";
import { NexusEventEmitter } from "../src/events/emitter.js";
import {
  NexusEventType,
  createBaseEvent,
  type AgentStartedEvent,
  type ToolCallStartedEvent,
} from "../src/events/models.js";
import { AuditSink } from "../src/guardrails/audit.js";
import { redactPayload, redactText } from "../src/guardrails/redaction.js";
import { createRunContext } from "../src/tools/context.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("audit redaction", () => {
  // PYTHON: test_redact_text_masks_email_and_phone
  it("masks email and phone in text", () => {
    expect(redactText("write to a@b.com or call 555-123-4567")).toBe(
      "write to [EMAIL] or call [PHONE]",
    );
  });

  // PYTHON: test_redact_payload_masks_secret_keys_at_any_depth
  it("masks secret keys at any depth", () => {
    const payload = {
      Authorization: "Bearer abc",
      nested: { api_key: "sk-1", contact: "a@b.com" },
      items: [{ token: "t1" }, "plain a@b.com"],
    };
    const out = redactPayload(payload) as {
      Authorization: string;
      nested: { api_key: string; contact: string };
      items: Array<{ token: string } | string>;
    };
    expect(out.Authorization).toBe("[REDACTED]");
    expect(out.nested.api_key).toBe("[REDACTED]");
    expect(out.nested.contact).toBe("[EMAIL]");
    expect((out.items[0] as { token: string }).token).toBe("[REDACTED]");
    expect(out.items[1]).toBe("plain [EMAIL]");
  });

  // PYTHON: test_redacting_sink_cleans_typed_fields_not_just_data
  // JS has no RedactingEventSink; typed fields are redacted with the same helper the sink would use.
  it("redacts typed tool_args fields, not just a data bag", () => {
    const toolArgs = { to: "bob@example.com", api_key: "sk-live-123" };
    expect(redactPayload(toolArgs)).toEqual({ to: "[EMAIL]", api_key: "[REDACTED]" });
  });

  // PYTHON: test_redacting_sink_keeps_routing_fields_searchable
  it("keeps routing fields searchable while redacting the user message", () => {
    const event = {
      session_id: "s1",
      agent_name: "billing",
      user_message: "mail me at x@y.com",
    };
    const redactedMessage = redactText(event.user_message);
    expect(event.session_id).toBe("s1");
    expect(event.agent_name).toBe("billing");
    expect(redactedMessage).toBe("mail me at [EMAIL]");
  });

  // PYTHON: test_audit_sink_records_scope_and_hides_secrets
  it("records scope on the audit sink and hides secrets", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const sink = new AuditSink(
      createRunContext({ tenantId: "acme", companyId: "c1", userId: "u1" }),
    );
    const emitter = new NexusEventEmitter();
    emitter.registerSink(sink as unknown as ConstructorParameters<typeof emitter.registerSink>[0]);

    const event: ToolCallStartedEvent = {
      ...createBaseEvent(NexusEventType.TOOL_CALL_STARTED, {
        sessionId: "s1",
        agentId: "a1",
        data: { tool_args: { token: "tok_live_1" } },
      }),
      eventType: NexusEventType.TOOL_CALL_STARTED,
      toolName: "charge_card",
      toolArgs: { token: "tok_live_1" },
    };
    await emitter.emit(event);

    expect(info).toHaveBeenCalled();
    const entry = JSON.parse(String(info.mock.calls.at(-1)?.[0])) as {
      event: string;
      tenantId: string;
      scope: string;
      data: { tool_args: { token: string } };
    };
    expect(entry.event).toBe("tool_call.started");
    expect(entry.tenantId).toBe("acme");
    expect(entry.scope).toBe("tenant:acme:company:c1:user:u1");
    expect(entry.data.tool_args.token).toBe("[REDACTED]");
  });

  // PYTHON: test_audit_sink_ignores_unrelated_events
  it("ignores events that are not tool or HITL calls", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const sink = new AuditSink(createRunContext({ tenantId: "acme" }));
    const started: AgentStartedEvent = {
      ...createBaseEvent(NexusEventType.AGENT_STARTED, { sessionId: "s1" }),
      eventType: NexusEventType.AGENT_STARTED,
      agentName: "a",
    };
    await sink.emit(started);
    expect(info).not.toHaveBeenCalled();
  });
});
