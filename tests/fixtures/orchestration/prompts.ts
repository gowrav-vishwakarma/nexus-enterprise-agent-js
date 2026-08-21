/** Prompt registry used by orchestration YAML fixtures (ported from Python basic_prompts.py). */

export const RESEARCHER_SYSTEM = `You are a {{ role }} focused on {{ domain }}.
{% if tenant_id %}Tenant: {{ tenant_id }}{% endif %}
Goal: {{ goal }}
`;

export function analystSystem(ctx: Record<string, unknown> = {}): string {
  const domain = typeof ctx.domain === "string" ? ctx.domain : "general";
  return (
    `You are an analyst for ${domain}.\n` +
    "{% if tenant_id %}Tenant={{ tenant_id }}{% endif %}\n" +
    "Goal: {{ goal }}\n"
  );
}

export const PROMPTS = {
  researcher_system: RESEARCHER_SYSTEM,
  analyst_system: analystSystem,
};
