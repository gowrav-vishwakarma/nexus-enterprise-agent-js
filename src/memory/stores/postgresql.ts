/** PostgreSQL-backed cross-session memory store using the `postgres` package. */

import {
  createCrossSessionMemoryRecord,
  makeCrossSessionMemoryKey,
  touchCrossSessionMemoryRecord,
  type CrossSessionMemoryRecord,
  type CrossSessionMemoryStore,
} from "../cross-session-store.js";

type Sql = ((
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Array<Record<string, unknown>>> & { unsafe: (query: string, values?: unknown[]) => Promise<Array<Record<string, unknown>>> }) & {
  end: (opts?: { timeout?: number }) => Promise<void>;
  unsafe: (query: string, values?: unknown[]) => Promise<Array<Record<string, unknown>>>;
};

function capEntities(
  entities: Record<string, string>,
  maxEntities: number,
): Record<string, string> {
  const entries = Object.entries(entities);
  if (entries.length <= maxEntities) return entities;
  return Object.fromEntries(entries.slice(-maxEntities));
}

function recordFromRow(data: unknown): CrossSessionMemoryRecord {
  const parsed =
    typeof data === "string" ? (JSON.parse(data) as Record<string, unknown>) : (data as Record<string, unknown>);
  return createCrossSessionMemoryRecord({
    tenantId: (parsed.tenantId ?? parsed.tenant_id ?? null) as string | null,
    userId: String(parsed.userId ?? parsed.user_id ?? ""),
    namespace: String(parsed.namespace ?? ""),
    entityMemory:
      (parsed.entityMemory as Record<string, string> | undefined) ??
      (parsed.entity_memory as Record<string, string> | undefined) ??
      {},
    updatedAt: parsed.updatedAt
      ? new Date(String(parsed.updatedAt))
      : parsed.updated_at
        ? new Date(String(parsed.updated_at))
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

function qualifyTable(
  table: string,
  dbSchema: string | null | undefined,
  schemaMode: string,
): string {
  if (table.includes(".")) return table;
  if (dbSchema && (schemaMode === "qualified" || schemaMode === "managed")) {
    return `"${dbSchema}".${table}`;
  }
  return table;
}

export class PostgreSQLCrossSessionMemoryStore implements CrossSessionMemoryStore {
  readonly dsn: string;
  readonly memoryTable: string;
  readonly schemaMode: string;
  readonly autoMigrate: boolean;
  private sql: Sql | null;
  private readonly ownsPool: boolean;
  private schemaReady = false;

  constructor(
    options: {
      dsn?: string;
      schema?: string | null;
      db_schema?: string | null;
      dbSchema?: string | null;
      schema_mode?: string;
      schemaMode?: string;
      user_memory_table?: string | null;
      userMemoryTable?: string | null;
      table_prefix?: string;
      tablePrefix?: string;
      auto_migrate?: boolean;
      autoMigrate?: boolean;
      pool?: Sql | null;
    } = {},
  ) {
    this.dsn = options.dsn ?? "";
    const dbSchema = options.dbSchema ?? options.db_schema ?? options.schema ?? null;
    this.schemaMode = options.schemaMode ?? options.schema_mode ?? "managed";
    this.autoMigrate = options.autoMigrate ?? options.auto_migrate ?? true;
    const prefix = options.tablePrefix ?? options.table_prefix ?? "nexus_";
    const table = options.userMemoryTable ?? options.user_memory_table ?? `${prefix}user_memory`;
    this.memoryTable = qualifyTable(table, dbSchema, this.schemaMode);
    if (options.pool) {
      this.sql = options.pool;
      this.ownsPool = false;
    } else {
      this.sql = null;
      this.ownsPool = true;
    }
  }

  private async getSql(): Promise<Sql> {
    if (this.sql) return this.sql;
    if (!this.dsn) throw new Error("dsn is required for PostgreSQLCrossSessionMemoryStore");
    try {
      const mod = (await import("postgres")) as unknown as {
        default?: (dsn: string) => Sql;
      };
      const factory = (typeof mod.default === "function" ? mod.default : (mod as unknown as (dsn: string) => Sql));
      this.sql = factory(this.dsn);
      return this.sql;
    } catch {
      throw new Error(
        "postgres is required for PostgreSQLCrossSessionMemoryStore. Install it with: npm install postgres",
      );
    }
  }

  async close(): Promise<void> {
    if (this.sql && this.ownsPool) {
      await this.sql.end({ timeout: 5 });
      this.sql = null;
    }
  }

  private async ensureSchema(sql: Sql): Promise<void> {
    if (this.schemaReady) return;
    if (this.schemaMode === "existing") {
      this.schemaReady = true;
      return;
    }
    if (this.schemaMode === "managed" && this.autoMigrate) {
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS ${this.memoryTable} (
          memory_key  TEXT PRIMARY KEY,
          tenant_id   TEXT,
          user_id     TEXT NOT NULL,
          namespace   TEXT NOT NULL,
          updated_at  TIMESTAMPTZ NOT NULL,
          data        JSONB NOT NULL
        )
      `);
      await sql.unsafe(
        `CREATE INDEX IF NOT EXISTS idx_${this.memoryTable.replace(/[."]/g, "_")}_user ON ${this.memoryTable} (user_id)`,
      );
    }
    this.schemaReady = true;
  }

  async load(
    tenantId: string | null | undefined,
    userId: string,
    namespace: string,
    _opts?: { companyId?: string | null },
  ): Promise<CrossSessionMemoryRecord | null> {
    const key = makeCrossSessionMemoryKey(tenantId, userId, namespace);
    const sql = await this.getSql();
    await this.ensureSchema(sql);
    const rows = await sql.unsafe(
      `SELECT data FROM ${this.memoryTable} WHERE memory_key = $1`,
      [key],
    );
    if (!rows.length) return null;
    return recordFromRow(rows[0]!.data);
  }

  async save(
    record: CrossSessionMemoryRecord,
    _opts?: { companyId?: string | null },
  ): Promise<void> {
    touchCrossSessionMemoryRecord(record);
    const key = makeCrossSessionMemoryKey(record.tenantId, record.userId, record.namespace);
    const sql = await this.getSql();
    await this.ensureSchema(sql);
    await sql.unsafe(
      `INSERT INTO ${this.memoryTable}
        (memory_key, tenant_id, user_id, namespace, updated_at, data)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (memory_key) DO UPDATE SET
         tenant_id  = EXCLUDED.tenant_id,
         user_id    = EXCLUDED.user_id,
         namespace  = EXCLUDED.namespace,
         updated_at = EXCLUDED.updated_at,
         data       = EXCLUDED.data`,
      [
        key,
        record.tenantId ?? null,
        record.userId,
        record.namespace,
        record.updatedAt.toISOString(),
        recordToJson(record),
      ],
    );
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
