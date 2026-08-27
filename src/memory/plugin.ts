/** Built-in memory tool plugin. */

import {
  defaultMemoryConfig,
  type MemoryConfig,
} from "../config/memory.js";
import type { RunContext } from "../tools/context.js";
import { tool, toolPlugin } from "../tools/decorators.js";
import {
  resolveCrossSessionNamespace,
  type CrossSessionMemoryStore,
} from "./cross-session-store.js";
import type { MemoryProvider } from "./provider.js";

export const PENDING_STORE = "pending";

@toolPlugin("memory")
export class MemoryPlugin {
  protected readonly store: CrossSessionMemoryStore | null;
  protected readonly config: MemoryConfig;
  protected readonly agentName: string;
  protected readonly provider: MemoryProvider | null;

  constructor(
    store?: CrossSessionMemoryStore | null,
    config?: MemoryConfig,
    agentName = "",
    provider?: MemoryProvider | null,
  ) {
    this.store = store ?? null;
    this.config = { ...defaultMemoryConfig(), ...config };
    this.agentName = agentName;
    this.provider = provider ?? null;
  }

  protected namespace(storeName = ""): string {
    const base = resolveCrossSessionNamespace(
      this.config.namespace ?? "",
      this.agentName,
    );
    if (storeName && storeName !== "default") return `${base}:${storeName}`;
    return base;
  }

  protected writeStore(store: string): string {
    if (this.config.require_approval && store !== PENDING_STORE) {
      return PENDING_STORE;
    }
    return store;
  }

  @tool({ name: "write", description: "Save a durable fact about the user into memory." })
  async write(
    key: string,
    value: string,
    store = "default",
    ctx?: RunContext | null,
  ): Promise<string> {
    if (!ctx?.userId || ctx.shouldPersist === false) {
      return JSON.stringify({
        ok: false,
        error: "memory write skipped (no user / non-persistable)",
      });
    }
    const target = this.writeStore(store);
    if (this.provider) {
      await this.provider.write(ctx, key, value, target);
      return JSON.stringify({ ok: true, store: target, key });
    }
    if (!this.store) {
      return JSON.stringify({ ok: false, error: "memory store not configured" });
    }
    const ns = this.namespace(target);
    await this.store.mergeEntities(
      ctx.tenantId,
      ctx.userId,
      ns,
      { [key]: value },
      { maxEntities: this.config.max_entities ?? 100, companyId: ctx.companyId },
    );
    return JSON.stringify({ ok: true, store: target, key });
  }

  @tool({ name: "remove", description: "Remove a memory fact by key." })
  async remove(
    key: string,
    store = "default",
    ctx?: RunContext | null,
  ): Promise<string> {
    if (!ctx?.userId || ctx.shouldPersist === false) {
      return JSON.stringify({ ok: false, error: "memory remove skipped" });
    }
    if (this.provider) {
      await this.provider.remove(ctx, key, store);
      return JSON.stringify({ ok: true, store, key });
    }
    if (!this.store) {
      return JSON.stringify({ ok: false, error: "memory store not configured" });
    }
    const ns = this.namespace(store);
    const record = await this.store.load(ctx.tenantId, ctx.userId, ns, {
      companyId: ctx.companyId,
    });
    if (!record || !(key in record.entityMemory)) {
      return JSON.stringify({ ok: false, error: "key not found" });
    }
    delete record.entityMemory[key];
    await this.store.save(record, { companyId: ctx.companyId });
    return JSON.stringify({ ok: true, store, key });
  }

  @tool({ name: "list", description: "List memory facts in a store." })
  async listFacts(store = "default", ctx?: RunContext | null): Promise<string> {
    if (!ctx?.userId) {
      return JSON.stringify({ ok: true, entries: {} });
    }
    if (this.provider) {
      const hits = await this.provider.search(
        ctx,
        "",
        this.config.max_entities ?? 100,
      );
      const entries: Record<string, string> = {};
      for (const h of hits) {
        const s = String(h.store ?? store);
        if (s === store || s === "default" || store === "default") {
          entries[String(h.key)] = String(h.value);
        }
      }
      return JSON.stringify({ ok: true, store, entries });
    }
    if (!this.store) {
      return JSON.stringify({ ok: true, entries: {} });
    }
    const record = await this.store.load(
      ctx.tenantId,
      ctx.userId,
      this.namespace(store),
      { companyId: ctx.companyId },
    );
    const entries = record ? { ...record.entityMemory } : {};
    return JSON.stringify({ ok: true, store, entries });
  }

