/** File-based storage adapter. */

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentSession, TurnRecord } from "../models.js";
import type { SessionScope } from "../scope.js";
import {
  getDataRoot,
  lookupSession,
  normalizeTenantId,
  registerSession,
  sessionFile,
  sessionLockFile,
  tenantUserDir,
  unregisterSession,
} from "../../storage/paths.js";
import { DefaultSessionCodec, type SessionCodec } from "../codec.js";
import type { StorageAdapter } from "./base.js";

class AsyncLock {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.tail.then(() => fn());
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

async function withFileLock<T>(lockPath: string, fn: () => Promise<T> | T): Promise<T> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const lock = new AsyncLock();
  return lock.run(async () => {
    const lockFile = `${lockPath}.lock`;
    const start = Date.now();
    while (Date.now() - start < 30_000) {
      try {
        const handle = await import("node:fs/promises").then((fs) =>
          fs.open(lockFile, "wx"),
        );
        await handle.close();
        try {
          return await fn();
        } finally {
          await rm(lockFile, { force: true });
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    throw new Error(`Timed out acquiring file lock: ${lockPath}`);
  });
}

export class FileStorageAdapter implements StorageAdapter {
  private readonly tenantScoped: boolean;
  private readonly dataRoot: string | null;
  private readonly basePath: string | null;
  private readonly filenameTemplate: string;
  private readonly overwriteMode: string;
  private readonly prettyPrint: boolean;
  private readonly _codec: SessionCodec;
  private readonly _ioLock = new AsyncLock();

  constructor(options?: {
    data_root?: string;
    base_path?: string;
    filename_template?: string;
    overwrite_mode?: string;
    pretty_print?: boolean;
    tenant_scoped?: boolean;
    codec?: SessionCodec;
  }) {
    this.tenantScoped = options?.tenant_scoped ?? true;
    if (this.tenantScoped) {
      this.dataRoot = options?.data_root ?? getDataRoot();
      this.basePath = null;
      this.filenameTemplate = "session.json";
    } else {
      this.basePath = options?.base_path ?? "./nexus_sessions";
      this.dataRoot = null;
      this.filenameTemplate = options?.filename_template ?? "{session_id}.json";
    }
    this.overwriteMode = options?.overwrite_mode ?? "full_rewrite";
    void this.overwriteMode;
    this.prettyPrint = options?.pretty_print ?? false;
    this._codec = options?.codec ?? new DefaultSessionCodec();
  }

  private async resolveLocation(
    sessionId: string,
    options?: { scope?: SessionScope | null; session?: AgentSession | null },
  ): Promise<[string | null, string | null]> {
    const scope = options?.scope ?? null;
    const session = options?.session ?? null;
    let tid = scope?.tenantId ?? session?.tenantId ?? null;
    let uid = scope?.userId ?? session?.userId ?? null;
    if (tid != null && uid != null) {
      return [tid, uid];
    }
    if (this.tenantScoped) {
      const entry = await lookupSession(sessionId, this.dataRoot ?? undefined);
      if (entry) {
        return [entry.tenant_id ?? null, entry.user_id ?? null];
      }
    }
    return [tid, uid];
  }

  private legacyPath(sessionId: string): string {
    const filename = this.filenameTemplate.replace("{session_id}", sessionId);
    return path.join(this.basePath!, filename);
  }

  private getPath(tenantId: string | null, userId: string | null, sessionId: string): string {
    if (this.tenantScoped) {
      return sessionFile(tenantId, userId, sessionId, this.dataRoot ?? undefined);
    }
    return this.legacyPath(sessionId);
  }

  private getLockPath(
    tenantId: string | null,
    userId: string | null,
    sessionId: string,
  ): string {
    if (this.tenantScoped) {
      return sessionLockFile(tenantId, userId, sessionId, this.dataRoot ?? undefined);
    }
    return path.join(this.basePath!, `.${sessionId}.lock`);
  }

  private serializeSession(session: AgentSession): string {
    return JSON.stringify(this._codec.dumps(session), null, this.prettyPrint ? 2 : undefined);
  }

  private deserializeSession(data: string): AgentSession {
    return this._codec.loads(data);
  }

  async saveSession(session: AgentSession): Promise<void> {
    const [tid, uid] = await this.resolveLocation(session.sessionId, { session });
    const filePath = this.getPath(tid, uid, session.sessionId);
    const lockPath = this.getLockPath(tid, uid, session.sessionId);

    await this._ioLock.run(() =>
      withFileLock(lockPath, async () => {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, this.serializeSession(session), "utf8");
      }),
    );

    if (this.tenantScoped) {
      await registerSession(session.sessionId, tid, uid, this.dataRoot ?? undefined);
    }
  }

  async loadSession(
    sessionId: string,
    scope: SessionScope | null = null,
  ): Promise<AgentSession | null> {
    const [tid, uid] = await this.resolveLocation(sessionId, { scope });
    const filePath = this.getPath(tid, uid, sessionId);
    const lockPath = this.getLockPath(tid, uid, sessionId);

    let session: AgentSession | null = null;
    await this._ioLock.run(() =>
      withFileLock(lockPath, async () => {
        try {
          await stat(filePath);
        } catch {
          if (
            this.tenantScoped &&
            (scope == null || (scope.tenantId == null && scope.userId == null))
          ) {
            session = await this.scanForSession(sessionId);
          }
          return;
        }
        const content = await readFile(filePath, "utf8");
        session = this.deserializeSession(content);
      }),
    );

    if (session != null && scope != null && !scope.matchesSession(session)) {
      return null;
    }
    return session;
  }

  private async scanForSession(sessionId: string): Promise<AgentSession | null> {
    const root = this.dataRoot;
    if (!root) {
      return null;
    }
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (entry.name !== "session.json") {
          continue;
        }
        try {
          const session = this.deserializeSession(await readFile(fullPath, "utf8"));
          if (session.sessionId === sessionId) {
            await registerSession(
              sessionId,
              session.tenantId,
              session.userId,
              this.dataRoot ?? undefined,
            );
            return session;
          }
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  private async *iterSessionFiles(scope: SessionScope | null = null): AsyncGenerator<string> {
    if (!this.tenantScoped) {
      const entries = await readdir(this.basePath!, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".json")) {
          yield path.join(this.basePath!, entry.name);
        }
      }
      return;
    }

    const root = this.dataRoot!;
    const tenantId = scope?.tenantId ?? null;
    const userId = scope?.userId ?? null;

    if (tenantId != null && userId != null) {
      const userDir = tenantUserDir(tenantId, userId, root);
      try {
        const sessions = await readdir(userDir, { withFileTypes: true });
        for (const sessionPath of sessions) {
          if (!sessionPath.isDirectory()) {
            continue;
          }
          const candidate = path.join(userDir, sessionPath.name, "session.json");
          try {
            await stat(candidate);
            yield candidate;
          } catch {
            continue;
          }
        }
      } catch {
        return;
      }
      return;
    }

    if (tenantId != null) {
      const tenantDir = path.join(root, normalizeTenantId(tenantId), "users");
      try {
        const users = await readdir(tenantDir, { withFileTypes: true });
        for (const user of users) {
          if (!user.isDirectory()) {
            continue;
          }
          const userDir = path.join(tenantDir, user.name);
          const sessions = await readdir(userDir, { withFileTypes: true });
          for (const sessionPath of sessions) {
            if (!sessionPath.isDirectory()) {
              continue;
            }
            yield path.join(userDir, sessionPath.name, "session.json");
          }
        }
      } catch {
        return;
      }
      return;
    }

    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (entry.name === "session.json" && !fullPath.includes(`${path.sep}_index${path.sep}`)) {
          yield fullPath;
        }
      }
    }
  }

