/** Skill scope resolver. */

import { SessionScopeImpl, type SessionScope } from "../session/scope.js";
import type { RunContext } from "../tools/context.js";
import { importFromPath } from "../orchestration/imports.js";

export interface SkillScopeConfig {
  keys?: string[];
  resolverClass?: string | null;
}

export interface SkillScopeResolver {
  resolve(ctx: RunContext): SessionScope;
}

export class KeysSkillScopeResolver implements SkillScopeResolver {
  constructor(private readonly keys: string[]) {}

  resolve(ctx: RunContext): SessionScope {
    const data: Record<string, unknown> = {};
    for (const field of this.keys) {
      data[field] = (ctx as unknown as Record<string, unknown>)[field];
    }
    return new SessionScopeImpl({
      tenantId: data.tenantId as string | null,
      companyId: data.companyId as string | null,
      userId: data.userId as string | null,
    });
  }
}

export function buildSkillScopeResolver(
  config: SkillScopeConfig,
): SkillScopeResolver {
  if (config.resolverClass) {
    throw new Error(
      "resolverClass requires buildSkillScopeResolverAsync() because imports are async",
    );
  }
  return new KeysSkillScopeResolver(
    config.keys ?? ["tenantId", "companyId", "userId"],
  );
}

export async function buildSkillScopeResolverAsync(
  config: SkillScopeConfig,
): Promise<SkillScopeResolver> {
  if (config.resolverClass) {
    return (await importFromPath(config.resolverClass)) as SkillScopeResolver;
  }
  return buildSkillScopeResolver(config);
}
