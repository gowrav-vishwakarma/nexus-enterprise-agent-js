# Guardrails

**Who this is for:** Developers who want to redact personal data, block obvious prompt injections, or attach cost / audit hooks to a run.

## Key terms

- **Guard** — A small check that runs on input or output text (`check(content, { ctx, phase })`).
- **Guard engine** — `GuardEngine`; runs a list of guards in order.
- **Redact** — Replace emails, phone numbers, or secret-looking keys with placeholders.
- **Block** — Stop the run (throw `GuardrailError` from a hook).
- **Audit sink** — Append-only log of tool calls, keyed by [scope](scope.md).

Input/output guards run on runner hooks. Nexus does not install them automatically — you wire `GuardEngine` into `RunnerHooks`.

## Built-in guards

| Guard | Behavior |
|-------|----------|
| `PIIRedactionGuard` | Redacts emails and phone numbers |
| `PromptInjectionGuard` | Blocks obvious injection phrases on **input** (`ignore previous instructions`, `you are now`, …) |

## Usage

```ts
import {
  AgentRunner,
  GuardEngine,
  GuardrailError,
  PIIRedactionGuard,
  PromptInjectionGuard,
} from "nexus-enterprise-agent";

const engine = new GuardEngine([
  new PIIRedactionGuard(),
  new PromptInjectionGuard(),
]);

const runner = new AgentRunner({
  config,
  toolRegistry: registry,
  hooks: {
    beforeLLMCall: async (ctx) => {
      const last = ctx.messages.at(-1);
      const text = typeof last?.content === "string" ? last.content : "";
      const result = await engine.checkInput(text, ctx.runContext);
      if (result.decision === "block") {
        throw new GuardrailError(result.reason ?? "blocked");
      }
      return null;
    },
  },
});
```

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `guards` | No | `[]` | List of `GuardProtocol` objects |
| `checkInput(content, ctx)` | — | — | Run guards with `phase: "input"` |
| `checkOutput(content, ctx)` | — | — | Run guards with `phase: "output"` |

A guard may return `allow`, `redact` (with replacement `content`), or `block`.

## Tool policy and cost

| Piece | What it does |
|-------|--------------|
| `ToolPolicyEngine.fromContext(ctx)` | Allow/deny tools from `ctx.auth` |
| `CostTracker` | Token and USD estimates (`DEFAULT_PRICING`) |
| `RateLimiter` | Per-tenant requests per minute |
| `AuditSink` | Append-only audit log; register it on the emitter with the run's `RunContext` so lines are scope-keyed. See [events.md](events.md#audit-trail). |

## Redaction

`PIIRedactionGuard` strips email addresses and phone numbers from model-facing content. The same patterns live in `src/guardrails/redaction.ts`. Use `redactText()` for strings and `redactPayload()` for nested objects and arrays in your own code.

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `redactText(text)` | Yes | — | Replace emails with `[EMAIL]` and phones with `[PHONE]` |
| `redactPayload(value)` | Yes | — | Walk objects; keys like `api_key`, `token`, `password` become `[REDACTED]` |
| `sensitiveKeys` | No | built-in set | Override which object keys are masked |

See also [events.md](events.md) for `human_in_loop.*` events (emitted by the runner).

## Next steps

- [Events](events.md)
- [Runner](agent-runner.md)
- [Tools](tools.md)
