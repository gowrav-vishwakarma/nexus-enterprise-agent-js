# YAML manifest schema

**Who this is for:** Anyone editing an orchestration YAML file who needs every field and default.

## Key terms

- **Manifest** — The top-level YAML document loaded by `OrchestrationManifest.load()`.
- **Root** — The agent or group name that runs when you call `runtime.run()`.
- **Anchor** — YAML `&name` / `*name` syntax to reuse a block (often for shared LLM settings).

YAML fields stay **snake_case**. TypeScript constructors use camelCase. `prompts_module` is also accepted as `promptsModule`.

## Top-level fields

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `version` | No | `"1"` | Manifest format version |
| `root` | Yes | — | Agent or group name to execute |
| `prompts_module` | No | `{stem}_prompts.ts` beside YAML | TypeScript file with a `PROMPTS` export |
| `defaults` | No | empty | Shared blocks merged into agents/groups |
| `storage` | No | `adapter: memory` | Where chat history is saved |
| `plugins` | No | `{}` | Plugin name → import path (`./file.js#ClassName`) |
| `agents` | No | `{}` | Named agent definitions |
| `groups` | No | `{}` | Named team definitions |
| `channels` | No | `{}` | Channel name → channel spec (adapter, secrets) — see [realtime-agents.md](realtime-agents.md) |
| `servers` | No | `{}` | Named GPU media servers (used by the **Python** sidecar) — see [server.md](server.md) |

## `defaults` block

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `defaults.agent` | No | `{}` | Merged into every agent (turns, memory, etc.) |
| `defaults.llm` | No | `{}` | Used when an agent omits `llm` |
| `defaults.group` | No | `{}` | Merged into every group |

## Agent fields (under `agents.<name>`)

