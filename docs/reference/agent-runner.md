# Runner and orchestration runtime

**Who this is for:** Developers calling `run()` or `runStream()` who need every constructor and method parameter.

## Key terms

- **AgentRunner** — Runs one agent's loop.
- **AgentOrchestrator** — Runs a multi-agent team.
- **OrchestrationRuntime** — Loads a YAML manifest and creates the right executor (runner or orchestrator).
- **Blocking** — `run()` waits and returns a full result object.
- **Streaming** — `runStream()` yields events as the LLM generates text.
- **SessionScope** — Ownership filter for storage load/save (from `RunContext.toScope()`). Not the chat thread id.
- **Resume** — Continue a paused run after client tools or elicitations return.

How `RunContext`, `SessionScope`, `storageConfig`, and `crossSessionMemoryStore` differ: [Four objects people mix up](../architecture.md#four-objects-people-mix-up).

## AgentRunner constructor

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `config` | Yes | — | `AgentConfig` for this agent |
| `toolRegistry` | Yes | — | Registered tools the LLM can call |
| `storageConfig` | No | in-memory | Wires chat-history persistence: `SessionStorageConfig` or a ready `SessionManager` |
| `sessionManager` | No | from `storageConfig` | Ready `SessionManager` (wins over `storageConfig`) |
| `runContext` | No | empty `createRunContext()` | Customer, user, chat id for this call |
| `eventEmitter` | No | new `NexusEventEmitter` | Observability event hook |
| `crossSessionMemoryStore` | No | `null` | Live store for user facts across chat threads (separate from chat JSON) |
| `hooks` | No | `{}` | Turn / tool / LLM hooks |
| `onTurnEnd` | No | `null` | Shortcut for `hooks.onTurnEnd` |
| `llmAdapter` | No | Vercel AI SDK adapter | Inject `MockLLMAdapter` in tests |

Storage resolution order: `sessionManager` → `storageConfig` on the runner → `config.storage` → in-memory.

```ts
import { AgentRunner, MockLLMAdapter, createRunContext } from "nexus-enterprise-agent";

const runner = new AgentRunner({
  config,
  toolRegistry: registry,
  runContext: createRunContext({ tenantId: "acme", userId: "u-42" }),
  llmAdapter: new MockLLMAdapter([{ content: "hello" }]),
});
```

## SessionScope wiring

Every load / append / save passes a scope built from the current `RunContext` (`tenantId`, `companyId`, `userId`). Scope is the ownership filter — “whose rows may I touch?” — not which chat thread. The chat thread id is `sessionId`. You do not pass scope into `run()` yourself — set identity on `RunContext` before constructing the runner.

See [storage.md](storage.md) and [run-context.md](run-context.md).

## Persistable / shouldPersist

| Source | Effect |
|--------|--------|
| `RunContext.persistable = false` | No session save or append |
| `RunContext.isCron = true` | Same (via `shouldPersist`) |
| `RunContext.isSubagent = true` | Same |
| `shouldPersist` is `true` | Normal persistence |

When `shouldPersist` is `false`, the loop still runs in memory for that request, but durable session writes are skipped. Memory and skill_manage write tools also no-op.

## AgentRunner.run()

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `userMessage` | Yes | — | The user's input text (string or `{ userMessage }`) |
| `sessionId` | No | from `RunContext` or new UUID | Override chat thread id for this call |
| `initialContext` | No | `null` | Key/value merged into session metadata and checkpoint `state` once at run start |
| `stream` | No | `config.stream_output` | If `true`, throws — use `runStream()` instead |
| `maxTurns` | No | `null` | Optional cap for this run (min with `config.turns.max_turns`) |

Returns `AgentRunResult` with `finalResponse`, `turnsUsed`, `status`, `state`, `pendingInteractions` (when `status === "paused"`), and RCS token fields.

The agent's tool allow-list comes from `AgentConfig.toolset` (resolved against the runner's tool registry), or from a per-run `runContext.get("toolset_override")`. When `toolset` is `null`, every registered tool is visible and the legacy `tool_plugins` namespace filter still applies. See [tools.md](tools.md).

Without a real API key, pass `llmAdapter: new MockLLMAdapter()`. See [eval.md](eval.md).

## AgentRunner.runStream()

Same arguments as `run()`. Yields `AgentStreamEvent` objects (`content`, `reasoning`, `tool_call`, `client_tool_call`, `elicitation`, `paused`, `final_response`, …). Each event carries `data.seq`. See [streaming.md](streaming.md).

## AgentRunner.cancel()

Call `runner.cancel()` from another task (or from a tool / `onTurnEnd` hook) to stop the in-flight run cooperatively.

The loop checks the flag:

- at the start of each turn
- between sequential tool calls
- between streamed LLM chunks (mid-token output is dropped; the incomplete assistant turn is not saved)

The run then ends with `status: "interrupted"`. Streaming clients also receive an `event` with content `"Run cancelled."` and `data: { cancelled: true, status: "interrupted" }`. A new `run()` / `runStream()` starts with the flag cleared.

```ts
const task = runner.run("long job");
runner.cancel();
const result = await task;
// result.status === "interrupted"
```

## Turn-end hook (`onTurnEnd`)

