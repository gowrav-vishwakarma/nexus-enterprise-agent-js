/** Audit logging sink for tool calls and guard decisions. */

import { ScopeLevel, scopeKey } from "../scope.js";
import { createRunContext, type RunContext } from "../tools/context.js";
import { redactPayload } from "./redaction.js";

export interface NexusEventLike {
  eventType: string;
  sessionId?: string | null;
  agentId?: string | null;
  turnIndex?: number | null;
  data?: Record<string, unknown>;
}

export interface EventSink {
  emit(event: NexusEventLike): Promise<void>;
}

const AUDITED_PREFIXES = ["tool_call.", "human_in_loop."];

export class AuditSink implements EventSink {
  constructor(
    private readonly ctx: RunContext = createRunContext(),
    private readonly opts: { loggerName?: string; redact?: boolean } = {},
  ) {}

  async record(
    eventType: string,
    opts: { ctx?: RunContext | null; data?: Record<string, unknown> } = {},
  ): Promise<void> {
    const context = opts.ctx ?? this.ctx;
    let payload = opts.data ?? {};
    if (this.opts.redact !== false) {
      payload = redactPayload(payload) as Record<string, unknown>;
    }
    const entry = {
      ts: new Date().toISOString(),
      event: eventType,
      scope: scopeKey(context, ScopeLevel.User),
      tenantId: context.tenantId,
      companyId: context.companyId,
      userId: context.userId,
      sessionId: context.sessionId,
      data: payload,
    };
    console.info(JSON.stringify(entry));
  }

  async emit(event: NexusEventLike): Promise<void> {
    const name = event.eventType;
    if (!AUDITED_PREFIXES.some((p) => name.startsWith(p))) return;
    await this.record(name, { data: event.data });
  }

  async onEvent(event: NexusEventLike): Promise<void> {
    await this.emit(event);
  }
}
