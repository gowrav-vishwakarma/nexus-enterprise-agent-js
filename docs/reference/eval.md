# Evaluation harness

**Who this is for:** Developers writing deterministic tests and small datasets without calling a real large language model (LLM) on every run.

## Key terms

- **Mock LLM** — `MockLLMAdapter`; returns scripted replies (and optional tool calls) instead of calling a provider.
- **Eval runner** — `EvalRunner`; walks a list of cases and checks the agent's text.
- **Session replayer** — `SessionReplayer`; reads a saved chat JSON and lists which tools ran.
- **Live test** — A Vitest case that calls a real model when `NEXUS_LIVE_LLM=1`.

## Mock LLM

```ts
import { MockLLMAdapter, parseLLMProviderConfig } from "nexus-enterprise-agent";

const adapter = new MockLLMAdapter(
  parseLLMProviderConfig({ provider: "openai", model: "gpt-4o" }),
  [{ content: "hello" }],
);
```

You can also pass the response list first:

```ts
const adapter = new MockLLMAdapter([{ content: "hello" }]);
```

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `config` | No | mock OpenAI config | `LLMProviderConfig` (ignored for the network; kept for type shape) |
| `responses` | No | `[{ content: "mock response" }]` | Scripted replies, consumed in order; the last one repeats |
| `content` | No | `null` | Assistant text |
| `reasoning` | No | `null` | Thinking text (emitted as `reasoning` stream events) |
| `toolCalls` | No | `[]` | Fake tool requests (`name` / `toolName` + `arguments`) |
| `streamChunks` | No | synthesized | When set, `chatStream` yields these chunks instead of one blob |
| `delayMs` | No | `0` | Pause before a stream chunk (useful for UI tests) |

Pass the adapter into the runner:

```ts
const runner = new AgentRunner({
  config,
  toolRegistry: registry,
  llmAdapter: adapter,
});
```

Without a real API key, always pass `llmAdapter: new MockLLMAdapter(...)`. See [tests/agent-runner.test.ts](../../tests/agent-runner.test.ts).

## Dataset eval

```ts
import { EvalRunner } from "nexus-enterprise-agent";

const evalRunner = new EvalRunner([
  { id: "greet", input: "Hello", expectContains: "ok" },
]);

const report = await evalRunner.runAll(async (input) => {
  const result = await runner.run({ userMessage: input });
  return result;
});
console.log(report.passed, report.total);
```

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `id` | Yes | — | Case name in the report |
| `input` | Yes | — | User message |
| `expectContains` | No | `null` | Substring that must appear in the final reply |
| `expectTools` | No | `[]` | Reserved for tool-name checks (dataset field) |

CLI (smoke dataset, no real model):

```bash
npx nexus eval tests/fixtures/eval_smoke.json
```

The JSON file is `{ "cases": [ { "id", "input", "expectContains?" } ] }`.

## npm test / live LLM

| Command | What it does |
|---------|--------------|
| `npm test` | Vitest unit suite (mocks; no network) |
| `npm run test:live` | Same as `NEXUS_LIVE_LLM=1 vitest run` — real provider calls |
| `npm run typecheck` | `tsc --noEmit` |

Live tests need `NEXUS_LLM_API_KEY` (or `LITELLM_API_KEY`) and usually `NEXUS_LLM_BASE_URL` / `NEXUS_LLM_MODEL`. See [environment.md](environment.md).

## Session replay

```ts
import { SessionReplayer } from "nexus-enterprise-agent";

const replayer = new SessionReplayer("./saved-session.json");
console.log(replayer.toolNames()); // ["search", "memory.write", ...]
```

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `path` | Yes | — | Path to a session JSON file |
| `turns` | — | from file | Array of turn objects |
| `toolNames()` | — | — | Flat list of tool names used in those turns |

## Next steps

- [Runner](agent-runner.md)
- [Environment](environment.md)
- [CLI](serve.md)
