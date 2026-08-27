/** PostgreSQL session storage adapter using the `postgres` package. */

import type { StorageAdapter } from "./base.js";
import { DefaultSessionCodec, type SessionCodec } from "../codec.js";
import { AgentSession, TurnRecord } from "../models.js";
import { SessionScope } from "../scope.js";

type Sql = {
  unsafe: (query: string, values?: unknown[]) => Promise<Array<Record<string, unknown>>>;
  end: (opts?: { timeout?: number }) => Promise<void>;
};

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

export class PostgreSQLStorageAdapter implements StorageAdapter {
  readonly dsn: string;
  readonly sessionsTable: string;
  readonly schemaMode: string;
  readonly autoMigrate: boolean;
  readonly pool: Sql | null;
  private sql: Sql | null;
  private readonly ownsPool: boolean;
  private readonly codec: SessionCodec;
  private schemaReady = false;

  constructor(
    options: {
      dsn?: string;
      schema?: string | null;
      db_schema?: string | null;
      dbSchema?: string | null;
      schema_mode?: string;
      schemaMode?: string;
      sessions_table?: string | null;
      sessionsTable?: string | null;
      table_prefix?: string;
      tablePrefix?: string;
      auto_migrate?: boolean;
      autoMigrate?: boolean;
      pool?: Sql | null;
      codec?: SessionCodec | null;
    } = {},
  ) {
    this.dsn = options.dsn ?? "";
    const dbSchema = options.dbSchema ?? options.db_schema ?? options.schema ?? null;
    this.schemaMode = options.schemaMode ?? options.schema_mode ?? "managed";
    this.autoMigrate = options.autoMigrate ?? options.auto_migrate ?? true;
    const prefix = options.tablePrefix ?? options.table_prefix ?? "nexus_";
    const table = options.sessionsTable ?? options.sessions_table ?? `${prefix}sessions`;
    this.sessionsTable = qualifyTable(table, dbSchema, this.schemaMode);
    this.codec = options.codec ?? new DefaultSessionCodec();
    if (options.pool) {
      this.sql = options.pool;
      this.pool = options.pool;
      this.ownsPool = false;
    } else {
      this.sql = null;
      this.pool = null;
      this.ownsPool = true;
    }
  }

