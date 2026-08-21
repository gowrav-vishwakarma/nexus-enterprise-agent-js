/** Base storage adapter interface for the Nexus Agent Framework. */

import type { AgentSession, TurnRecord } from "../models.js";
import type { SessionScope } from "../scope.js";

export interface StorageAdapter {
  saveSession(session: AgentSession): Promise<void>;
  loadSession(sessionId: string, scope?: SessionScope | null): Promise<AgentSession | null>;
  listSessions(options?: {
    agent_id?: string | null;
    scope?: SessionScope | null;
    limit?: number;
    offset?: number;
  }): Promise<AgentSession[]>;
  listSessionsByPrefix(
    sessionIdPrefix: string,
    options?: {
      scope?: SessionScope | null;
      exclude_session_ids?: Set<string> | null;
    },
  ): Promise<AgentSession[]>;
  deleteSession(sessionId: string, scope?: SessionScope | null): Promise<void>;
  appendTurn(
    sessionId: string,
    turn: TurnRecord,
    scope?: SessionScope | null,
  ): Promise<void>;
  updateTcSummary(
    sessionId: string,
    tcId: string,
    summarizedResponse: string,
    summarizedByTurn: number,
    scope?: SessionScope | null,
  ): Promise<void>;
}
