/** skill_manage tool plugin for learned SkillStore entries. */

import { SessionScopeImpl } from "../session/scope.js";
import type { RunContext } from "../tools/context.js";
import { tool, toolPlugin } from "../tools/decorators.js";
import type { SkillScopeResolver } from "./scope.js";
import { type SkillRecord, type SkillStore } from "./store.js";

@toolPlugin({ name: "skill_manage" })
export class SkillManagePlugin {
  constructor(
    private readonly store: SkillStore,
    private readonly scopeResolver: SkillScopeResolver,
  ) {}

  private scope(ctx?: RunContext | null) {
    if (!ctx) return new SessionScopeImpl();
    return this.scopeResolver.resolve(ctx);
  }

  @tool({ name: "upsert" })
  async upsert(
    name: string,
    trigger: string,
    content: string,
    ctx?: RunContext | null,
  ): Promise<string> {
    if (ctx && ctx.shouldPersist === false) {
      return JSON.stringify({ ok: true, skipped: true, reason: "non-persistable" });
    }
    const skill: SkillRecord = {
      name,
      trigger,
      content,
      source: ctx?.isSubagent ? "learned" : "manual",
      enabled: true,
      useCount: 0,
      updatedAt: new Date(),
    };
    const saved = await this.store.upsert(this.scope(ctx), skill);
    return JSON.stringify({ ok: true, name: saved.name });
  }

  @tool({ name: "list" })
  async listSkills(
    includeDisabled = false,
    ctx?: RunContext | null,
  ): Promise<string> {
    const skills = await this.store.list(this.scope(ctx), { includeDisabled });
    return JSON.stringify({
      ok: true,
      skills: skills.map((s) => ({
        name: s.name,
        trigger: s.trigger,
        enabled: s.enabled,
        source: s.source,
        useCount: s.useCount,
      })),
    });
  }

  @tool({ name: "delete" })
  async delete(name: string, ctx?: RunContext | null): Promise<string> {
    if (ctx && ctx.shouldPersist === false) {
      return JSON.stringify({ ok: true, skipped: true });
    }
    await this.store.delete(this.scope(ctx), name);
    return JSON.stringify({ ok: true, name });
  }

  @tool({ name: "disable" })
  async disable(name: string, ctx?: RunContext | null): Promise<string> {
    if (ctx && ctx.shouldPersist === false) {
      return JSON.stringify({ ok: true, skipped: true });
    }
    await this.store.disable(this.scope(ctx), name);
    return JSON.stringify({ ok: true, name, enabled: false });
  }
}

export function createSkillManagePlugin(
  store: SkillStore,
  scopeResolver: SkillScopeResolver,
): SkillManagePlugin {
  return new SkillManagePlugin(store, scopeResolver);
}
