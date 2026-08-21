# Events and observability

**Who this is for:** Developers who want to react to agent lifecycle, tool calls, and voice session events — for logging, webhooks, or supervision.

## Key terms

- **Event emitter** — `NexusEventEmitter`; fans out framework events to one or more sinks.
- **Sink** — A destination for events (stdout, callback, audit).
- **Supervision** — Using events or `runStream()` to observe a run.

## Why use events?

`runStream()` is best for **live UIs** (token chunks, tool results). `NexusEventEmitter` is best for **structured observability** across the full lifecycle — turns, tools, memory, voice sessions — without coupling to the streaming API.

## Basic setup

```ts
import {
  AgentRunner,
  NexusEventEmitter,
  NexusEventType,
  type NexusEvent,
} from "nexus-enterprise-agent";

const emitter = new NexusEventEmitter();
emitter.registerSink({
  async emit(event: NexusEvent) {
    if (event.eventType === NexusEventType.TOOL_CALL_COMPLETED) {
      console.log("Tool finished:", event.data?.tool_name);
    }
  },
});

const runner = new AgentRunner({ config, toolRegistry: registry, eventEmitter: emitter });
await runner.run("Hello");
```

A sink is any object with `emit(event)`. `CustomCallbackSink` and `StdoutEventSink` live in the events module if you prefer those classes.

Pass the same `eventEmitter` to `OrchestrationRuntime.fromManifest()` or to `AgentOrchestrator`. The orchestrator fans it out to member runners and nested groups.

## Built-in sinks

| Sink | What it does |
|------|--------------|
| `StdoutEventSink` | Prints JSON lines to stdout (default when `trace_enabled: true`) |
| `CustomCallbackSink` | Calls your async `callback(event)` |
| `AuditSink` | Writes an append-only, scope-keyed audit line per tool call and approval |

This package does **not** ship a webhook or OpenTelemetry sink. POST events from your own `emit` implementation. Use `redactPayload()` (guardrails module) before you send events off-box.

```ts
emitter.registerSink({
  async emit(event: NexusEvent) {
    await fetch("https://your-app.example/nexus-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
  },
});
```

`redactPayload` masks emails, phones, and credential-like keys (`api_key`, `token`, `password`, …). See [guardrails.md](guardrails.md#redaction).

## Audit trail

`AuditSink` (guardrails module) records *that* a tool ran, for compliance, without archiving the data it carried. Give it the run's `RunContext` so each line is scope-keyed:

```ts
// AuditSink(runContext, { redact: true })
emitter.registerSink(auditSink);
```

It logs JSON lines for `tool_call.*` and `human_in_loop.*` events, and ignores everything else. Each line carries `scope` (the [scope key](scope.md) at user level), `tenantId`, `companyId`, `userId`, `sessionId`, and the redacted event. Pass `redact: false` only if the sink writes somewhere that is already inside your compliance boundary.

## Event types

| Category | `NexusEventType` values |
|----------|-------------------------|
| Agent | `agent.started`, `agent.completed`, `agent.error` |
| Turn | `turn.started`, `turn.completed`, `turn.error` |
| Tool | `tool_call.started`, `tool_call.completed`, `tool_call.error` |
| LLM | `llm.call_started`, `llm.call_completed`, `llm.stream.chunk`, `llm.call_error` |
| RCS | `rcs.tc_summarized`, `rcs.context_built`, `rcs.compactor_triggered`, `rcs.compactor_completed`, `rcs.cross_session_tc_reference` |
| Memory | `memory.entity_extracted` |
| Context summary | `context.summarized` |
| Session | `session.created`, `session.loaded`, `session.saved` |
| Multi-agent | `agent_group.started`, `agent_group.completed`, `agent.handoff` |
| Realtime / voice | `realtime.session_started`, `realtime.transcribed`, `realtime.barge_in`, `realtime.response_completed`, `realtime.session_ended`, `realtime.error`, `realtime.reconnect` |
| Human-in-loop | `human_in_loop.requested`, `human_in_loop.response` (emitted on pause/resume) |

Each `NexusEvent` has `eventId`, `timestamp`, `sessionId`, `agentId`, `turnIndex`, and a `data` object with event-specific fields.

### RCS fields on completion events

`agent.completed` and `turn.completed` carry RCS savings fields:

| Event | Field | Description |
|-------|-------|-------------|
| `agent.completed` | `totalTokensSavedByRcs` | One-time compression savings across the run |
| `agent.completed` | `cumulativeTokensSavedByRcs` | Recurring input-token savings across all turns |
| `turn.completed` | `tokensSaved` | One-time savings for this turn |
| `turn.completed` | `recurringSavings` | Recurring input-token savings for this turn |

## runStream vs events

| Mechanism | Best for | Can pause the run? |
|-----------|----------|-------------------|
| `runStream()` | Token streaming, live UIs, break on `tool_result` | Yes — stop the async iterator |
| `onTurnEnd` on `AgentRunner` | Deterministic stop/inject after a turn | Yes — returns `TurnDecision` |
| `NexusEventEmitter` | Logging, webhooks you write, audit trail | No — observe only |

For supervision that **stops** the agent when a tool returns a signal, prefer `runStream()`.

## Enable tracing on config

```ts
parseAgentConfig({
  name: "assistant",
  llm,
  trace_enabled: true,
  trace_sink: "stdout",
});
```

This attaches a default `StdoutEventSink` when you do not pass a custom emitter.

## Next steps

- [Streaming](streaming.md) — `runStream()` and `AgentStreamEvent` types
- [Agent runner](agent-runner.md) — `eventEmitter` constructor parameter
- [Guardrails](guardrails.md)
