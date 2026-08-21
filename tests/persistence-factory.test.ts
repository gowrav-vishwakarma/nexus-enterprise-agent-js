import { describe, expect, it } from "vitest";
import { parseSessionStorageConfig } from "../src/config/storage.js";
import { PersistenceFactory } from "../src/persistence/factory.js";
import type { PersistenceResolver } from "../src/persistence/resolver.js";

class StaticResolver implements PersistenceResolver {
  resolveStorageConfig() {
    return parseSessionStorageConfig({
      adapter: "memory",
      adapter_config: { max_sessions: 100 },
    });
  }

  resolveBundle() {
    return null;
  }
}

class PerTenantResolver implements PersistenceResolver {
  resolveStorageConfig(tenantId?: string | null) {
    if (tenantId === "tenant-a") {
      return parseSessionStorageConfig({
        adapter: "memory",
        adapter_config: { max_sessions: 10 },
      });
    }
    return parseSessionStorageConfig({
      adapter: "memory",
      adapter_config: { max_sessions: 20 },
    });
  }

  resolveBundle() {
    return null;
  }
}

describe("PersistenceFactory", () => {
  // PYTHON: test_from_storage_config_memory
  it("builds an in-memory bundle from storage config", async () => {
    const bundle = await PersistenceFactory.fromStorageConfig(
      parseSessionStorageConfig({ adapter: "memory" }),
    );
    const session = await bundle.sessionManager.createSession("a1");
    expect(session.agentId).toBe("a1");
    const record = await bundle.crossSessionMemoryStore.mergeEntities("t1", "u1", "ns", { k: "v" }, {
      maxEntities: 10,
    });
    expect(record.entityMemory.k).toBe("v");
  });

  // PYTHON: test_from_resolver
  it("builds a bundle from a resolver", async () => {
    const bundle = await PersistenceFactory.fromResolver(new StaticResolver(), "t1", "u1");
    const session = await bundle.sessionManager.createSession("a1");
    expect(session).toBeTruthy();
  });

  // PYTHON: test_per_tenant_resolver_config
  it("resolves per-tenant storage config", () => {
    const resolver = new PerTenantResolver();
    const cfgA = resolver.resolveStorageConfig("tenant-a", "u1");
    const cfgB = resolver.resolveStorageConfig("tenant-b", "u1");
    expect(cfgA.adapter_config.max_sessions).toBe(10);
    expect(cfgB.adapter_config.max_sessions).toBe(20);
  });

  // PYTHON: test_resolver_is_protocol
  it("treats the resolver as a structural protocol", () => {
    const resolver: PersistenceResolver = new StaticResolver();
    expect(typeof resolver.resolveStorageConfig).toBe("function");
    expect(typeof resolver.resolveBundle).toBe("function");
  });
});
