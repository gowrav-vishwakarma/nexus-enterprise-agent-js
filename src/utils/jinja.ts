/** Nunjucks template rendering for system prompts. */

import nunjucks from "nunjucks";

const env = new nunjucks.Environment(null, { autoescape: false });

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
}

/** Make a plain object iterable the Jinja2 way: `{% for k, v in obj.items() %}`. */
function withItems<T extends Record<string, unknown>>(obj: T): T & { items: () => Array<[string, unknown]> } {
  return Object.assign(Object.create(null), obj, {
    items(): Array<[string, unknown]> {
      return Object.entries(obj);
    },
  }) as T & { items: () => Array<[string, unknown]> };
}

function field(obj: Record<string, unknown> | null | undefined, camel: string, snake: string): unknown {
  if (!obj) {
    return undefined;
  }
  if (obj[camel] !== undefined) {
    return obj[camel];
  }
  return obj[snake];
}

export interface SystemPromptRenderOptions {
  persona?: Record<string, unknown>;
  userMemory?: Record<string, string> | null;
  user_memory?: Record<string, string> | null;
  summaryText?: string;
  summary_text?: string;
  currentDate?: string;
  current_date?: string;
  template?: string | null;
  runContext?: unknown;
  run_context?: unknown;
  session?: unknown;
  extraVars?: Record<string, unknown> | null;
  extra_vars?: Record<string, unknown> | null;
}

export function buildSystemPromptRenderVars(
  persona: Record<string, unknown>,
  options: SystemPromptRenderOptions = {},
): Record<string, unknown> {
  const userMemory = options.userMemory ?? options.user_memory ?? {};
  let promptArgs = field(persona, "promptArgs", "prompt_args");
  if (typeof promptArgs !== "object" || promptArgs == null) {
    promptArgs = {};
  }

  const runContext = asRecord(options.runContext ?? options.run_context);
  const session = asRecord(options.session);

  let tenantId = field(runContext, "tenantId", "tenant_id") as string | null | undefined;
  let userId = field(runContext, "userId", "user_id") as string | null | undefined;
  let sessionId = field(runContext, "sessionId", "session_id") as string | null | undefined;
  const requestId = field(runContext, "requestId", "request_id") as string | null | undefined;
  const metadata = asRecord(runContext?.metadata) ?? {};

  let state: Record<string, unknown> = {};
  if (runContext?.state && typeof runContext.state === "object") {
    state = { ...(runContext.state as Record<string, unknown>) };
  } else if (session?.state && typeof session.state === "object") {
    state = { ...(session.state as Record<string, unknown>) };
  }

  if (session) {
    tenantId = tenantId ?? (field(session, "tenantId", "tenant_id") as string | null | undefined);
    userId = userId ?? (field(session, "userId", "user_id") as string | null | undefined);
    sessionId = sessionId ?? (field(session, "sessionId", "session_id") as string | null | undefined);
  }

  const renderVars: Record<string, unknown> = {
    persona,
    role: persona.role,
    goal: persona.goal,
    backstory: persona.backstory,
    prompt_args: promptArgs,
    promptArgs,
    tenant_id: tenantId,
    tenantId,
    user_id: userId,
    userId,
    session_id: sessionId,
    sessionId,
    request_id: requestId,
    requestId,
    metadata: withItems(metadata),
    state: withItems(state),
    user_memory: Object.keys(userMemory).length ? withItems(userMemory) : null,
    userMemory: Object.keys(userMemory).length ? withItems(userMemory) : null,
    summary_text: options.summaryText ?? options.summary_text ?? "",
    summaryText: options.summaryText ?? options.summary_text ?? "",
    current_date: options.currentDate ?? options.current_date ?? "",
    currentDate: options.currentDate ?? options.current_date ?? "",
    ...(promptArgs as Record<string, unknown>),
  };

  const extra = options.extraVars ?? options.extra_vars;
  if (extra) {
    Object.assign(renderVars, extra);
  }

  return renderVars;
}

export function renderSystemPrompt(
  personaOrOptions: Record<string, unknown> | SystemPromptRenderOptions,
  options: SystemPromptRenderOptions = {},
): string {
  const objectFirst =
    personaOrOptions &&
    typeof personaOrOptions === "object" &&
    ("persona" in personaOrOptions ||
      "template" in personaOrOptions ||
      "userMemory" in personaOrOptions ||
      "runContext" in personaOrOptions);

  const persona = objectFirst
    ? ((personaOrOptions as SystemPromptRenderOptions).persona ?? {})
    : (personaOrOptions as Record<string, unknown>);
  const opts = objectFirst
    ? { ...(personaOrOptions as SystemPromptRenderOptions), ...options }
    : options;

  const tmplStr =
    opts.template ??
    (typeof persona.system_prompt === "string" ? persona.system_prompt : null) ??
    (typeof persona.systemPrompt === "string" ? persona.systemPrompt : null) ??
    (typeof persona.system_prompt_template === "string" ? persona.system_prompt_template : null) ??
    (typeof persona.systemPromptTemplate === "string" ? persona.systemPromptTemplate : "") ??
    "";

  const renderVars = buildSystemPromptRenderVars(persona, opts);
  return env.renderString(tmplStr, renderVars);
}
