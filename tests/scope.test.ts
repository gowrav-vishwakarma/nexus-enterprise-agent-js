import { describe, expect, it } from "vitest";
import { ScopeLevel, scopeKey, scopeKeysFromConfig } from "../src/scope.js";
import { createRunContext } from "../src/tools/context.js";

describe("scopeKey", () => {
  it("includes tenant and user at USER level", () => {
    const ctx = createRunContext({ tenantId: "t1", userId: "u1" });
    const key = scopeKey(ctx, ScopeLevel.USER, "memory");
    expect(key).toContain("tenant");
    expect(key).toContain("t1");
    expect(key).toContain("user");
    expect(key).toContain("u1");
    expect(key).toContain("memory");
  });

  it("keeps levels distinct and isolates tenants", () => {
    const ctxA = createRunContext({ tenantId: "t1", companyId: "c1", userId: "u1" });
    const ctxB = createRunContext({ tenantId: "t2", companyId: "c1", userId: "u1" });
    const keys = [
      ScopeLevel.GLOBAL,
      ScopeLevel.TENANT,
      ScopeLevel.COMPANY,
      ScopeLevel.USER,
    ].map((level) => scopeKey(ctxA, level, "kb"));
    expect(new Set(keys).size).toBe(4);
    expect(scopeKey(ctxA, ScopeLevel.TENANT, "kb")).not.toBe(
      scopeKey(ctxB, ScopeLevel.TENANT, "kb"),
    );
    expect(scopeKey(ctxA, ScopeLevel.GLOBAL, "kb")).toBe(
      scopeKey(ctxB, ScopeLevel.GLOBAL, "kb"),
    );
  });

  it("does not collapse a missing user onto the tenant bucket", () => {
    const ctx = createRunContext({ tenantId: "t1" });
    const userKey = scopeKey(ctx, ScopeLevel.USER, "memory");
    const tenantKey = scopeKey(ctx, ScopeLevel.TENANT, "memory");
    expect(userKey).not.toBe(tenantKey);
    expect(userKey).toContain("user");
  });

  it("builds a key from config field names", () => {
    const ctx = createRunContext({ tenantId: "acme", userId: "pat" });
    const key = scopeKeysFromConfig(["tenant_id", "user_id"], ctx, "rag");
    expect(key).toContain("acme");
    expect(key).toContain("pat");
    expect(key.endsWith(":rag")).toBe(true);
  });
});
