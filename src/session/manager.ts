/** Session manager for the Nexus Agent Framework. */

import { randomUUID } from "node:crypto";
import type { SessionStorageConfig } from "../config/storage.js";
import type { StorageAdapter } from "./adapters/base.js";
import { FileStorageAdapter } from "./adapters/file.js";
import { MemoryStorageAdapter } from "./adapters/memory.js";
import { loadCodec } from "./codec.js";
import { AgentSession, type TurnRecord, updateSessionTimestamp } from "./models.js";
import { SessionScope } from "./scope.js";

export class SessionManager {
  private readonly adapter: StorageAdapter;

  constructor(storageAdapter?: StorageAdapter | null) {
    this.adapter = storageAdapter ?? new MemoryStorageAdapter();
  }

  static fromConfig(config?: SessionStorageConfig | null): SessionManager {
    if (config == null) {
      return new SessionManager();
    }
    return new SessionManager(createAdapterFromConfigSync(config));
  }

  static async fromConfigAsync(config?: SessionStorageConfig | null): Promise<SessionManager> {
    if (config == null) {
      return new SessionManager();
    }
    return new SessionManager(await createAdapterFromConfig(config));
  }

  async createSession(
    agentId: string,
    sessionId?: string | null,
    options: {
      scope?: SessionScope | null;
      tenantId?: string | null;
      companyId?: string | null;
      userId?: string | null;
      userName?: string | null;
      title?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<AgentSession> {
    const sid = sessionId ?? randomUUID();
    const scope =
      options.scope ??
      new SessionScope({
        tenantId: options.tenantId,
        companyId: options.companyId,
        userId: options.userId,
      });
    const session = new AgentSession({
      sessionId: sid,
      agentId,
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      userId: scope.userId,
      userName: options.userName ?? null,
      title: options.title ?? "",
      metadata: options.metadata ?? {},
    });
    await this.adapter.saveSession(session);
    return session;
  }

  async loadSession(
    sessionId: string,
    options: { scope?: SessionScope | null } = {},
  ): Promise<AgentSession | null> {
    return this.adapter.loadSession(sessionId, options.scope ?? null);
  }

  async saveSession(session: AgentSession): Promise<void> {
    updateSessionTimestamp(session);
    await this.adapter.saveSession(session);
  }

  async appendTurn(
    sessionId: string,
    turn: TurnRecord,
    options: { scope?: SessionScope | null } = {},
  ): Promise<void> {
    await this.adapter.appendTurn(sessionId, turn, options.scope ?? null);
  }

  async updateTcSummary(
    sessionId: string,
    tcId: string,
    summarizedResponse: string,
    summarizedByTurn: number,
    scopeOrOptions?: SessionScope | { scope?: SessionScope | null } | null,
  ): Promise<void> {
    const scope =
      scopeOrOptions instanceof SessionScope
        ? scopeOrOptions
        : (scopeOrOptions?.scope ?? null);
    await this.adapter.updateTcSummary(
      sessionId,
      tcId,
      summarizedResponse,
      summarizedByTurn,
      scope,
    );
  }

  async deleteSession(
    sessionId: string,
    options: { scope?: SessionScope | null } = {},
  ): Promise<boolean> {
    await this.adapter.deleteSession(sessionId, options.scope ?? null);
    return true;
  }

  async listSessions(
    options: {
      agentId?: string | null;
      agent_id?: string | null;
      scope?: SessionScope | null;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<AgentSession[]> {
    return this.adapter.listSessions({
      agent_id: options.agentId ?? options.agent_id ?? null,
      scope: options.scope ?? null,
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
    });
  }

  async listSessionsByPrefix(
    sessionIdPrefix: string,
    options: {
      scope?: SessionScope | null;
      excludeSessionIds?: Set<string> | null;
      exclude_session_ids?: Set<string> | null;
    } = {},
  ): Promise<AgentSession[]> {
    return this.adapter.listSessionsByPrefix(sessionIdPrefix, {
      scope: options.scope ?? null,
      exclude_session_ids: options.excludeSessionIds ?? options.exclude_session_ids ?? null,
    });
  }

  async deactivateSession(
    sessionId: string,
    options: { scope?: SessionScope | null } = {},
  ): Promise<boolean> {
    const session = await this.loadSession(sessionId, options);
    if (!session) {
      return false;
    }
    session.isActive = false;
    await this.saveSession(session);
    return true;
  }
}

export function createAdapterFromConfigSync(config: SessionStorageConfig): StorageAdapter {
  const adapterType = config.adapter || "memory";
  const adapterConfig = { ...(config.adapter_config ?? {}) };
  const codec = typeof loadCodec === "function" ? loadCodec(config.codec_class) : undefined;
  const resolvedCodec = codec instanceof Promise ? undefined : codec;

  if (adapterType === "file") {
    return new FileStorageAdapter({
      data_root: adapterConfig.data_root as string | undefined,
      base_path: adapterConfig.base_path as string | undefined,
      filename_template: adapterConfig.filename_template as string | undefined,
      overwrite_mode: adapterConfig.overwrite_mode as string | undefined,
      pretty_print: adapterConfig.pretty_print as boolean | undefined,
      tenant_scoped: adapterConfig.tenant_scoped as boolean | undefined,
      codec: resolvedCodec,
    });
  }
  if (adapterType !== "memory") {
    console.warn(
      `Adapter type '${adapterType}' requires SessionManager.fromConfigAsync; using memory`,
    );
  }
  return new MemoryStorageAdapter({
    max_sessions: adapterConfig.max_sessions as number | undefined,
    ttl_seconds: adapterConfig.ttl_seconds as number | null | undefined,
  });
}

export async function createAdapterFromConfig(
  config: SessionStorageConfig,
): Promise<StorageAdapter> {
  const adapterType = config.adapter || "memory";
  const adapterConfig = { ...(config.adapter_config ?? {}) };
  const codec = await loadCodec(config.codec_class);

  if (adapterType === "memory") {
    return new MemoryStorageAdapter({
      max_sessions: adapterConfig.max_sessions as number | undefined,
      ttl_seconds: adapterConfig.ttl_seconds as number | null | undefined,
    });
  }
  if (adapterType === "file") {
    return new FileStorageAdapter({
      data_root: adapterConfig.data_root as string | undefined,
      base_path: adapterConfig.base_path as string | undefined,
      filename_template: adapterConfig.filename_template as string | undefined,
      overwrite_mode: adapterConfig.overwrite_mode as string | undefined,
      pretty_print: adapterConfig.pretty_print as boolean | undefined,
      tenant_scoped: adapterConfig.tenant_scoped as boolean | undefined,
      codec,
    });
  }
  if (adapterType === "sqlite") {
    const { SQLiteStorageAdapter } = await import("./adapters/sqlite.js");
    return new SQLiteStorageAdapter({
      db_path: adapterConfig.db_path as string | undefined,
      data_root: adapterConfig.data_root as string | undefined,
      tenant_scoped: adapterConfig.tenant_scoped as boolean | undefined,
      wal_mode: adapterConfig.wal_mode as boolean | undefined,
      auto_migrate: adapterConfig.auto_migrate as boolean | undefined,
      table_prefix: adapterConfig.table_prefix as string | undefined,
      codec,
    });
  }
  if (adapterType === "custom") {
    if (!config.custom_adapter_class) {
      throw new Error("custom adapter requires custom_adapter_class");
    }
    const { loadCustomAdapter } = await import("../persistence/factory.js");
    return await loadCustomAdapter(config.custom_adapter_class, { ...adapterConfig, codec });
  }
  if (adapterType === "postgresql" || adapterType === "redis") {
    console.warn(`Adapter type '${adapterType}' is not implemented yet; falling back to memory`);
    return new MemoryStorageAdapter();
  }
  console.warn(`Unknown adapter type '${adapterType}', falling back to memory`);
  return new MemoryStorageAdapter();
}
