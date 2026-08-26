/** SQLite storage adapter using @libsql/client (optional peer, lazy import). */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "./base.js";
import { DefaultSessionCodec, type SessionCodec } from "../codec.js";
import { AgentSession, TurnRecord } from "../models.js";
import { SessionScope } from "../scope.js";
import {
  getDataRoot,
  lookupSession,
  normalizeTenantId,
  registerSession,
  sessionsDbPath,
  unregisterSession,
} from "../../storage/paths.js";

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS nexus_sessions (
    session_id  TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    tenant_id   TEXT,
    user_id     TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    data        TEXT NOT NULL
)
`;

type LibsqlClient = {
  execute: (sql: string | { sql: string; args?: unknown[] }) => Promise<{ rows: Array<Record<string, unknown>> }>;
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
    if (!createClient) {
      throw new Error("createClient export missing");
    }
    return { createClient };
  } catch {
    throw new Error(
      "@libsql/client is required for SQLiteStorageAdapter. " +
        "Install it with: npm install @libsql/client",
    );
  }
}

export class SQLiteStorageAdapter implements StorageAdapter {
  readonly tenantScoped: boolean;
  readonly dataRoot: string;
  readonly dbPath?: string | null;
  readonly walMode: boolean;
  readonly autoMigrate: boolean;
  readonly tablePrefix: string;
  private readonly codec: SessionCodec;
  private readonly initialisedPaths = new Set<string>();

  constructor(options: {
    db_path?: string | null;
    dbPath?: string | null;
    data_root?: string | null;
    dataRoot?: string | null;
    tenant_scoped?: boolean;
    tenantScoped?: boolean;
    wal_mode?: boolean;
    walMode?: boolean;
    auto_migrate?: boolean;
    autoMigrate?: boolean;
    table_prefix?: string;
    tablePrefix?: string;
    codec?: SessionCodec | null;
  } = {}) {
    this.tenantScoped = options.tenantScoped ?? options.tenant_scoped ?? true;
    this.dataRoot = options.dataRoot ?? options.data_root ?? getDataRoot();
    this.dbPath = options.dbPath ?? options.db_path ?? null;
    this.walMode = options.walMode ?? options.wal_mode ?? true;
    this.autoMigrate = options.autoMigrate ?? options.auto_migrate ?? true;
    this.tablePrefix = options.tablePrefix ?? options.table_prefix ?? "nexus_";
    this.codec = options.codec ?? new DefaultSessionCodec();
  }

  private async resolveLocation(
    sessionId: string,
    opts: { scope?: SessionScope | null; session?: AgentSession | null } = {},
  ): Promise<[string | null, string | null]> {
    const scope = opts.scope;
    const session = opts.session;
    let tid = scope?.tenantId ?? session?.tenantId ?? null;
    let uid = scope?.userId ?? session?.userId ?? null;
    if (tid != null && uid != null) {
      return [tid, uid];
    }
    if (this.tenantScoped) {
      const entry = await lookupSession(sessionId, this.dataRoot);
      if (entry) {
        return [entry.tenant_id ?? null, entry.user_id ?? null];
      }
    }
    return [tid, uid];
  }

  private resolveDbPath(tenantId: string | null, userId: string | null): string {
    if (!this.tenantScoped) {
      if (!this.dbPath) {
        throw new Error("db_path is required when tenant_scoped=false");
      }
      return this.dbPath;
    }
    const resolved = sessionsDbPath(tenantId, userId, this.dataRoot);
    return resolved;
  }

  private async ensureSchema(client: LibsqlClient, dbFile: string): Promise<void> {
    if (this.initialisedPaths.has(dbFile)) {
      return;
    }
    await client.execute(CREATE_TABLE_SQL);
    await client.execute("CREATE INDEX IF NOT EXISTS idx_agent_id ON nexus_sessions (agent_id)");
    await client.execute("CREATE INDEX IF NOT EXISTS idx_tenant_id ON nexus_sessions (tenant_id)");
    await client.execute("CREATE INDEX IF NOT EXISTS idx_user_id ON nexus_sessions (user_id)");
    if (this.walMode) {
      await client.execute("PRAGMA journal_mode=WAL");
    }
    this.initialisedPaths.add(dbFile);
  }

  private async openClient(dbFile: string): Promise<LibsqlClient> {
    await mkdir(path.dirname(dbFile), { recursive: true });
    const libsql = await loadLibsql();
    const client = libsql.createClient({ url: `file:${dbFile}` });
    await this.ensureSchema(client, dbFile);
    return client;
  }

  private encodeSession(session: AgentSession): string {
    return JSON.stringify(this.codec.dumps(session));
  }

  private rowToSession(row: Record<string, unknown>): AgentSession {
    const data = row.data ?? row[7];
    if (typeof data === "string") {
      return this.codec.loads(data);
    }
    return this.codec.loads(data as Record<string, unknown>);
  }

  async saveSession(session: AgentSession): Promise<void> {
    const [tid, uid] = await this.resolveLocation(session.sessionId, { session });
    const dbFile = this.resolveDbPath(tid, uid);
    const client = await this.openClient(dbFile);
    try {
      const data = this.encodeSession(session);
      await client.execute({
        sql: `
          INSERT INTO nexus_sessions
            (session_id, agent_id, tenant_id, user_id, is_active, created_at, updated_at, data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            agent_id = excluded.agent_id,
            tenant_id = excluded.tenant_id,
            user_id = excluded.user_id,
            is_active = excluded.is_active,
            updated_at = excluded.updated_at,
            data = excluded.data
        `,
        args: [
          session.sessionId,
          session.agentId,
          session.tenantId,
          session.userId,
          session.isActive ? 1 : 0,
          session.createdAt,
          session.updatedAt,
          data,
        ],
      });
    } finally {
      await client.close();
    }
    if (this.tenantScoped) {
      await registerSession(session.sessionId, tid, uid, this.dataRoot);
    }
  }

  async loadSession(
    sessionId: string,
    scope: SessionScope | null = null,
  ): Promise<AgentSession | null> {
    const [tid, uid] = await this.resolveLocation(sessionId, { scope });
    const dbFile = this.resolveDbPath(tid, uid);
    if (!path.isAbsolute(dbFile) && !(await this.pathExists(dbFile))) {
      return null;
    }
    const client = await this.openClient(dbFile);
    try {
      const result = await client.execute({
        sql:
          "SELECT session_id, agent_id, tenant_id, user_id, is_active, created_at, updated_at, data " +
          "FROM nexus_sessions WHERE session_id = ?",
        args: [sessionId],
      });
      if (!result.rows.length) {
        return null;
      }
      const session = this.rowToSession(result.rows[0]!);
      if (scope && !scope.matchesSession(session)) {
        return null;
      }
      return session;
    } finally {
      await client.close();
    }
  }

  async listSessions(
    options: {
      agent_id?: string | null;
      scope?: SessionScope | null;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<AgentSession[]> {
    const tenantId = options.scope?.tenantId ?? null;
    const userId = options.scope?.userId ?? null;
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    if (!this.tenantScoped) {
      return this.listFromDb(this.resolveDbPath(null, null), options.agent_id ?? null, options.scope ?? null, limit, offset);
    }

    let dbFiles: string[] = [];
    if (tenantId != null && userId != null) {
      dbFiles = [this.resolveDbPath(tenantId, userId)];
    } else if (tenantId != null) {
      dbFiles = await this.tenantDbFiles(tenantId);
    } else {
      dbFiles = await this.allSessionDbFiles();
    }

    const results: AgentSession[] = [];
    for (const dbFile of dbFiles) {
      const batch = await this.listFromDb(
        dbFile,
        options.agent_id ?? null,
        options.scope ?? null,
        limit + offset,
        0,
      );
      results.push(...batch);
      if (results.length >= offset + limit) {
        break;
      }
    }

    results.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return results.slice(offset, offset + limit);
  }

  async listSessionsByPrefix(
    sessionIdPrefix: string,
    options: {
      scope?: SessionScope | null;
      exclude_session_ids?: Set<string> | null;
    } = {},
  ): Promise<AgentSession[]> {
    const tenantId = options.scope?.tenantId ?? null;
    const userId = options.scope?.userId ?? null;

    if (!this.tenantScoped) {
      return this.listFromDb(
        this.resolveDbPath(null, null),
        null,
        options.scope ?? null,
        10_000,
        0,
        sessionIdPrefix,
        options.exclude_session_ids ?? null,
      );
    }

    let dbFiles: string[] = [];
    if (tenantId != null && userId != null) {
      dbFiles = [this.resolveDbPath(tenantId, userId)];
    } else if (tenantId != null) {
      dbFiles = await this.tenantDbFiles(tenantId);
    } else {
      dbFiles = await this.allSessionDbFiles();
    }

    const results: AgentSession[] = [];
    for (const dbFile of dbFiles) {
      const batch = await this.listFromDb(
        dbFile,
        null,
        options.scope ?? null,
        10_000,
        0,
        sessionIdPrefix,
        options.exclude_session_ids ?? null,
      );
      results.push(...batch);
    }

    results.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return results;
  }

  async deleteSession(sessionId: string, scope: SessionScope | null = null): Promise<void> {
    const [tid, uid] = await this.resolveLocation(sessionId, { scope });
    const dbFile = this.resolveDbPath(tid, uid);
    const client = await this.openClient(dbFile);
    try {
      await client.execute({
        sql: "DELETE FROM nexus_sessions WHERE session_id = ?",
        args: [sessionId],
      });
    } finally {
      await client.close();
    }
    if (this.tenantScoped) {
      await unregisterSession(sessionId, this.dataRoot);
    }
  }

  async appendTurn(
    sessionId: string,
    turn: TurnRecord,
    scope: SessionScope | null = null,
  ): Promise<void> {
    const [tid, uid] = await this.resolveLocation(sessionId, { scope });
    const dbFile = this.resolveDbPath(tid, uid);
    const client = await this.openClient(dbFile);
    try {
      const result = await client.execute({
        sql: "SELECT data FROM nexus_sessions WHERE session_id = ?",
        args: [sessionId],
      });
      if (!result.rows.length) {
        console.warn(`appendTurn: session ${sessionId} not found`);
        return;
      }
      const session = this.codec.loads(String(result.rows[0]!.data));
      if (scope && !scope.matchesSession(session)) {
        console.warn(`appendTurn: session ${sessionId} scope mismatch`);
        return;
      }
      session.turns.push(turn);
      session.updatedAt = new Date().toISOString();
      await client.execute({
        sql: "UPDATE nexus_sessions SET data = ?, updated_at = ? WHERE session_id = ?",
        args: [this.encodeSession(session), session.updatedAt, sessionId],
      });
    } finally {
      await client.close();
    }
  }

  async updateTcSummary(
    sessionId: string,
    tcId: string,
    summarizedResponse: string,
    summarizedByTurn: number,
    scope: SessionScope | null = null,
  ): Promise<void> {
    const [tid, uid] = await this.resolveLocation(sessionId, { scope });
    const dbFile = this.resolveDbPath(tid, uid);
    const client = await this.openClient(dbFile);
    try {
      const result = await client.execute({
        sql: "SELECT data FROM nexus_sessions WHERE session_id = ?",
        args: [sessionId],
      });
      if (!result.rows.length) {
        return;
      }
      const session = this.codec.loads(String(result.rows[0]!.data));
      if (scope && !scope.matchesSession(session)) {
        return;
      }
      for (const turn of session.turns) {
        for (const tc of turn.toolCalls) {
          if (tc.tcId === tcId) {
            tc.summarizedResponse = summarizedResponse;
            tc.summarizedByTurn = summarizedByTurn;
          }
        }
      }
      session.updatedAt = new Date().toISOString();
      await client.execute({
        sql: "UPDATE nexus_sessions SET data = ?, updated_at = ? WHERE session_id = ?",
        args: [this.encodeSession(session), session.updatedAt, sessionId],
      });
    } finally {
      await client.close();
    }
  }

  private async listFromDb(
    dbFile: string,
    agentId: string | null,
    scope: SessionScope | null,
    limit: number,
    offset: number,
    sessionIdPrefix?: string | null,
    excludeSessionIds?: Set<string> | null,
  ): Promise<AgentSession[]> {
    if (!(await this.pathExists(dbFile))) {
      return [];
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (agentId) {
      conditions.push("agent_id = ?");
      params.push(agentId);
    }
    if (scope?.tenantId) {
      conditions.push("tenant_id = ?");
      params.push(scope.tenantId);
    }
    if (scope?.userId) {
      conditions.push("user_id = ?");
      params.push(scope.userId);
    }
    if (sessionIdPrefix) {
      conditions.push("session_id LIKE ?");
      params.push(`${sessionIdPrefix}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const order = sessionIdPrefix ? "created_at ASC" : "updated_at DESC";
    params.push(limit, offset);

    const client = await this.openClient(dbFile);
    try {
      const result = await client.execute({
        sql:
          "SELECT session_id, agent_id, tenant_id, user_id, is_active, created_at, updated_at, data " +
          `FROM nexus_sessions ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
        args: params,
      });
      let sessions = result.rows.map((row) => this.rowToSession(row));
      if (scope) {
        sessions = sessions.filter((s) => scope.matchesSession(s));
      }
      if (excludeSessionIds?.size) {
        sessions = sessions.filter((s) => !excludeSessionIds.has(s.sessionId));
      }
      return sessions;
    } finally {
      await client.close();
    }
  }

  private async tenantDbFiles(tenantId: string): Promise<string[]> {
    const tenantUsers = path.join(this.dataRoot, normalizeTenantId(tenantId), "users");
    const files: string[] = [];
    try {
      const { readdir } = await import("node:fs/promises");
      for (const userDir of await readdir(tenantUsers, { withFileTypes: true })) {
        if (!userDir.isDirectory()) continue;
        const candidate = path.join(tenantUsers, userDir.name, "sessions.db");
        if (await this.pathExists(candidate)) {
          files.push(candidate);
        }
      }
    } catch {
      // no tenant dir
    }
    return files;
  }

  private async allSessionDbFiles(): Promise<string[]> {
    const files: string[] = [];
    await this.collectSessionDbFiles(this.dataRoot, files);
    return files.filter((p) => !p.includes("_index"));
  }

  private async collectSessionDbFiles(dir: string, out: string[]): Promise<void> {
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.collectSessionDbFiles(full, out);
        } else if (entry.isFile() && entry.name === "sessions.db") {
          out.push(full);
        }
      }
    } catch {
      // ignore missing roots
    }
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      const { access } = await import("node:fs/promises");
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
