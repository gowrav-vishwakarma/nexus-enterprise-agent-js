/** Prompt module loading and template resolution for orchestration. */

import { pathToFileURL } from "node:url";
import { existsSync, type PathLike } from "node:fs";
import { resolve } from "node:path";
import type { RunContext } from "../tools/context.js";
import { ManifestLoadError, PromptNotFoundError } from "./errors.js";

export type PromptValue = string | ((...args: unknown[]) => string | Promise<string>);

export type PromptRegistry = Record<string, PromptValue>;

function resolvePromptModulePath(modulePath: PathLike): string {
  let loadPath = resolve(String(modulePath));
  if (loadPath.endsWith(".ts")) {
    if (!existsSync(loadPath)) {
      loadPath = loadPath.replace(/\.ts$/, ".js");
    }
  } else if (!loadPath.endsWith(".js")) {
    const tsPath = `${loadPath}.ts`;
    loadPath = existsSync(tsPath) ? tsPath : `${loadPath}.js`;
  }
  return pathToFileURL(loadPath).href;
}

export async function loadPromptsModule(modulePath: PathLike): Promise<PromptRegistry> {
  const href = resolvePromptModulePath(modulePath);
  let mod: Record<string, unknown>;
  try {
    mod = (await import(href)) as Record<string, unknown>;
  } catch (err) {
    throw new ManifestLoadError(`Unable to import prompts module: ${modulePath} (${err})`);
  }

  const prompts = mod.PROMPTS;
  if (!prompts || typeof prompts !== "object" || Array.isArray(prompts)) {
    throw new ManifestLoadError(
      `Prompts module ${modulePath} must define a dict named PROMPTS`,
    );
  }
  return prompts as PromptRegistry;
}

export function buildPromptContext(opts: {
  persona: Record<string, unknown>;
  promptArgs: Record<string, unknown>;
  runContext: RunContext;
}): Record<string, unknown> {
  const { persona, promptArgs, runContext } = opts;
  const ctx = runContext as RunContext & { state?: Record<string, unknown> };
  return {
    role: persona.role,
    goal: persona.goal,
    backstory: persona.backstory,
    tenantId: runContext.tenantId,
    userId: runContext.userId,
    sessionId: runContext.sessionId,
    requestId: runContext.requestId,
    metadata: { ...(runContext.metadata ?? {}) },
    state: { ...(ctx.state ?? {}) },
    ...promptArgs,
  };
}

async function invokePromptCallable(
  fn: (...args: unknown[]) => string | Promise<string>,
  context: Record<string, unknown>,
): Promise<string> {
  const result = await fn(context);
  return result;
}

export async function resolvePromptTemplate(
  prompts: PromptRegistry,
  promptName: string,
  opts: {
    persona: Record<string, unknown>;
    promptArgs?: Record<string, unknown>;
    runContext: RunContext;
  },
): Promise<string> {
  if (!(promptName in prompts)) {
    throw new PromptNotFoundError(promptName, Object.keys(prompts));
  }

  const promptValue = prompts[promptName]!;

  if (typeof promptValue === "function") {
    const context = buildPromptContext({
      persona: opts.persona,
      promptArgs: opts.promptArgs ?? {},
      runContext: opts.runContext,
    });
    return invokePromptCallable(promptValue, context);
  }

  if (typeof promptValue === "string") {
    return promptValue;
  }

  throw new ManifestLoadError(
    `Prompt '${promptName}' must be a string or callable, got ${typeof promptValue}`,
  );
}

export async function resolvePersonaConfig(
  personaData: Record<string, unknown>,
  opts: {
    prompts: PromptRegistry;
    runContext: RunContext;
  },
): Promise<Record<string, unknown>> {
  const persona = { ...personaData };
  const promptName = persona.prompt as string | undefined;
  delete persona.prompt;
  let promptArgs =
    (persona.prompt_args as Record<string, unknown> | undefined) ??
    (persona.promptArgs as Record<string, unknown> | undefined) ??
    {};
  delete persona.prompt_args;
  delete persona.promptArgs;
  if (typeof promptArgs !== "object" || Array.isArray(promptArgs)) {
    promptArgs = {};
  }
  persona.prompt_args = promptArgs;
  persona.promptArgs = promptArgs;

  if (promptName != null) {
    const template = await resolvePromptTemplate(opts.prompts, promptName, {
      persona,
      promptArgs,
      runContext: opts.runContext,
    });
    persona.system_prompt_template = template;
    persona.systemPromptTemplate = template;
  }

  return persona;
}