Optional async callback on `AgentRunner({ onTurnEnd })` or `hooks.onTurnEnd`. After each completed turn (and state sync), Nexus calls your hook with a `TurnContext`. Return `null` or `{ action: "continue" }` for default behaviour, `{ action: "stop" }` to end the run with `status: "interrupted"`, or `{ action: "inject", message: "..." }` to start the next loop iteration with that user message. Hook errors are logged and treated as continue.

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `action` | Yes | — | `continue`, `stop`, or `inject` |
| `message` | No | `null` | User text when `action` is `inject` |

## AgentRunner.resume()

Continue after a client tool or elicitation paused the loop:

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `sessionId` | Yes | — | Chat thread that has `pendingInteractions` |
| `results` | Yes | — | List of `{ tc_id` or `tcId` or `call_id` / `callId`, `content }` |
| `stream` | No | `false` | When `true`, continues via an internal streaming loop and returns the final `AgentRunResult` |

```ts
const result = await runner.resume({
  sessionId: "chat-1",
  results: [{ tc_id: "TC1", content: "picked report.pdf" }],
});
```

Raises if the session is missing or has no pending interactions.

## Runtime tool granting

Adjust a live agent's tool allow-list between turns (schemas are re-filtered each turn):

| Method | What it does |
|--------|--------------|
| `grantTools(names)` | Add explicit tool name(s) to the allow-list |
| `grantToolset(nameOrNames)` | Resolve a defined toolset and union it in |
| `revokeTools(names)` | Remove tool name(s) from the allow-list |

These are no-ops when the agent has no toolset restriction (`config.toolset` is `null`), because every registered tool is already visible. See [tools.md](tools.md#runtime-tool-granting).

## Structured output

Set `resultType` (or `result_type`) on `AgentConfig` to a **Zod schema**. After a turn with no tool calls, the runner parses the assistant JSON and calls `validateStructuredResult`. On failure it retries up to `structured_output_max_retries` (default `2`) with a repair message.

```ts
import { z } from "zod";

const Invoice = z.object({ total: z.number(), currency: z.string() });
const config = parseAgentConfig({ name: "billing", llm, resultType: Invoice });
const result = await runner.run("Extract the invoice");
console.log(result.structuredResult);
```

A YAML string name is ignored at runtime — pass the Zod object in TypeScript.

## Content-side tool-call recovery

Some OpenAI-compatible models emit Hermes/Nemotron-style `<tool_call>` XML in **text content** or **reasoning** instead of native `tool_calls`. After each LLM response, `AgentRunner` runs `promoteContentToolCalls()`: if native tool calls are empty, XML is parsed, tools execute normally, and XML is stripped from saved assistant content.

Assistant turns persisted to the session are normalized with `buildAssistantLlmMessage()` so replay never sends an assistant message with neither `content` nor `tool_calls` (which causes provider 400 errors). `ContextWindowBuilder` applies the same repair when rebuilding history from older poisoned sessions.

## Message role alternation

OpenAI tolerates two assistant messages in a row, but most other providers reject it. Two rules keep replayed history safe:

1. Every tool call always renders a `tool` message, so an assistant message carrying `tool_calls` is always followed by the results answering it. RCS summarizes a result but never removes the step — see [RCS](agent-config.md#runtimecontextsummarizerconfig-rcs).
2. As a backstop, `ContextWindowBuilder` merges adjacent assistant messages, joining their text with a blank line. A message carrying `tool_calls` is never merged.

## Context pressure

When the assembled message list exceeds `llm.context_window_tokens`, `ContextWindowBuilder` applies pressure in this order:

1. **RCS fallback compactor** — triggers on the untrimmed token count so a huge tool result gets a real summary instead of being lost.
2. **Tool-body degradation** — the oldest unsummarized raw tool result is replaced at render time with a short notice telling the model to re-run with a narrower scope. Storage keeps `ToolCallRecord.rawResponse`.
3. **Whole-turn drop** — only when every tool body has already been degraded and the list still does not fit.

After budgeting, if no bare `user` message survived, the builder inserts the anchor user query immediately after the system message.

## AgentOrchestrator

Same constructor args as `AgentRunner`, but `config` is `AgentGroupConfig`.

Same `run()` / `runStream()` signatures. Returns `AgentGroupResult`.

**Team caveat:** Set `RunContext.sessionId` before creating the orchestrator. Member chat ids are fixed at init.

## OrchestrationRuntime.fromManifest()

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `manifest` | Yes | — | Loaded `OrchestrationManifest` |
| `runContext` | Yes | — | Who is calling and which chat thread |
| `toolRegistry` | No | `null` | Pre-built registry; YAML `plugins` still load |
| `persistenceResolver` | No | from manifest `storage` | Per-tenant storage override |
| `eventEmitter` | No | `null` | Observability hook. Fanned out to member runners when the root is a multi-agent group |
| `crossSessionEnabled` | No | `true` | Build cross-chat memory store from manifest storage |

Methods: `run({ userMessage })`, `runStream({ userMessage })`.

```ts
const runtime = await OrchestrationRuntime.fromManifest(manifest, {
  runContext: ctx,
  toolRegistry: registry,
});
await runtime.run({ userMessage: "hello" });
```

## Chat thread id priority

1. `run({ sessionId })`
2. `RunContext.sessionId`
3. Auto-generated UUID

The runner syncs the resolved id back onto `RunContext`.

## Next steps

- [Run context](run-context.md)
- [Tools](tools.md)
- [Streaming](streaming.md)
- [Events](events.md)
- [Multi-agent](multi-agent.md)