  async listSessions(options: {
    agent_id?: string | null;
    scope?: SessionScope | null;
    limit?: number;
    offset?: number;
  } = {}): Promise<AgentSession[]> {
    const { agent_id = null, scope = null, limit = 50, offset = 0 } = options;
    const results: AgentSession[] = [];
    for await (const filePath of this.iterSessionFiles(scope)) {
      try {
        const session = this.deserializeSession(await readFile(filePath, "utf8"));
        if (agent_id && session.agentId !== agent_id) {
          continue;
        }
        if (scope != null && !scope.matchesSession(session)) {
          continue;
        }
        results.push(session);
      } catch {
        continue;
      }
    }
    results.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return results.slice(offset, offset + limit);
  }

  async listSessionsByPrefix(
    sessionIdPrefix: string,
    options: {
      scope?: SessionScope | null;
      exclude_session_ids?: Set<string> | null;
    } = {},
  ): Promise<AgentSession[]> {
    const { scope = null, exclude_session_ids = null } = options;
    const excluded = exclude_session_ids ?? new Set<string>();
    const results: AgentSession[] = [];
    for await (const filePath of this.iterSessionFiles(scope)) {
      try {
        const session = this.deserializeSession(await readFile(filePath, "utf8"));
        if (!session.sessionId.startsWith(sessionIdPrefix)) {
          continue;
        }
        if (excluded.has(session.sessionId)) {
          continue;
        }
        if (scope != null && !scope.matchesSession(session)) {
          continue;
        }
        results.push(session);
      } catch {
        continue;
      }
    }
    results.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return results;
  }

  async deleteSession(sessionId: string, scope: SessionScope | null = null): Promise<void> {
    const [tid, uid] = await this.resolveLocation(sessionId, { scope });
    const filePath = this.getPath(tid, uid, sessionId);
    const lockPath = this.getLockPath(tid, uid, sessionId);

    await this._ioLock.run(() =>
      withFileLock(lockPath, async () => {
        if (this.tenantScoped) {
          await rm(path.dirname(filePath), { recursive: true, force: true });
        } else {
          await rm(filePath, { force: true });
        }
      }),
    );

    if (this.tenantScoped) {
      await unregisterSession(sessionId, this.dataRoot ?? undefined);
    }
  }

  async appendTurn(
    sessionId: string,
    turn: TurnRecord,
    scope: SessionScope | null = null,
  ): Promise<void> {
    const session = await this.loadSession(sessionId, scope);
    if (!session) {
      return;
    }
    session.turns.push(turn);
    session.updateTimestamp();
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
    if (!session) {
      return;
    }
    for (const turn of session.turns) {
      for (const tc of turn.toolCalls) {
        if (tc.tcId === tcId) {
          tc.summarizedResponse = summarizedResponse;
          tc.summarizedByTurn = summarizedByTurn;
          session.updateTimestamp();
          await this.saveSession(session);
          return;
        }
      }
    }
  }
}
