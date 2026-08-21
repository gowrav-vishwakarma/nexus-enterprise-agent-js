/** Built-in semantic memory provider wrapping CrossSessionMemoryStore. */

import {
  defaultMemoryConfig,
  type MemoryConfig,
} from "../../config/memory.js";
import type { RunContext } from "../../tools/context.js";
import {
  resolveCrossSessionNamespace,
  type CrossSessionMemoryStore,
} from "../cross-session-store.js";
import type { MemoryProvider } from "../provider.js";

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean),
  );
}

export class BuiltInSemanticMemoryProvider implements MemoryProvider {
  private readonly store: CrossSessionMemoryStore;
  private readonly config: MemoryConfig;
  private readonly agentName: string;

  constructor(
    store: CrossSessionMemoryStore | null | undefined,
    config?: MemoryConfig,
    opts: { agentName?: string } = {},
  ) {
    if (!store) {
      throw new Error(
        "BuiltInSemanticMemoryProvider requires a CrossSessionMemoryStore",
      );
    }
    this.store = store;
    this.config = { ...defaultMemoryConfig(), ...config };
    this.agentName = opts.agentName ?? "";
  }

  private baseNamespace(): string {
    return resolveCrossSessionNamespace(
      this.config.namespace ?? "",
      this.agentName,
    );
  }

  private namespace(store = "default"): string {
    const base = this.baseNamespace();
    if (store && store !== "default") return `${base}:${store}`;
    return base;
  }

  private storeNames(): string[] {
    const names = this.config.stores?.map((s: { name: string }) => s.name) ?? ["default"];
    if (this.config.require_approval && !names.includes("pending")) {
      return [...names, "pending"];
    }
    return names;
  }

  async prefetch(ctx: RunContext): Promise<Record<string, string>> {
    if (!ctx.userId) return {};
    const stores = this.config.stores ?? [];
    if (stores.length === 0) {
      const record = await this.store.load(
        ctx.tenantId,
        ctx.userId,
        this.namespace("default"),
      );
      return record ? { ...record.entityMemory } : {};
    }
    const always = stores.filter((s: { name: string; inject?: string }) => (s.inject ?? "always") === "always");
    const multi = always.length > 1;
    const merged: Record<string, string> = {};
    for (const storeCfg of always) {
      const record = await this.store.load(
        ctx.tenantId,
        ctx.userId,
        this.namespace(storeCfg.name),
      );
      if (!record?.entityMemory) continue;
      for (const [key, value] of Object.entries(record.entityMemory)) {
        const outKey = multi ? `${storeCfg.name}/${key}` : key;
        merged[outKey] = String(value);
      }
    }
    return merged;
  }

  async search(
    ctx: RunContext,
    query: string,
    k = 5,
  ): Promise<Array<Record<string, unknown>>> {
    if (!ctx.userId) return [];
    const qTokens = tokens(query);
    const qLower = query.toLowerCase();
    const matches: Array<[number, Record<string, unknown>]> = [];
    for (const name of this.storeNames()) {
      const record = await this.store.load(
        ctx.tenantId,
        ctx.userId,
        this.namespace(name),
      );
      if (!record) continue;
      for (const [key, value] of Object.entries(record.entityMemory)) {
        const blob = `${key} ${value}`;
        const overlap = qTokens.size
          ? [...qTokens].filter((t) => tokens(blob).has(t)).length
          : 0;
        const substring = blob.toLowerCase().includes(qLower) ? 1 : 0;
        const score = overlap + substring;
        if (score) matches.push([score, { key, value, store: name }]);
      }
    }
    matches.sort((a, b) => b[0] - a[0]);
    return matches.slice(0, k).map(([, item]) => item);
  }

  async write(
    ctx: RunContext,
    key: string,
    value: string,
    store = "default",
  ): Promise<void> {
    if (!ctx.userId) return;
    await this.store.mergeEntities(
      ctx.tenantId,
      ctx.userId,
      this.namespace(store),
      { [key]: value },
      { maxEntities: this.config.max_entities ?? 100 },
    );
  }

  async remove(
    ctx: RunContext,
    key: string,
    store = "default",
  ): Promise<void> {
    if (!ctx.userId) return;
    const record = await this.store.load(
      ctx.tenantId,
      ctx.userId,
      this.namespace(store),
    );
    if (!record || !(key in record.entityMemory)) return;
    delete record.entityMemory[key];
    await this.store.save(record);
  }

  async listStores(_ctx: RunContext): Promise<string[]> {
    return this.storeNames();
  }

  async curate(ctx: RunContext, turnSummary: string): Promise<Record<string, string>> {
    if (!turnSummary.trim() || !ctx.userId) return {};
    const facts = { last_turn: turnSummary.slice(0, 500) };
    let store = this.config.require_approval ? "pending" : "default";
    if (this.config.stores?.length && store !== "pending") {
      store = this.config.stores[0]!.name;
    }
    await this.write(ctx, "last_turn", facts.last_turn!, store);
    return facts;
  }
}
