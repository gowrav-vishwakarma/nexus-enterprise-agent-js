import { describe, expect, it } from "vitest";
import { parseMemoryConfig } from "../src/config/memory.js";
import { InMemoryCrossSessionMemoryStore } from "../src/memory/cross-session-store.js";
import { HITLMemoryPlugin, createMemoryPlugin } from "../src/memory/plugin.js";
import { BuiltInSemanticMemoryProvider } from "../src/memory/providers/builtin-semantic.js";
import { createRunContext } from "../src/tools/context.js";
import { ToolRegistry } from "../src/tools/registry.js";

describe("HITL memory approval", () => {
  // PYTHON: test_require_approval_hides_pending_from_prefetch
  it("hides pending writes from prefetch until approved", async () => {
    const store = new InMemoryCrossSessionMemoryStore();
    const config = parseMemoryConfig({
      enabled: true,
      namespace: "bot",
      require_approval: true,
      expose_tools: true,
    });
    const provider = new BuiltInSemanticMemoryProvider(store, config, { agentName: "bot" });
    const ctx = createRunContext({ tenantId: "t", userId: "u", persistable: true });
    const plugin = createMemoryPlugin(store, config, "bot", provider);
    expect(plugin).toBeInstanceOf(HITLMemoryPlugin);
    const raw = await plugin.write("name", "Ada", "default", ctx);
    expect(JSON.parse(raw).store).toBe("pending");
    expect(await provider.prefetch(ctx)).toEqual({});
    const pendingHits = await provider.search(ctx, "Ada", 5);
    expect(pendingHits.some((h) => h.store === "pending")).toBe(true);
  });

  // PYTHON: test_approve_moves_fact_to_injectable_store
  it("moves an approved fact into the injectable store", async () => {
    const store = new InMemoryCrossSessionMemoryStore();
    const config = parseMemoryConfig({
      enabled: true,
      namespace: "bot",
      require_approval: true,
      expose_tools: true,
    });
    const provider = new BuiltInSemanticMemoryProvider(store, config, { agentName: "bot" });
    const ctx = createRunContext({ tenantId: "t", userId: "u", persistable: true });
    const plugin = new HITLMemoryPlugin(store, config, "bot", provider);
    await plugin.write("city", "Paris", "default", ctx);
    // JS HITL plugin has no edit(); write again to pending to stand in for the edit step.
    await plugin.write("city", "Lyon", "default", ctx);
    const approved = JSON.parse(await plugin.approve("city", "default", ctx));
    expect(approved.ok).toBe(true);
    const facts = await provider.prefetch(ctx);
    expect(facts.city).toBe("Lyon");
  });

  // PYTHON: test_reject_drops_pending_fact
  // JS HITL plugin has no reject(); drop the pending key via the provider.
  it("drops a pending fact when removed from the pending store", async () => {
    const store = new InMemoryCrossSessionMemoryStore();
    const config = parseMemoryConfig({ enabled: true, namespace: "bot", require_approval: true });
    const provider = new BuiltInSemanticMemoryProvider(store, config, { agentName: "bot" });
    const ctx = createRunContext({ tenantId: "t", userId: "u", persistable: true });
    const plugin = new HITLMemoryPlugin(store, config, "bot", provider);
    await plugin.write("temp", "nope", "default", ctx);
    await provider.remove(ctx, "temp", "pending");
    expect(await provider.prefetch(ctx)).toEqual({});
    const hits = await provider.search(ctx, "nope", 5);
    expect(hits.some((h) => h.store === "pending" && h.key === "temp")).toBe(false);
  });

  // PYTHON: test_hitl_tools_registered_only_when_required
  it("registers approve tools only when require_approval is set", () => {
    const store = new InMemoryCrossSessionMemoryStore();
    const off = createMemoryPlugin(store, parseMemoryConfig({ require_approval: false }), "a");
    const on = createMemoryPlugin(store, parseMemoryConfig({ require_approval: true }), "a");
    const registryOff = new ToolRegistry();
    const registryOn = new ToolRegistry();
    registryOff.registerPlugin(off);
    registryOn.registerPlugin(on);
    expect(registryOff.has("memory.approve")).toBe(false);
    expect(registryOn.has("memory.approve")).toBe(true);
  });
});
