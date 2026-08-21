/** Unified scope primitive for tenant / company / user / global resources. */

import { SessionScopeImpl, type SessionScope } from "./session/scope.js";
import type { RunContext } from "./tools/context.js";

export enum ScopeLevel {
  Global = "global",
  GLOBAL = "global",
  Tenant = "tenant",
  TENANT = "tenant",
  Company = "company",
  COMPANY = "company",
  User = "user",
  USER = "user",
}

const SCOPE_FIELD_ORDER: Array<[ScopeLevel, string, string]> = [
  [ScopeLevel.Tenant, "tenantId", "tenant_id"],
  [ScopeLevel.Company, "companyId", "company_id"],
  [ScopeLevel.User, "userId", "user_id"],
];

const MISSING = "_";

function contextField(ctx: RunContext, camel: string, snake: string): unknown {
  const rec = ctx as unknown as Record<string, unknown>;
  return rec[camel] ?? rec[snake];
}

export function scopeKey(
  ctx: RunContext,
  level: ScopeLevel,
  namespace = "",
): string {
  let base: string;
  if (level === ScopeLevel.Global) {
    base = "global";
  } else {
    const segments: string[] = [];
    for (const [scopeLevel, camel, snake] of SCOPE_FIELD_ORDER) {
      const value = contextField(ctx, camel, snake);
      const text = value != null ? String(value).trim() : "";
      segments.push(scopeLevel, text || MISSING);
      if (scopeLevel === level) {
        break;
      }
    }
    base = segments.join(":");
  }
  return namespace ? `${base}:${namespace}` : base;
}

export function scopeFromKeys(keys: string[]): ScopeLevel {
  if (keys.length === 0) {
    return ScopeLevel.Global;
  }
  if (keys.includes("userId") || keys.includes("user_id")) {
    return ScopeLevel.User;
  }
  if (keys.includes("companyId") || keys.includes("company_id")) {
    return ScopeLevel.Company;
  }
  if (keys.includes("tenantId") || keys.includes("tenant_id")) {
    return ScopeLevel.Tenant;
  }
  return ScopeLevel.Global;
}

export function sessionScopeFromLevel(ctx: RunContext, level: ScopeLevel): SessionScope {
  if (level === ScopeLevel.Global) {
    return new SessionScopeImpl();
  }
  return new SessionScopeImpl({
    tenantId:
      level === ScopeLevel.Tenant ||
      level === ScopeLevel.Company ||
      level === ScopeLevel.User
        ? (contextField(ctx, "tenantId", "tenant_id") as string | null | undefined) ??
          null
        : null,
    companyId:
      level === ScopeLevel.Company || level === ScopeLevel.User
        ? (contextField(ctx, "companyId", "company_id") as string | null | undefined) ??
          null
        : null,
    userId:
      level === ScopeLevel.User
        ? (contextField(ctx, "userId", "user_id") as string | null | undefined) ?? null
        : null,
  });
}

export function scopeKeysFromConfig(
  keys: string[],
  ctx: RunContext,
  namespace = "",
): string {
  if (keys.length === 0) {
    return scopeKey(ctx, ScopeLevel.Global, namespace);
  }
  const parts: string[] = [];
  for (const key of keys) {
    const value = (ctx as unknown as Record<string, unknown>)[key];
    if (value != null && String(value).trim()) {
      parts.push(key, String(value).trim());
    }
  }
  const base = parts.length > 0 ? parts.join(":") : "global";
  return namespace ? `${base}:${namespace}` : base;
}
