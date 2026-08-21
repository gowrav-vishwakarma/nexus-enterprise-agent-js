import { describe, expect, it } from "vitest";
import { parseMemoryConfig } from "../src/config/memory.js";
import { InMemoryCrossSessionMemoryStore } from "../src/memory/cross-session-store.js";
import { BuiltInSemanticMemoryProvider } from "../src/memory/providers/builtin-semantic.js";
import { createRunContext } from "../src/tools/context.js";

describe("BuiltInSemanticMemoryProvider", () => {
  // PYTHON: test_write_prefetch_search_remove
  it("writes, prefetches, searches, and removes facts", async () => {
    const store = new InMemoryCrossSessionMemoryStore();
    const provider = new BuiltInSemanticMemoryProvider(
      store,
      parseMemoryConfig({
        enabled: true,
        namespace: "agent",
        stores: [{ name: "default", inject: "always" }],
      }),
      { agentName: "agent" },
    );
    const ctx = createRunContext({ tenantId: "acme", userId: "u1", companyId: "co1" });
    await provider.write(ctx, "name", "Ada Lovelace");
    await provider.write(ctx, "city", "London");
    let facts = await provider.prefetch(ctx);
    expect(facts.name).toBe("Ada Lovelace");
    const hits = await provider.search(ctx, "Ada", 5);
    expect(hits.some((h) => h.key === "name")).toBe(true);
    await provider.remove(ctx, "city");
    facts = await provider.prefetch(ctx);
    expect(facts).not.toHaveProperty("city");
  });

  // PYTHON: test_tenant_isolation
  it("isolates facts by tenant", async () => {
    const store = new InMemoryCrossSessionMemoryStore();
    const provider = new BuiltInSemanticMemoryProvider(
      store,
      parseMemoryConfig({ namespace: "n" }),
      { agentName: "n" },
    );
    const a = createRunContext({ tenantId: "a", userId: "u1" });
    const b = createRunContext({ tenantId: "b", userId: "u1" });
    await provider.write(a, "secret", "alpha-only");
    await provider.write(b, "secret", "beta-only");
    expect((await provider.prefetch(a)).secret).toBe("alpha-only");
    expect((await provider.prefetch(b)).secret).toBe("beta-only");
    expect((await provider.search(a, "secret")).every((h) => !String(h.value).includes("beta"))).toBe(
      true,
    );
  });

  // PYTHON: test_named_stores_prefetch_always_only
  it("prefetches inject=always stores and searches on_recall stores", async () => {
    const store = new InMemoryCrossSessionMemoryStore();
    const provider = new BuiltInSemanticMemoryProvider(
      store,
      parseMemoryConfig({
        enabled: true,
        namespace: "bot",
        stores: [
          { name: "user", inject: "always" },
          { name: "notes", inject: "on_recall" },
        ],
      }),
      { agentName: "bot" },
    );
    const ctx = createRunContext({ tenantId: "t", userId: "u" });
    await provider.write(ctx, "role", "cfo", "user");
    await provider.write(ctx, "draft", "hidden note", "notes");
    const facts = await provider.prefetch(ctx);
    expect("role" in facts || "user/role" in facts).toBe(true);
    expect(facts).not.toHaveProperty("draft");
    expect(facts).not.toHaveProperty("notes/draft");
    const hits = await provider.search(ctx, "hidden", 5);
    expect(hits.some((h) => h.key === "draft")).toBe(true);
  });
});
