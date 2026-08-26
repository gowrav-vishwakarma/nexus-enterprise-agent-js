# Streaming

**Who this is for:** Developers building live UIs who need token chunks, tool events, and sequence numbers.

## Key terms

- **Blocking** — Wait for the full reply; get one result object (`run()`).
- **Streaming** — Receive chunks as the LLM generates text (`runStream()`).
- **seq** — A counter on every stream event, starting at `1`, increasing by one per event.
- **Paused** — The run stopped waiting for a client tool or elicitation; call `resume()`.

This package streams **in process**. HTTP Server-Sent Events (SSE) replay is **not shipped**. Serving lives in the consumer app — buffer events yourself if a browser must reconnect without a second agent run.

## Default mode

Set on `AgentConfig.stream_output` or `AgentGroupConfig.stream_output` (default: `false` = blocking).

Override per call with `stream: true` or `stream: false` on `run()` / `runStream()`.

## Blocking

```ts
const result = await runner.run({ userMessage: "Hello", stream: false });
console.log(result.finalResponse);
```

Returns `AgentRunResult`. When `status === "paused"`, inspect `result.pendingInteractions` and call `resume()`.

## Streaming

```ts
for await (const event of runner.runStream({ userMessage: "Hello", stream: true })) {
  if (event.eventType === "content") {
    process.stdout.write(event.content ?? "");
  } else if (event.eventType === "final_response") {
    const result = event.data; // full AgentRunResult
  }
}
```

Returns `AsyncIterable<AgentStreamEvent>`.

`runStream()` accepts the same `initialContext` argument as `run()` to seed checkpoint `state` and session metadata.

### Stream event types

| `eventType` | When it fires |
|-------------|----------------|
| `content` | LLM text chunk |
| `reasoning` | Reasoning ("thinking") chunk, if the model produces any |
| `tool_call` | Model requested a **server** tool |
| `tool_result` | Server tool finished; check `event.content` |
| `client_tool_call` | Model requested a client tool (`execution: "client"`); run will pause |
| `elicitation` | Model requested user input (`*.request_user_input`); run will pause |
| `paused` | Run stopped with `pendingInteractions` in `event.data` |
| `final_response` | Run done; full `AgentRunResult` in `event.data` |
| `error` | Run failed |
| `event` | Internal lifecycle signal (including cancel: `data.cancelled === true`) |

Events are emitted **as they arrive** from the provider, in the order they occurred. A turn that ends in a tool call still streams whatever text the model wrote first.

### Sequence numbers and reconnecting

Every event carries `event.data.seq` — a counter starting at `1` that increases by exactly one per event, whatever the event type. A UI that drops a connection can remember the last `seq` it rendered and drop anything at or below that number when it reconnects:

```ts
let lastSeen = 0;
for await (const event of runner.runStream({ userMessage: userMsg, stream: true })) {
  const seq = Number(event.data?.seq ?? 0);
  if (seq <= lastSeen) continue; // already rendered before the drop
  lastSeen = seq;
  render(event);
}
```

Numbering is stored on `AgentSession.streamSeq`, so a restarted process continues from the last emitted event. See [jobs.md](jobs.md#run-checkpoints).

De-duplicating on the client only helps if the client can get the missed events at all. On its own, a reconnect means resending the message and paying for a second run.

### HTTP SSE replay is not shipped

The Python package's `GET /v1/sessions/{id}/stream` replay buffer is **not** part of this TypeScript package. Mount your own route in the consuming app if you need:

- `Last-Event-ID` / `last_seq` replay
- Scope-keyed buffers so one tenant cannot reattach to another
- Multi-worker backing (Redis) behind more than one Node process

Keep the event types and `seq` numbers above — they are what your app should persist and replay.

### Reasoning ("thinking")

Reasoning-capable models emit their private train of thought separately from the answer. Nexus forwards each piece as a `reasoning` event. Reasoning never appears in `content`:

```ts
for await (const event of runner.runStream({ userMessage: "Hello", stream: true })) {
  if (event.eventType === "reasoning") {
    renderThinking(event.content); // collapse this in your UI
  } else if (event.eventType === "content") {
    renderAnswer(event.content);
  }
}
```

The full text is saved on the turn as `TurnRecord.reasoning`. It is deliberately **not** stored inside `TurnRecord.llmMessages`, because those objects are replayed into the next provider request. Nexus never sends reasoning back to the model.

Two things to check if you see no `reasoning` events:

- **The model must be asked to think.** Use `LLMProviderConfig.enable_thinking: true`, or the provider's own switch (`reasoning_effort`, `thinking`) via `default_params` (mapped to AI SDK `providerOptions`). Set `enable_thinking: false` for voice. See [agent-config.md](agent-config.md#reasoning-thinking).
- **The server must parse it.** A self-hosted vLLM or SGLang deployment only fills reasoning when started with a matching `--reasoning-parser`. Without it the model's `<think>` block stays inside `content`.

### Pause / resume (summary)

```ts
for await (const event of runner.runStream({ userMessage: userMsg, stream: true })) {
  if (event.eventType === "paused") {
    const pending = event.data?.pending_interactions ?? event.data?.pendingInteractions;
    const result = await runner.resume({
      sessionId: String(event.data?.session_id ?? event.data?.sessionId),
      results: (pending as Array<{ tc_id?: string; tcId?: string }>).map((p) => ({
        tc_id: p.tc_id ?? p.tcId,
        content: "...",
      })),
    });
  }
}
```

Full constructor tables: [agent-runner.md](agent-runner.md#agentrunnerresume).

### Supervision: react to tool results

Use `runStream()` when your app must **take charge** after a tool returns:

```ts
let escalate = false;
for await (const event of runner.runStream({ userMessage: userMsg, stream: true })) {
  if (event.eventType === "tool_result" && (event.content ?? "").includes("escalate")) {
    escalate = true;
    break;
  }
}
```

Structured lifecycle events: [events.md](events.md).

| Method | Returns when not streaming | Returns when streaming |
|--------|---------------------------|------------------------|
| `run()` | `AgentRunResult` | Throws — use `runStream()` |
| `runStream()` | Throws — use `run()` | `AgentStreamEvent` chunks |
| `resume()` | `AgentRunResult` | Pass `stream: true` only if you continue via the run path (defaults to blocking) |

## Multi-agent

`AgentOrchestrator.runStream()` and `OrchestrationRuntime.runStream()` follow the same pattern.

## Next steps

- [Events](events.md)
- [Runner](agent-runner.md)
- [Tools](tools.md) — `execution: "client"` and toolsets
- [Agent config](agent-config.md)
