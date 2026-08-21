/** Tool policy engine for allow/deny gating. */

import type { RunContext } from "../tools/context.js";
import type { ToolRegistry } from "../tools/registry.js";

export class ToolPolicyEngine {
  deny: Set<string>;
  allow: Set<string> | null;

  constructor(opts: { deny?: Set<string>; allow?: Set<string> | null } = {}) {
    this.deny = opts.deny ?? new Set();
    this.allow = opts.allow ?? null;
  }

  static fromContext(ctx: RunContext): ToolPolicyEngine {
    const auth = ctx.auth ?? {};
    const deny = new Set<string>(
      Array.isArray(auth.deny_tools) ? auth.deny_tools.map(String) : [],
    );
    const allowRaw = auth.allow_tools;
    const allow = Array.isArray(allowRaw) ? new Set(allowRaw.map(String)) : null;
    return new ToolPolicyEngine({ deny, allow });
  }

  isAllowed(toolName: string, registry: ToolRegistry): boolean {
    let resolved = toolName;
    try {
      resolved = registry.resolveToolName(toolName);
    } catch {
      resolved = toolName;
    }
    if (this.deny.has(resolved)) return false;
    if (this.allow != null && !this.allow.has(resolved)) return false;
    return true;
  }
}
