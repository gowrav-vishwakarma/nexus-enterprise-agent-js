/** Persistence factory for session + cross-session memory wiring. */

import type { MemoryConfig } from "../config/memory.js";
import type { SessionStorageConfig } from "../config/storage.js";
import { buildMemoryProvider } from "../memory/factory.js";
import {
  InMemoryCrossSessionMemoryStore,
  type CrossSessionMemoryStore,
} from "../memory/cross-session-store.js";
import type { MemoryProvider } from "../memory/provider.js";
import { importFromPath } from "../orchestration/imports.js";
import { buildRagProvider } from "../rag/factory.js";
import type { RAGConfig } from "../rag/config.js";
import type { RAGProvider } from "../rag/protocol.js";
import type { StorageAdapter } from "../session/adapters/base.js";
import { createAdapterFromConfig, SessionManager } from "../session/manager.js";
import type { PersistenceResolver } from "./resolver.js";

export interface PersistenceBundle {
  sessionManager: SessionManager;
  crossSessionMemoryStore: CrossSessionMemoryStore;
}

export class PersistenceFactory {
  static async createSessionAdapter(config: SessionStorageConfig): Promise<StorageAdapter> {
    return createAdapterFromConfig(config);
  }

  static async createCrossSessionStore(
    config: SessionStorageConfig,
    _opts: { sessionAdapter?: StorageAdapter | null } = {},
  ): Promise<CrossSessionMemoryStore> {
    const cfg = { ...(config.adapter_config ?? {}) };
    if (config.custom_memory_adapter_class) {
      return loadCustomMemoryStore(config.custom_memory_adapter_class, cfg);
    }
    const adapterType = config.adapter || "memory";
    if (adapterType !== "memory") {
      console.warn(
        `Cross-session store for adapter '${adapterType}' is not implemented yet; using in-memory store`,
      );
    }
    return new InMemoryCrossSessionMemoryStore();
  }

  static async createRagProvider(
    ragConfig: RAGConfig,
    opts: { sessionAdapter?: StorageAdapter | null } = {},
  ): Promise<RAGProvider> {
    const extra: Record<string, unknown> = {};
    const sessionAdapter = opts.sessionAdapter as
      | (StorageAdapter & { pool?: unknown; dsn?: string })
      | null
      | undefined;
    if (sessionAdapter && ragConfig.provider === "pgvector") {
      if (sessionAdapter.pool != null) extra.pool = sessionAdapter.pool;
      if (sessionAdapter.dsn) extra.dsn = sessionAdapter.dsn;
    }
    return buildRagProvider(ragConfig, extra);
  }

  static async createMemoryProvider(
    memoryConfig: MemoryConfig,
    store: CrossSessionMemoryStore,
    opts: { agentName?: string } = {},
  ): Promise<MemoryProvider | null> {
    return buildMemoryProvider(memoryConfig, store, { agentName: opts.agentName ?? "" });
  }

  static async fromStorageConfig(
    config?: SessionStorageConfig | null,
    opts: { crossSessionEnabled?: boolean } = {},
  ): Promise<PersistenceBundle> {
    if (!config) {
      return {
        sessionManager: new SessionManager(),
        crossSessionMemoryStore: new InMemoryCrossSessionMemoryStore(),
      };
    }
    const sessionAdapter = await this.createSessionAdapter(config);
    const memoryStore =
      opts.crossSessionEnabled === false
        ? new InMemoryCrossSessionMemoryStore()
        : await this.createCrossSessionStore(config, { sessionAdapter });
    return {
      sessionManager: new SessionManager(sessionAdapter),
      crossSessionMemoryStore: memoryStore,
    };
  }

  static async fromResolver(
    resolver: PersistenceResolver,
    tenantId?: string | null,
    userId?: string | null,
    opts: { crossSessionEnabled?: boolean } = {},
  ): Promise<PersistenceBundle> {
    if (typeof resolver.resolveBundle === "function") {
      const bundle = await resolver.resolveBundle(tenantId, userId);
      if (bundle != null) return bundle;
    }
    const config = await resolver.resolveStorageConfig(tenantId, userId);
    return this.fromStorageConfig(config, {
      crossSessionEnabled: opts.crossSessionEnabled ?? true,
    });
  }
}

export async function persistenceFromConfig(
  config?: SessionStorageConfig | null,
): Promise<PersistenceBundle> {
  return PersistenceFactory.fromStorageConfig(config);
}

export async function loadCustomAdapter(
  classPath: string,
  adapterConfig: Record<string, unknown>,
): Promise<StorageAdapter> {
  const AdapterCls = await importFromPath<new (args: Record<string, unknown>) => StorageAdapter>(
    classPath,
  );
  return new AdapterCls(adapterConfig);
}

export async function loadCustomMemoryStore(
  classPath: string,
  adapterConfig: Record<string, unknown>,
): Promise<CrossSessionMemoryStore> {
  const StoreCls = await importFromPath<
    new (args: Record<string, unknown>) => CrossSessionMemoryStore
  >(classPath);
  return new StoreCls(adapterConfig);
}