  private async getSql(): Promise<Sql> {
    if (this.sql) return this.sql;
    if (!this.dsn) throw new Error("dsn is required for PostgreSQLStorageAdapter");
    try {
      const mod = (await import("postgres")) as unknown as {
        default?: (dsn: string) => Sql;
      };
      const factory = (typeof mod.default === "function" ? mod.default : (mod as unknown as (dsn: string) => Sql));
      this.sql = factory(this.dsn);
      return this.sql;
    } catch {
      throw new Error(
        "postgres is required for PostgreSQLStorageAdapter. Install it with: npm install postgres",
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
        CREATE TABLE IF NOT EXISTS ${this.sessionsTable} (
          session_id  TEXT PRIMARY KEY,
          agent_id    TEXT NOT NULL,
          tenant_id   TEXT,
          user_id     TEXT,
          is_active   BOOLEAN NOT NULL DEFAULT TRUE,
          created_at  TIMESTAMPTZ NOT NULL,
          updated_at  TIMESTAMPTZ NOT NULL,
          data        JSONB NOT NULL
        )
      `);
      const idx = this.sessionsTable.replace(/[."]/g, "_");
      await sql.unsafe(
        `CREATE INDEX IF NOT EXISTS idx_${idx}_tenant_user ON ${this.sessionsTable} (tenant_id, user_id)`,
      );
      await sql.unsafe(
        `CREATE INDEX IF NOT EXISTS idx_${idx}_agent ON ${this.sessionsTable} (agent_id)`,
      );
    }
    this.schemaReady = true;
  }

  private encode(session: AgentSession): string {
    return JSON.stringify(this.codec.dumps(session));
  }

  private decode(row: Record<string, unknown>): AgentSession {
    const data = row.data;
    if (typeof data === "string") return this.codec.loads(data);
    return this.codec.loads(data as Record<string, unknown>);
  }

  async saveSession(session: AgentSession): Promise<void> {
    const sql = await this.getSql();
    await this.ensureSchema(sql);
    await sql.unsafe(
      `INSERT INTO ${this.sessionsTable}
        (session_id, agent_id, tenant_id, user_id, is_active, created_at, updated_at, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (session_id) DO UPDATE SET
         agent_id = EXCLUDED.agent_id,
         tenant_id = EXCLUDED.tenant_id,
         user_id = EXCLUDED.user_id,
         is_active = EXCLUDED.is_active,
         updated_at = EXCLUDED.updated_at,
         data = EXCLUDED.data`,
      [
        session.sessionId,
        session.agentId,
        session.tenantId,
        session.userId,
        session.isActive,
        session.createdAt,
        session.updatedAt,
        this.encode(session),
      ],
    );
  }

  async loadSession(
    sessionId: string,
    scope: SessionScope | null = null,
  ): Promise<AgentSession | null> {
    const sql = await this.getSql();
    await this.ensureSchema(sql);
    const rows = await sql.unsafe(
      `SELECT data FROM ${this.sessionsTable} WHERE session_id = $1`,
      [sessionId],
    );
    if (!rows.length) return null;
    const session = this.decode(rows[0]!);
    if (scope && !scope.matchesSession(session)) return null;
    return session;
  }

  async listSessions(
    options: {
      agent_id?: string | null;
      scope?: SessionScope | null;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<AgentSession[]> {
    const sql = await this.getSql();
    await this.ensureSchema(sql);
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (options.agent_id) {
      conditions.push(`agent_id = $${i++}`);
      params.push(options.agent_id);
    }
    if (options.scope?.tenantId) {
      conditions.push(`tenant_id = $${i++}`);
      params.push(options.scope.tenantId);
    }
    if (options.scope?.userId) {
      conditions.push(`user_id = $${i++}`);
      params.push(options.scope.userId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(options.limit ?? 50, options.offset ?? 0);
    const rows = await sql.unsafe(
      `SELECT data FROM ${this.sessionsTable} ${where} ORDER BY updated_at DESC LIMIT $${i++} OFFSET $${i}`,
      params,
    );
    let sessions = rows.map((row) => this.decode(row));
    if (options.scope) sessions = sessions.filter((s) => options.scope!.matchesSession(s));
    return sessions;
  }

  async listSessionsByPrefix(
    sessionIdPrefix: string,
    options: {
      scope?: SessionScope | null;
      exclude_session_ids?: Set<string> | null;
    } = {},
  ): Promise<AgentSession[]> {
    const sql = await this.getSql();
    await this.ensureSchema(sql);
    const rows = await sql.unsafe(
      `SELECT data FROM ${this.sessionsTable} WHERE session_id LIKE $1 ORDER BY created_at ASC`,
      [`${sessionIdPrefix}%`],
    );
    let sessions = rows.map((row) => this.decode(row));
    if (options.scope) sessions = sessions.filter((s) => options.scope!.matchesSession(s));
    if (options.exclude_session_ids?.size) {
      sessions = sessions.filter((s) => !options.exclude_session_ids!.has(s.sessionId));
    }
    return sessions;
  }

  async deleteSession(sessionId: string, scope: SessionScope | null = null): Promise<void> {
    if (scope) {
      const existing = await this.loadSession(sessionId, scope);
      if (!existing) return;
    }
    const sql = await this.getSql();
    await this.ensureSchema(sql);
    await sql.unsafe(`DELETE FROM ${this.sessionsTable} WHERE session_id = $1`, [sessionId]);
  }

  async appendTurn(
    sessionId: string,
    turn: TurnRecord,
    scope: SessionScope | null = null,
  ): Promise<void> {
    const session = await this.loadSession(sessionId, scope);
    if (!session) {
      console.warn(`appendTurn: session ${sessionId} not found`);
      return;
    }
    session.turns.push(turn);
    session.updatedAt = new Date().toISOString();
    await this.saveSession(session);
  }

  async updateTcSummary(
    sessionId: string,
    tcId: string,
    summarizedResponse: string,
    summarizedByTurn: number,
    scope: SessionScope | null = null,
  ): Promise<void> {
    const session = await this.loadSession(sessionId, scope);
    if (!session) return;
    for (const turn of session.turns) {
      for (const tc of turn.toolCalls) {
        if (tc.tcId === tcId) {
          tc.summarizedResponse = summarizedResponse;
          tc.summarizedByTurn = summarizedByTurn;
        }
      }
    }
    session.updatedAt = new Date().toISOString();
    await this.saveSession(session);
  }
}
