/** SQLite-backed cross-session memory store using @libsql/client. */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { getDataRoot, memoryDbPath } from "../../storage/paths.js";
import {
  createCrossSessionMemoryRecord,
  makeCrossSessionMemoryKey,
  touchCrossSessionMemoryRecord,
  type CrossSessionMemoryRecord,
  type CrossSessionMemoryStore,
} from "../cross-session-store.js";

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS nexus_user_memory (
    memory_key  TEXT PRIMARY KEY,
    tenant_id   TEXT,
    user_id     TEXT NOT NULL,
    namespace   TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_memory_tenant ON nexus_user_memory (tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_memory_user   ON nexus_user_memory (user_id);
`;

type LibsqlClient = {
  execute: (sql: string | { sql: string; args?: unknown[] }) => Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
  close: () => Promise<void>;
};

type LibsqlModule = {
  createClient: (opts: { url: string }) => LibsqlClient;
};

async function loadLibsql(): Promise<LibsqlModule> {
  try {
    const mod = (await import("@libsql/client")) as unknown as LibsqlModule & {
      default?: LibsqlModule;
    };
    const createClient = mod.createClient ?? mod.default?.createClient;
    if (!createClient) throw new Error("createClient export missing");
    return { createClient };
  } catch {
    throw new Error(
      "@libsql/client is required for SQLiteCrossSessionMemoryStore. Install it with: npm install @libsql/client",
    );
  }
}

function capEntities(
  entities: Record<string, string>,
  maxEntities: number,
): Record<string, string> {
  const entries = Object.entries(entities);
  if (entries.length <= maxEntities) return entities;
  return Object.fromEntries(entries.slice(-maxEntities));
}

function recordFromJson(raw: string): CrossSessionMemoryRecord {
  const data = JSON.parse(raw) as {
    tenantId?: string | null;
    tenant_id?: string | null;
    userId?: string;
    user_id?: string;
    namespace: string;
    entityMemory?: Record<string, string>;
    entity_memory?: Record<string, string>;
    updatedAt?: string;
    updated_at?: string;
  };
  return createCrossSessionMemoryRecord({
    tenantId: data.tenantId ?? data.tenant_id ?? null,
    userId: data.userId ?? data.user_id ?? "",
    namespace: data.namespace,
    entityMemory: data.entityMemory ?? data.entity_memory ?? {},
    updatedAt: data.updatedAt
      ? new Date(data.updatedAt)
      : data.updated_at
        ? new Date(data.updated_at)
        : new Date(),
  });
}

function recordToJson(record: CrossSessionMemoryRecord): string {
  return JSON.stringify({
    tenantId: record.tenantId ?? null,
    tenant_id: record.tenantId ?? null,
    userId: record.userId,
    user_id: record.userId,
    namespace: record.namespace,
    entityMemory: record.entityMemory,
    entity_memory: record.entityMemory,
    updatedAt: record.updatedAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  });
}

export class SQLiteCrossSessionMemoryStore implements CrossSessionMemoryStore {
  readonly tenantScoped: boolean;
  readonly dataRoot: string;
  readonly dbPath?: string | null;
  private readonly initialisedPaths = new Set<string>();

  constructor(
    options: {
      db_path?: string | null;
      dbPath?: string | null;
      data_root?: string | null;
      dataRoot?: string | null;
      tenant_scoped?: boolean;
      tenantScoped?: boolean;
    } = {},
  ) {
    this.tenantScoped = options.tenantScoped ?? options.tenant_scoped ?? true;
    this.dataRoot = options.dataRoot ?? options.data_root ?? getDataRoot();
    this.dbPath = options.dbPath ?? options.db_path ?? null;
  }

  private resolveDbPath(tenantId: string | null | undefined, userId: string): string {
    if (!this.tenantScoped) {
      if (!this.dbPath) {
        throw new Error("db_path is required when tenant_scoped=false");
      }
      return this.dbPath;
    }
    return memoryDbPath(tenantId, userId, this.dataRoot);
  }

  private async openClient(dbFile: string): Promise<LibsqlClient> {
    await mkdir(path.dirname(dbFile), { recursive: true });
    const libsql = await loadLibsql();
    const client = libsql.createClient({ url: `file:${dbFile}` });
    if (!this.initialisedPaths.has(dbFile)) {
      for (const stmt of CREATE_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
        await client.execute(stmt);
      }
      this.initialisedPaths.add(dbFile);
    }
    return client;
  }

  async load(
    tenantId: string | null | undefined,
    userId: string,
    namespace: string,
    _opts?: { companyId?: string | null },
  ): Promise<CrossSessionMemoryRecord | null> {
    const key = makeCrossSessionMemoryKey(tenantId, userId, namespace);
    const dbFile = this.resolveDbPath(tenantId, userId);
    const client = await this.openClient(dbFile);
    try {
      const result = await client.execute({
        sql: "SELECT data FROM nexus_user_memory WHERE memory_key = ?",
        args: [key],
      });
      const raw = result.rows[0]?.data;
      if (typeof raw !== "string") return null;
      return recordFromJson(raw);
    } finally {
      await client.close();
    }
  }

  async save(
    record: CrossSessionMemoryRecord,
    _opts?: { companyId?: string | null },
  ): Promise<void> {
    touchCrossSessionMemoryRecord(record);
    const key = makeCrossSessionMemoryKey(record.tenantId, record.userId, record.namespace);
    const dbFile = this.resolveDbPath(record.tenantId, record.userId);
    const client = await this.openClient(dbFile);
    try {
      await client.execute({
        sql: `
          INSERT INTO nexus_user_memory
            (memory_key, tenant_id, user_id, namespace, updated_at, data)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(memory_key) DO UPDATE SET
            tenant_id  = excluded.tenant_id,
            user_id    = excluded.user_id,
            namespace  = excluded.namespace,
            updated_at = excluded.updated_at,
            data       = excluded.data
        `,
        args: [
          key,
          record.tenantId ?? null,
          record.userId,
          record.namespace,
          record.updatedAt.toISOString(),
          recordToJson(record),
        ],
      });
    } finally {
      await client.close();
    }
  }

  async mergeEntities(
    tenantId: string | null | undefined,
    userId: string,
    namespace: string,
    entities: Record<string, string>,
    opts: { maxEntities: number; companyId?: string | null },
  ): Promise<CrossSessionMemoryRecord> {
    let existing = await this.load(tenantId, userId, namespace, opts);
    if (!existing) {
      existing = createCrossSessionMemoryRecord({ tenantId, userId, namespace });
    }
    if (Object.keys(entities).length > 0) {
      existing.entityMemory = capEntities(
        { ...existing.entityMemory, ...entities },
        opts.maxEntities,
      );
    }
    await this.save(existing, opts);
    return existing;
  }
}
