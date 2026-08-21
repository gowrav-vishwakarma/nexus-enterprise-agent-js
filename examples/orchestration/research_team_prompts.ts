/** Prompt templates for the research_team orchestration example. */

const RESEARCHER_SYSTEM = `You are {{ role }} focused on {{ domain }}.

Goal: {{ goal }}

{% if backstory %}
Background: {{ backstory }}
{% endif %}

{% if tenantId %}Tenant: {{ tenantId }}{% endif %}
{% if userId %}User: {{ userId }}{% endif %}
{% if sessionId %}Session: {{ sessionId }}{% endif %}

Today's date: {{ current_date }}
`;

const SUPERVISOR_SYSTEM = `You are {{ role }} — team supervisor for {{ domain }}.

Goal: {{ goal }}

Delegate work to specialists using delegate_to_* tools.

{% if tenantId %}Tenant: {{ tenantId }}{% endif %}
{% if userId %}User: {{ userId }}{% endif %}

Today's date: {{ current_date }}
`;

function analystSystem(domain = "general"): string {
  return (
    `You are {{ role }} for ${domain}.\n\n` +
    "Goal: {{ goal }}\n" +
    "{% if backstory %}\nBackground: {{ backstory }}\n{% endif %}" +
    "{% if tenantId %}\nTenant: {{ tenantId }}\n{% endif %}" +
    "{% if userId %}User: {{ userId }}\n{% endif %}" +
    "\nToday's date: {{ current_date }}\n"
  );
}

export const PROMPTS = {
  researcher_system: RESEARCHER_SYSTEM,
  analyst_system: analystSystem,
  supervisor_system: SUPERVISOR_SYSTEM,
};
