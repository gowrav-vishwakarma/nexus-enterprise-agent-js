# Prompt templates (Nunjucks / Jinja)

**Who this is for:** Anyone writing `PROMPTS` in a prompts module or custom system prompt templates.

## Key terms

- **Nunjucks** — The template engine Nexus TypeScript uses. It understands Jinja-style `{{ variable }}` and `{% if %}` / `{% for %}` tags.
- **Jinja-compatible** — The same `{{ }}` syntax as the Python package. `{% for key, value in user_memory.items() %}` works: Nexus adds an `.items()` helper on dict-like objects.
- **PROMPTS** — Required export in your prompts TypeScript file: name → template string or callable.
- **Single render** — One Nunjucks pass per LLM turn resolves all variables (persona, run context, memory, summary).

## Prompts module contract

**Primary (recommended):** string templates with all `{{ }}` variables in one place.

```ts
const RESEARCHER_SYSTEM = `You are {{ role }} focused on {{ domain }}.

Goal: {{ goal }}

{% if tenant_id %}Tenant: {{ tenant_id }}{% endif %}

{% if user_memory %}
## About this user
{% for key, value in user_memory.items() %}
- {{ key }}: {{ value }}
{% endfor %}
{% endif %}

{% if summary_text %}
## Conversation Summary
{{ summary_text }}
{% endif %}

Today's date: {{ current_date }}
`;

export const PROMPTS = {
  researcher_system: RESEARCHER_SYSTEM,
};
```

YAML references a key:

```yaml
persona:
  prompt: researcher_system
  prompt_args:
    domain: finance
```

Default prompts path: `{manifest_stem}_prompts.ts` beside the YAML. Override with `prompts_module:`.

At manifest load, the framework stores the **raw** template string on `persona.system_prompt_template` (tags are not pre-rendered). Each LLM turn calls `renderSystemPrompt()` with the full variable set.

Both `tenant_id` / `tenantId` (and the other identity pairs) are available. Pick one style and stay consistent.

## Template variables (each LLM turn)

| Variable | Source |
|----------|--------|
| `role`, `goal`, `backstory` | YAML `persona` |
| `persona` | Full persona object |
| `domain`, … | YAML `persona.prompt_args` (also available as top-level keys and as `prompt_args` / `promptArgs`) |
| `tenant_id` / `tenantId`, `user_id` / `userId`, `session_id` / `sessionId`, `request_id` / `requestId` | `RunContext` + session |
| `metadata` | `RunContext.metadata` (has `.items()`) |
| `metadata.nexus_delegation` | Set on sub-agents by the orchestrator (group name, member, optional `delegated_by`) |
| `state` | `RunContext.state` (checkpoint; also session state when loading a saved chat; has `.items()`) |
| `user_memory` / `userMemory` | Cross-session facts (when `memory.enabled`); has `.items()` |
| `summary_text` / `summaryText` | Rolling summary of folded turns (when `context_summary` enabled) |
| `current_date` / `currentDate` | Today's date (YYYY-MM-DD) |

Within-chat message history is built from `session.turns`. `summary_text` holds narrative from turns that were folded when context filled up.

Both `user_memory` and `summary_text` are also appended by framework injectors when custom templates omit the Nunjucks blocks.

## Advanced: callable prompts

Callables are for cases where you need TypeScript logic at **load time** to build a template string (for example, fixing `domain` from `prompt_args` into the template body). The callable must return an **unrendered** template, not final prose.

The loader passes **one context object** (persona fields, flattened `prompt_args`, and run-context identity):

```ts
function analystSystem(ctx: Record<string, unknown> = {}): string {
  const domain = String(ctx.domain ?? "general");
  return (
    `You are {{ role }} for ${domain}.\n` +
    "{% if tenant_id %}Tenant: {{ tenant_id }}{% endif %}\n" +
    "Goal: {{ goal }}\n"
  );
}

export const PROMPTS = {
  analyst_system: analystSystem,
};
```

At load time the callable receives `role`, `goal`, `backstory`, `tenantId`, and flattened `prompt_args`. Runtime variables like `user_memory` and `summary_text` are still resolved on each LLM turn.

Annotated reference: [../assets/research_team_prompts.annotated.ts](../assets/research_team_prompts.annotated.ts). Runnable example: [examples/orchestration/research_team_prompts.ts](../../examples/orchestration/research_team_prompts.ts).

## Enable memory and context summary

```yaml
defaults:
  agent:
    memory:
      enabled: true
    context_summary:
      summarize_on: 0.8
```

Also wire `crossSessionMemoryStore` on the runner and set `userId` on `createRunContext()` for `user_memory`.

## Next steps

- [Getting started (YAML)](../getting-started.md)
- [Manifest schema](../reference/manifest-schema.md)