  @tool({ name: "search", description: "Search memory facts by substring query." })
  async search(
    query: string,
    store = "default",
    k = 5,
    ctx?: RunContext | null,
  ): Promise<string> {
    if (!ctx?.userId) {
      return JSON.stringify({ ok: true, matches: [] });
    }
    if (this.provider) {
      let matches = await this.provider.search(ctx, query, k);
      if (store !== "default") {
        matches = matches.filter((m) => (m.store ?? store) === store);
      }
      return JSON.stringify({ ok: true, store, matches });
    }
    if (!this.store) {
      return JSON.stringify({ ok: true, matches: [] });
    }
    const record = await this.store.load(
      ctx.tenantId,
      ctx.userId,
      this.namespace(store),
      { companyId: ctx.companyId },
    );
    if (!record) {
      return JSON.stringify({ ok: true, matches: [] });
    }
    const q = query.toLowerCase();
    const matches = Object.entries(record.entityMemory)
      .filter(
        ([key, value]) =>
          key.toLowerCase().includes(q) || value.toLowerCase().includes(q),
      )
      .slice(0, k)
      .map(([key, value]) => ({ key, value }));
    return JSON.stringify({ ok: true, store, matches });
  }
}

@toolPlugin("memory")
export class HITLMemoryPlugin extends MemoryPlugin {
  @tool({ name: "approve", description: "Approve a pending memory fact." })
  async approve(
    key: string,
    store = "default",
    ctx?: RunContext | null,
  ): Promise<string> {
    const pending = await this.loadEntries(PENDING_STORE, ctx);
    if (!(key in pending)) {
      return JSON.stringify({ ok: false, error: "pending key not found" });
    }
    const value = pending[key]!;
    if (this.provider && ctx) {
      await this.provider.write(ctx, key, value, store);
      await this.provider.remove(ctx, key, PENDING_STORE);
    } else {
      await this.writeKv(store, key, value, ctx);
      await this.deleteKv(PENDING_STORE, key, ctx);
    }
    return JSON.stringify({ ok: true, store, key });
  }

  protected async loadEntries(
    store: string,
    ctx?: RunContext | null,
  ): Promise<Record<string, string>> {
    if (!ctx?.userId) return {};
    if (this.provider) {
      const hits = await this.provider.search(
        ctx,
        "",
        this.config.max_entities ?? 100,
      );
      const out: Record<string, string> = {};
      for (const h of hits) {
        if (h.store === store) out[String(h.key)] = String(h.value);
      }
      return out;
    }
    if (!this.store) return {};
    const record = await this.store.load(
      ctx.tenantId,
      ctx.userId,
      this.namespace(store),
      { companyId: ctx.companyId },
    );
    return record ? { ...record.entityMemory } : {};
  }

  protected async writeKv(
    store: string,
    key: string,
    value: string,
    ctx?: RunContext | null,
  ): Promise<void> {
    if (!ctx?.userId || !this.store) return;
    await this.store.mergeEntities(
      ctx.tenantId,
      ctx.userId,
      this.namespace(store),
      { [key]: value },
      { maxEntities: this.config.max_entities ?? 100, companyId: ctx.companyId },
    );
  }

  protected async deleteKv(
    store: string,
    key: string,
    ctx?: RunContext | null,
  ): Promise<void> {
    if (!ctx?.userId || !this.store) return;
    const record = await this.store.load(
      ctx.tenantId,
      ctx.userId,
      this.namespace(store),
      { companyId: ctx.companyId },
    );
    if (!record || !(key in record.entityMemory)) return;
    delete record.entityMemory[key];
    await this.store.save(record, { companyId: ctx.companyId });
  }
}

export function createMemoryPlugin(
  store: CrossSessionMemoryStore | null | undefined,
  config: MemoryConfig,
  agentName = "",
  provider?: MemoryProvider | null,
): MemoryPlugin {
  const Cls = config.require_approval ? HITLMemoryPlugin : MemoryPlugin;
  return new Cls(store, config, agentName, provider);
}
