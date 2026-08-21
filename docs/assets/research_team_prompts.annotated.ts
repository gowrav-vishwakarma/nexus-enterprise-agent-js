/**
 * Annotated prompts module — every PROMPTS field explained.
 *
 * Companion to complete-manifest.annotated.yaml. The runnable copy lives at
 * examples/orchestration/research_team_prompts.ts.
 *
 * Contract
 * --------
 * Your prompts file must export an object named ``PROMPTS``:
 *
 *     export const PROMPTS = {
 *       some_key: "Nunjucks / Jinja-compatible template string",
 *       other_key: (ctx) => "unrendered template string",
 *     };
 *
 * In YAML, reference a key under ``persona.prompt``:
 *
 *     persona:
 *       prompt: researcher_system
 *       prompt_args:
 *         domain: finance
 *
 * The framework stores the raw template at load time and renders it once per LLM
 * turn with role, goal, prompt_args, tenant_id, user_memory, summary_text, etc.
 * See docs/guides/prompts-jinja.md.
 *
 * Nunjucks understands Jinja-style {{ }} and {% %}. Dict-like objects expose
 * .items() so `{% for key, value in user_memory.items() %}` works.
 */

// ── String templates (recommended) ───────────────────────────────────────────
// Use {{ variable }} for values resolved each LLM turn.
// Use {% if %} / {% for %} for optional blocks (memory, summary).

const RESEARCHER_SYSTEM = `You are {{ role }} focused on {{ domain }}.

Goal: {{ goal }}

{% if backstory %}
Background: {{ backstory }}
{% endif %}

{% if tenant_id %}Tenant: {{ tenant_id }}{% endif %}
{% if user_id %}User: {{ user_id }}{% endif %}
{% if session_id %}Session: {{ session_id }}{% endif %}

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
// domain — from persona.prompt_args in YAML (also available as a top-level var)
// role, goal, backstory — from persona block in YAML
// tenant_id / tenantId, user_id / userId, session_id / sessionId, request_id — from RunContext
// user_memory — cross-session facts when memory.enabled (has .items())
// summary_text — folded turn summary when context_summary is enabled
// current_date — today's date (YYYY-MM-DD), added by the framework

const SUPERVISOR_SYSTEM = `You are {{ role }} — team supervisor for {{ domain }}.

Goal: {{ goal }}

Delegate work to specialists using delegate_to_* tools.

{% if tenant_id %}Tenant: {{ tenant_id }}{% endif %}
{% if user_id %}User: {{ user_id }}{% endif %}

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

// ── Callable template (advanced) ─────────────────────────────────────────────
// Return an unrendered Nunjucks string. Use when load-time TypeScript logic should
// bake values into the template body (here: domain from prompt_args).
// The loader passes ONE context object (persona fields + flattened prompt_args +
// run-context identity). Runtime vars (user_memory, summary_text) still render
// on each LLM turn.

function analystSystem(ctx: Record<string, unknown> = {}): string {
  const domain = String(ctx.domain ?? "general");
  return (
    `You are {{ role }} for ${domain}.\n\n` +
    "Goal: {{ goal }}\n" +
    "{% if backstory %}\nBackground: {{ backstory }}\n{% endif %}" +
    "{% if tenant_id %}\nTenant: {{ tenant_id }}\n{% endif %}" +
    "{% if user_id %}User: {{ user_id }}\n{% endif %}" +
    "{% if user_memory %}\n## About this user\n" +
    "{% for key, value in user_memory.items() %}\n- {{ key }}: {{ value }}\n" +
    "{% endfor %}\n{% endif %}" +
    "{% if summary_text %}\n## Conversation Summary\n{{ summary_text }}\n{% endif %}" +
    "\nToday's date: {{ current_date }}\n"
  );
}

// PROMPTS (required) — maps YAML persona.prompt keys to template string or callable
export const PROMPTS = {
  researcher_system: RESEARCHER_SYSTEM, // persona.prompt: researcher_system
  analyst_system: analystSystem, // persona.prompt: analyst_system
  supervisor_system: SUPERVISOR_SYSTEM, // persona.prompt: supervisor_system
};
