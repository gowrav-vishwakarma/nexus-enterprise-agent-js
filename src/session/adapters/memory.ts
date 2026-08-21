/** In-memory storage adapter for the Nexus Agent Framework. */

import type { AgentSession, TurnRecord } from "../models.js";
import type { SessionScope } from "../scope.js";
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

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly _sessions = new Map<string, AgentSession>();
  private readonly _locks = new Map<string, AsyncLock>();
  private readonly _maxSessions: number;
  private readonly _ttlSeconds: number | null;

  constructor(options?: { max_sessions?: number; ttl_seconds?: number | null }) {
    this._maxSessions = options?.max_sessions ?? 10000;
    this._ttlSeconds = options?.ttl_seconds ?? null;
  }

  private getLock(sessionId: string): AsyncLock {
    let lock = this._locks.get(sessionId);
    if (!lock) {
      lock = new AsyncLock();
      this._locks.set(sessionId, lock);
    }
    return lock;
  }

  private evictIfNeeded(): void {
    if (this._sessions.size <= this._maxSessions) {
      return;
    }
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [sessionId, session] of this._sessions.entries()) {
      const time = Date.parse(session.updatedAt);
      if (time < oldestTime) {
        oldestTime = time;
        oldestId = sessionId;
      }
    }
    if (oldestId) {
      this._sessions.delete(oldestId);
    }
  }

  private matches(session: AgentSession, scope?: SessionScope | null): boolean {
    if (!scope) {
      return true;
    }
    return scope.matchesSession(session);
  }

  async saveSession(session: AgentSession): Promise<void> {
    await this.getLock(session.sessionId).run(async () => {
      this._sessions.set(session.sessionId, session);
      this.evictIfNeeded();
    });
  }

  async loadSession(
    sessionId: string,
    scope: SessionScope | null = null,
  ): Promise<AgentSession | null> {
    return this.getLock(sessionId).run(async () => {
      const session = this._sessions.get(sessionId);
      if (!session) {
        return null;
      }
      if (this._ttlSeconds != null) {
        const age = (Date.now() - Date.parse(session.updatedAt)) / 1000;
        if (age > this._ttlSeconds) {
          this._sessions.delete(sessionId);
          return null;
        }
      }
      if (!this.matches(session, scope)) {
        return null;
      }
      return session;
    });
  }

  async listSessions(options: {
    agent_id?: string | null;
    scope?: SessionScope | null;
    limit?: number;
    offset?: number;
  } = {}): Promise<AgentSession[]> {
    const { agent_id = null, scope = null, limit = 50, offset = 0 } = options;
    const results: AgentSession[] = [];
    for (const session of this._sessions.values()) {
      if (agent_id && session.agentId !== agent_id) {
        continue;
      }
      if (!this.matches(session, scope)) {
        continue;
      }
      results.push(session);
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
    for (const session of this._sessions.values()) {
      if (!session.sessionId.startsWith(sessionIdPrefix)) {
        continue;
      }
      if (excluded.has(session.sessionId)) {
        continue;
      }
      if (!this.matches(session, scope)) {
        continue;
      }
      results.push(session);
    }
    results.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return results;
  }

  async deleteSession(sessionId: string, scope: SessionScope | null = null): Promise<void> {
    await this.getLock(sessionId).run(async () => {
      const session = this._sessions.get(sessionId);
      if (!session) {
        return;
      }
      if (!this.matches(session, scope)) {
        return;
      }
      this._sessions.delete(sessionId);
    });
  }

  async appendTurn(
    sessionId: string,
    turn: TurnRecord,
    scope: SessionScope | null = null,
  ): Promise<void> {
    await this.getLock(sessionId).run(async () => {
      const session = this._sessions.get(sessionId);
      if (!session || !this.matches(session, scope)) {
        return;
      }
      session.turns.push(turn);
      session.updateTimestamp();
    });
  }

  async updateTcSummary(
    sessionId: string,
    tcId: string,
    summarizedResponse: string,
    summarizedByTurn: number,
    scope: SessionScope | null = null,
  ): Promise<void> {
    await this.getLock(sessionId).run(async () => {
      const session = this._sessions.get(sessionId);
      if (!session || !this.matches(session, scope)) {
        return;
      }
      for (const turn of session.turns) {
        for (const tc of turn.toolCalls) {
          if (tc.tcId === tcId) {
            tc.summarizedResponse = summarizedResponse;
            tc.summarizedByTurn = summarizedByTurn;
            session.updateTimestamp();
            return;
          }
        }
      }
    });
  }
}
