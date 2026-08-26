# Agent config reference

**Who this is for:** Developers building `AgentConfig` in TypeScript or YAML who need every field and default.

## Key terms

- **Persona** — Role, goal, and backstory that shape the system prompt.
- **Turn** — One cycle of: send messages to the large language model (LLM) → maybe call tools → save results.
- **RCS** — Runtime Context Summarization; keeps long tool outputs from filling the context window.
- **Memory** — Durable user facts stored across chat threads (cross-session).
- **RAG** — Optional retrieval over a document collection (`AgentConfig.rag`). Unset means no retrieve tool.
- **Zod schema** — A TypeScript validation object from the [Zod](https://zod.dev) library. Use one as `resultType` when you want structured JSON output.

YAML fields stay **snake_case**. TypeScript constructors accept **camelCase** aliases on most objects (`streamOutput`, `resultType`, `apiKey`). Both work.

The LLM goes through the **Vercel AI SDK**, not LiteLLM. Set `provider`, `model`, `api_key`, and optional `base_url` on `llm`. Provider packages such as `@ai-sdk/openai` are optional peers.

## AgentConfig

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `name` | Yes | — | Unique agent id (logs, saved sessions) |
| `llm` | Yes | — | LLM provider settings |
| `persona` | No | role=`Assistant`, goal=`Help the user` | System prompt framing |
| `turns` | No | see TurnConfig | Agent loop limits |
| `rcs` | No | disabled | Context summarization |
| `memory` | No | disabled | Cross-session user memory (curator + injection) |
| `context_summary` | No | disabled (`summarize_on` unset) | Rolling `summary_text` when context fill exceeds ratio |
| `storage` | No | `null` | Fallback storage when the runner has none |
| `tool_plugins` | No | `[]` | Legacy allow-list of tool plugin namespaces (`[]` = all) |
| `toolset` | No | `null` | Toolset name or list of names (defined on the tool registry) — `null` = no restriction. See [tools.md](tools.md) |
| `skills` | No | disabled | Static + learned skills — see [skills.md](skills.md) |
| `rag` | No | `null` | Optional retrieval. `null` registers no `rag.retrieve` tool — see [rag.md](rag.md) |
| `result_type` / `resultType` | No | `null` | A **Zod schema** for structured output (TypeScript). YAML may leave this unset and set it in code. |
| `trace_enabled` | No | `false` | Attach a default stdout sink when you do not pass an emitter |
| `trace_sink` | No | `"stdout"` | `"stdout"` or `"otel"` (otel sink is a hint; pass your own emitter for OpenTelemetry) |
| `stream_output` | No | `false` | Default: blocking result vs streaming events |
| `parallel_tool_calls` | No | `false` | Allow the model to request several tools in one turn |
| `structured_output_max_retries` | No | `2` | How many times to ask the model again when Zod validation fails |
| `metadata` | No | `{}` | Arbitrary extra data |

The `toolset` value refers to a pack you define on `ToolRegistry` with `addToolset(name, [fns])`. Use `toolset` for modern flat-tool allow-lists; keep `tool_plugins` only when you still use class-based `defineToolPlugin` namespaces.

```ts
import { z } from "zod";
import { parseAgentConfig } from "nexus-enterprise-agent";

const Invoice = z.object({
  total: z.number(),
  currency: z.string(),
});

const config = parseAgentConfig({
  name: "billing",
  llm: { provider: "openai", model: "gpt-4o", api_key: process.env.OPENAI_API_KEY },
  persona: { role: "Billing assistant", goal: "Extract invoice totals" },
  resultType: Invoice,
});
```

## AgentPersonaConfig

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `role` | Yes | — | Job title or role label |
| `goal` | Yes | — | What the agent should accomplish |
| `backstory` | No | `null` | Optional background context |
| `system_prompt` | No | `null` | Full system prompt override (skips template) |
| `system_prompt_template` | No | framework default | Nunjucks template for the system prompt |
| `prompt_args` | No | `{}` | Extra template variables from orchestration YAML (e.g. `domain`) |

In YAML orchestration, use `persona.prompt` + `prompt_args` instead of `system_prompt_template` directly. Templates are stored raw at load time and rendered once per LLM turn.

## TurnConfig

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `max_turns` | No | `10` | Max agent loop iterations |
| `max_tool_calls_per_turn` | No | `5` | Cap tool calls per turn (`0` = no cap) |
| `stop_on_empty_tool_calls` | No | `true` | Stop when the LLM returns no tool calls |
| `stop_sequences` | No | `[]` | Text sequences that stop the agent (**planned — not enforced in the runner yet**) |
| `stop_on_result_type` | No | `true` | Stop when structured result is obtained (**planned — not enforced in the runner yet**) |
| `human_in_loop_after_turns` | No | `null` | Pause after N completed turns using the same `pendingInteractions` / `resume()` path as client tools (`tool_name="human_in_loop"`) |
| `turn_timeout_seconds` | No | `300` | Per-turn timeout in seconds |

## LLMProviderConfig

All providers route through the **Vercel AI SDK** (`generateText` / `streamText`). Install the matching optional peer (`@ai-sdk/openai`, `@ai-sdk/anthropic`, …) for that provider. `litellm` and `custom` use `@ai-sdk/openai-compatible` against `base_url`. The built system prompt is sent as the SDK `system` field (not as a message in `messages`).

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `provider` | No | `openai` | Provider hint (`openai`, `anthropic`, `gemini`, `groq`, `ollama`, `litellm`, `openrouter`, `bedrock`, `azure_openai`, `custom`) |
| `model` | No | `gpt-4o` | Model name for the provider |
| `api_key` / `apiKey` | No | `""` | Secret API key |
| `base_url` / `baseUrl` | No | `null` | Custom endpoint (proxies, local servers, OpenAI-compatible APIs) |
| `api_version` | No | `null` | Provider-specific API version |
| `context_window_tokens` | No | `128000` | Max context size for budgeting. When a build exceeds this, Nexus first tries RCS compaction, then replaces oversized raw tool bodies with a retry notice, and only then drops whole turns. A user query is always preserved in the final message list. |
| `timeout` | No | `60` | Request timeout in seconds |
| `max_retries` | No | `3` | Retry count on failure |
| `retry_delay` | No | `1.0` | Seconds between retries |
| `extra_headers` | No | `{}` | Extra HTTP headers |
| `default_params` | No | `{}` | Call settings. Known AI SDK keys (`temperature`, `max_tokens`, `topP`, …) stay top-level. `reasoning_effort`, `extra_body`, and other leftovers go under `providerOptions.<providerName>` (see [llm-vercel-ai.md](../guides/llm-vercel-ai.md)). |
| `enable_thinking` | No | `null` | Force a model's reasoning on (`true`) or off (`false`). `null` leaves the deployment's own setting alone. Written into `providerOptions.<providerName>.chat_template_kwargs.enable_thinking`. |

`base_url` overrides the endpoint; it does **not** choose the adapter. Set `provider` explicitly.

### Reasoning ("thinking")

`enable_thinking` asks reasoning-capable models to emit a private train of thought. Reasoning arrives as `reasoning` stream events, separate from the answer. See [streaming.md](streaming.md#reasoning-thinking).

Set `enable_thinking: false` for **voice**: a reasoning model otherwise writes a whole thinking block before the first speakable word, which delays time-to-first-audio.

Leave it at `null` (or `true`) for chat.

## AgentGroupConfig

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `name` | Yes | — | Group name |
| `description` | No | `null` | Optional description |
| `pattern` | No | `supervisor` | `supervisor`, `pipeline`, `parallel` |
| `members` | No | `[]` | List of `AgentConfig` or nested `AgentGroupConfig` |
| `max_turns` | No | `20` | Total turns across members (enforced by the orchestrator) |
| `aggregation_strategy` | No | `supervisor` | For `parallel`: `concat`, `first_complete`, or `vote` (plurality of replies; no extra LLM call) |
| `session_id_prefix` | No | `""` | Prefix for member chat ids |
| `supervisor` | No | `null` | Lead member name for supervisor pattern |
| `persist_members` | No | `false` | Persist member chat sessions when `true` |
| `context_sharing` | No | `inherit` | `isolated`, `inherit`, or `shared` for group metadata/state |
| `rcs` | No | disabled | Group-level RCS settings |
| `stream_output` | No | `false` | Default streaming mode |

Groups do **not** have an `llm` field. Each member's `AgentConfig` has its own LLM.

## ContextSummaryConfig

See [context-summary.md](context-summary.md) for the full field table (`summarize_on`, `summary_prompt`, `turns_to_fold`, etc.).

## Related references

- [Memory](memory.md)
- [RAG](rag.md)
- [Context summary](context-summary.md)
- [RCS fields](#runtimecontextsummarizerconfig-rcs)

### RuntimeContextSummarizerConfig (RCS)

RCS keeps long tool outputs from filling the context window. When enabled, every tool schema gets an extra `_context_updates` parameter. The LLM can pass summaries of old tool results through this parameter on its next tool call; the interceptor strips it before the tool runs (transparent to tool authors). Summarized results keep their tool signature but lose their `[TCn]` tag so they are not re-summarized.

A tool call is **never removed** from the context. Each one has exactly two possible states:

| State | Rendered as |
|-------|-------------|
| Not summarized | `[TCn] tool_name(args)` + the full raw response |
| Summarized | `tool_name(args)` + the summary (no tag, so it is not re-summarized) |

To summarize nothing on a given turn, the LLM sends an empty list (`_context_updates: []`) or omits the parameter. Every `summary` it does send must be non-empty text.

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `enabled` | No | `false` | Turn on inline tool-result summarization |
| `tc_tag_format` | No | `"[TC{n}]"` | Tag format for unsummarized tool call results |
| `tc_tag_include_tool_signature` | No | `true` | Include tool name + args in the tag prefix |
| `context_updates_param_name` | No | `"_context_updates"` | Extra param injected into every tool schema |
| `context_updates_param_description` | No | default | Description text for the injected param |
| `rcs_system_block` | No | default | RCS contract block appended to the system prompt |
| `fallback_compactor.enabled` | No | `false` | Separate LLM call to summarize old results when context overflows |
| `fallback_compactor.trigger_token_threshold` | No | `10000` | Token count that triggers the fallback compactor |
| `fallback_compactor.compact_oldest_n_tcs` | No | `2` | Number of oldest unsummarized TCs to compact per trigger |
| `fallback_compactor.compactor_llm` | No | agent's LLM | Cheaper model for compaction |
| `fallback_compactor.max_tokens_per_summary` | No | `100` | Max tokens per compacted summary |
| `fallback_compactor.prompt_template` | No | default | Custom compaction prompt |

### RCS events

| Event | When |
|------|------|
| `rcs.tc_summarized` | A tool result was summarized inline via `_context_updates` |
| `rcs.context_built` | The context window was built (tagged vs summarized counts) |
| `rcs.compactor_triggered` | The fallback compactor started |
| `rcs.compactor_completed` | The fallback compactor finished (TCs compacted + tokens saved) |
| `rcs.cross_session_tc_reference` | The LLM referenced a TC id that does not belong to this session |

### RCS token accounting

RCS tracks **two** savings metrics:

| Metric | What it measures | Where it lives |
|--------|-----------------|----------------|
| `totalTokensSavedByRcs` | **One-time** compression savings — `tokens_raw - tokens_summarized` per TC, counted once when the LLM summarizes it via `_context_updates`. | session, `AgentRunResult`, `AgentGroupResult` |
| `cumulativeInputTokensSavedByRcs` | **Recurring** input-token savings — how many input tokens RCS saves *each turn* by having summarized TCs in context instead of their raw versions. | session, `AgentRunResult` |

The one-time metric tells you how much each TC was compressed. The cumulative metric tells you the true cost impact: after N turns, the same summarized TC has saved input tokens N times.

### `token_usage` on the session

`AgentSession` exposes a computed `token_usage` block for UI rendering:

```json
"token_usage": {
  "total_tokens_in": 12345,
  "total_tokens_out": 678,
  "total_tokens_saved_by_rcs": 4321,
  "cumulative_input_tokens_saved_by_rcs": 9876,
  "rcs_enabled": true
}
```

- `total_tokens_in` / `total_tokens_out` — actual tokens sent to / received from the LLM (RCS already applied to inputs).
- The two RCS savings metrics are mirrored here for a single read.
- `rcs_enabled` — whether RCS was on for this chat.

Stored session JSON uses snake_case keys so other languages can read the blob without a TypeScript import.

## Next steps

- [Runner](agent-runner.md)
- [Tools](tools.md)
- [Skills](skills.md)