Agents accept the same fields as `AgentConfig` plus orchestration persona keys:

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `llm` | No* | from `defaults.llm` | LLM provider settings (*required unless defaults provide it) |
| `persona.role` | Yes** | — | Agent role label (**when persona block is used) |
| `persona.goal` | Yes** | — | What the agent tries to do |
| `persona.backstory` | No | `null` | Extra background text |
| `persona.prompt` | No | — | Key in the `PROMPTS` object |
| `persona.prompt_args` | No | `{}` | Extra Nunjucks variables (flattened at render time) |
| `turns` | No | `TurnConfig()` defaults | Loop limits — see [agent-config.md](agent-config.md#turnconfig) |
| `tool_plugins` | No | `[]` | Allow-list of plugin namespaces |
| `toolset` | No | `null` | Toolset name or list of names (packs are defined on the tool registry in code) |
| `memory` | No | disabled | Cross-session user memory — see [memory.md](memory.md) |
| `rag` | No | `null` | Optional retrieval — see [rag.md](rag.md) |
| `context_summary` | No | disabled | Rolling conversation summary (`summarize_on`) |
| `rcs` | No | disabled | Long-context summarization |
| `skills` | No | disabled | Static agentskills.io folders + optional learned skill store |
| `storage` | No | `null` | Per-agent storage fallback |
| `result_type` | No | `null` | Leave unset in YAML; set a Zod schema in TypeScript (`resultType`) |
| `trace_enabled` | No | `false` | Attach a default stdout event sink |
| `stream_output` | No | `false` | Default streaming mode |

### Agent `skills` (learned store fields)

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `skills.enabled` | No | `false` | Turn skills on |
| `skills.scope.keys` | No | `tenantId`, `companyId`, `userId` | Partition for learned skills |
| `skills.store_backend` | No | `"none"` | `"none"`, `"memory"`, `"file"`, or `"custom"` |
| `skills.store_class` | No | `null` | Import path when backend is `custom` |
| `skills.store_config` | No | `{}` | Backend kwargs (e.g. file `root`) |
| `skills.retrieval_k` | No | `6` | Max learned skills injected per turn |
| `skills.inject_learned` | No | `true` | Inject learned skills into the system prompt |
| `skills.expose_manage_tools` | No | `false` | Register `skill_manage.*` tools |

### Agent toolset (YAML sketch)

Toolset packs are defined in code on the `ToolRegistry`; the manifest only selects which pack(s) an agent uses:

```yaml
agents:
  assistant:
    toolset: core
    # toolset: [core, attachments]
```

See [tools.md](tools.md) and [agent-config.md](agent-config.md) for nested fields (`turns`, `memory`, `rcs`, `skills`).

## Group fields (under `groups.<name>`)

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `pattern` | No | `supervisor` | How members run: `supervisor`, `pipeline`, `parallel` |
| `members` | Yes | `[]` | Agent names, inline agents, or nested group refs |
| `session_id_prefix` | No | `""` | Prefix for child session ids |
| `max_turns` | No | `20` | Total turns across the group |
| `aggregation_strategy` | No | `supervisor` | For `parallel`: `concat`, `first_complete`, or `vote`. `consensus` is **held** |
| `description` | No | `null` | Human-readable description |
| `supervisor` | No | `null` | Lead member name for `supervisor` |
| `persist_members` | No | `false` | Persist member chat sessions |
| `context_sharing` | No | `inherit` | `isolated`, `inherit`, or `shared` |
| `stream_output` | No | `false` | Default streaming mode for the group |

The `voice_team` pattern is loaded by `RealtimeRuntime`, not the text runtime — see [realtime-agents.md](realtime-agents.md).

## Realtime agent fields (voice / vision)

A realtime agent is a normal agent plus media keys. These are read by `RealtimeRuntime` (the text runtime ignores them). The text agent config goes under an `agent:` block:

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `modality` | No | `voice_cascaded` | `text`, `vision_text`, `voice_cascaded`, `voice_s2s` |
| `duplex` | No | `full` | `half` (IVR) or `full` (barge-in) |
| `stt` | No | mock | Speech-to-text: `provider`, `server_ref`, `language`, `sample_rate` |
| `tts` | No | mock | Text-to-speech: `provider`, `server_ref`, `voice`, `sample_rate` |
| `vad` | No | energy | Turn detection: `threshold`, `silence_ms`, `min_speech_ms`, `barge_in_min_speech_ms` |
| `languages` | No | derived | `allowed` (list), `default` (ISO code) |
| `initial_response` | No | `none` | Connect greeting/IVR: `mode`, `text`, `via_llm`, `llm_trigger`, `ivr_script` |
| `lid` | No | — | Per-turn language ID: `provider`, `server_ref`, `fallback_language` |
| `s2s` | No | openai_realtime | Speech-to-speech model: `provider`, `model`, `voice` |
| `agent` | Yes | — | The underlying `AgentConfig` (persona, llm, tools, ...) |

GPU servers stay in the [Python package](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent). See [server.md](server.md).

## `servers:` block (gRPC media sidecar)

Optional top-level map of named media servers. Keys are **labels**; agents reference them via `server_ref`. Processes are started by the Python sidecar.

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| *(key)* | Yes | — | Arbitrary label (e.g. `indic_stt`) |
| `kind` | Yes | — | `stt`, `tts`, `vad`, or `lid` |
| `engine` | Yes | — | Engine plugin id on the Python process |
| `host` | No | `127.0.0.1` | Bind / connect address |
| `port` | Yes | — | gRPC port |
| `device` | No | — | `cpu`, `cuda`, … (Python process) |
| `replicas` | No | `1` | TTS replica count |
| `sample_rate` | No | — | Native audio rate (Hz) |
| `extra` | No | `{}` | Engine-specific options |

## `llm` block (agent or defaults)

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `provider` | No | `openai` | Provider hint for the Vercel AI SDK |
| `model` | No | `gpt-4o` | Model name string |
| `api_key` | Yes for real calls | `""` | API key (use `${ENV:...}` in YAML) |
| `base_url` | No | `null` | Custom API endpoint URL |
| `enable_thinking` | No | `null` | Force reasoning on/off |
| `default_params` | No | `{}` | Extra provider params (`temperature`, `max_tokens`, …) |
| `context_window_tokens` | No | `128000` | Budget for RCS and context pressure |

Full list: [agent-config.md](agent-config.md#llmproviderconfig).

## Env interpolation

Any YAML string can use:

- `${ENV:VAR_NAME}` — substitute environment variable
- `${ENV:VAR_NAME|fallback}` — use fallback if unset

## Errors you may see

| Error | Cause |
|-------|-------|
| `PromptNotFoundError` | `persona.prompt` key missing from `PROMPTS` |
| `MemberNotFoundError` | Group `members` references unknown name |
| `ReferenceCycleError` | Nested groups reference each other in a loop |

## Next steps

- [Getting started](../getting-started.md)
- [Multi-agent](multi-agent.md)
- [Agent config](agent-config.md)
