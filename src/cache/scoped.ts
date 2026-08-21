/** Scope-keyed caching hooks. */

import { createHash } from "node:crypto";
import { ScopeLevel, scopeKey } from "../scope.js";
import type { RunContext } from "../tools/context.js";

export class ScopedCache {
  private readonly store = new Map<string, [number, unknown]>();

  constructor(private readonly ttlSeconds = 300) {}

  private key(ctx: RunContext, namespace: string, payload: unknown): string {
    const digest = createHash("sha256")
      .update(stableStringify(payload))
      .digest("hex")
      .slice(0, 16);
    return `${scopeKey(ctx, ScopeLevel.User, namespace)}:${digest}`;
  }

  get(ctx: RunContext, namespace: string, payload: unknown): unknown | null {
    const k = this.key(ctx, namespace, payload);
    const entry = this.store.get(k);
    if (!entry) return null;
    const [ts, value] = entry;
    if (Date.now() / 1000 - ts > this.ttlSeconds) {
      this.store.delete(k);
      return null;
    }
    return value;
  }

  set(
    ctx: RunContext,
    namespace: string,
    payload: unknown,
    value: unknown,
  ): void {
    this.store.set(this.key(ctx, namespace, payload), [Date.now() / 1000, value]);
  }
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}
