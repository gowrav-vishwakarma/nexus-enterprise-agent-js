/** Session data models for the Nexus Agent Framework. */

import { randomUUID } from "node:crypto";
import { SessionScope } from "./scope.js";

export type TurnStatus =
  | "completed"
  | "error"
  | "interrupted"
  | "max_turns_reached"
  | "paused"
  | "security_block";

export const CURRENT_SESSION_SCHEMA_VERSION = 1;

function pick<T>(
  obj: Record<string, unknown> | undefined,
  camel: string,
  snake: string,
  fallback: T,
): T {
  if (!obj) {
    return fallback;
  }
  if (obj[camel] !== undefined) {
    return obj[camel] as T;
  }
  if (obj[snake] !== undefined) {
    return obj[snake] as T;
  }
  return fallback;
}

export function asIso(value: unknown, fallback?: string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value) {
    return value;
  }
  return fallback ?? new Date().toISOString();
}

export class ContextUpdate {
  tcId: string;
  summary: string;
  tokensSaved: number;

  constructor(init: {
    tcId?: string;
    tc_id?: string;
    summary: string;
    tokensSaved?: number;
    tokens_saved?: number;
  }) {
    this.tcId = init.tcId ?? init.tc_id ?? "";
    this.summary = init.summary;
    this.tokensSaved = init.tokensSaved ?? init.tokens_saved ?? 0;
  }

  toJSON(): Record<string, unknown> {
    return {
      tc_id: this.tcId,
      summary: this.summary,
      tokens_saved: this.tokensSaved,
    };
  }
}

export class PendingInteraction {
  tcId: string;
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  kind: "client_tool" | "elicitation";
  createdAt: string;

  constructor(init: {
    tcId?: string;
    tc_id?: string;
    callId?: string;
    call_id?: string;
    toolName?: string;
    tool_name?: string;
    args?: Record<string, unknown>;
    kind?: "client_tool" | "elicitation";
    createdAt?: string | Date;
    created_at?: string | Date;
  }) {
    this.tcId = init.tcId ?? init.tc_id ?? "";
    this.callId = init.callId ?? init.call_id ?? "";
    this.toolName = init.toolName ?? init.tool_name ?? "";
    this.args = init.args ?? {};
    this.kind = init.kind ?? "client_tool";
    this.createdAt = asIso(init.createdAt ?? init.created_at);
  }

  toJSON(): Record<string, unknown> {
    return {
      tc_id: this.tcId,
      call_id: this.callId,
      tool_name: this.toolName,
      args: this.args,
      kind: this.kind,
      created_at: this.createdAt,
    };
  }
}

export class ToolCallRecord {
  tcId: string;
  tcIndex: number;
  toolName: string;
  toolPlugin: string;
  callId: string;
  toolInput: Record<string, unknown>;
  rawResponse: string;
  summarizedResponse: string | null;
  summarizedByTurn: number | null;
  tokensRaw: number;
  tokensSummarized: number | null;
  timestamp: string;

  constructor(init: {
    tcIndex?: number;
    tc_index?: number;
    toolName?: string;
    tool_name?: string;
    rawResponse?: string;
    raw_response?: string;
    tcId?: string;
    tc_id?: string;
    toolPlugin?: string;
    tool_plugin?: string;
    callId?: string;
    call_id?: string;
    toolInput?: Record<string, unknown>;
    tool_input?: Record<string, unknown>;
    summarizedResponse?: string | null;
    summarized_response?: string | null;
    summarizedByTurn?: number | null;
    summarized_by_turn?: number | null;
    tokensRaw?: number;
    tokens_raw?: number;
    tokensSummarized?: number | null;
    tokens_summarized?: number | null;
    timestamp?: string | Date;
  }) {
    this.tcId = init.tcId ?? init.tc_id ?? randomUUID();
    this.tcIndex = init.tcIndex ?? init.tc_index ?? 0;
    this.toolName = init.toolName ?? init.tool_name ?? "";
    this.toolPlugin = init.toolPlugin ?? init.tool_plugin ?? "";
    this.callId = init.callId ?? init.call_id ?? "";
    this.toolInput = init.toolInput ?? init.tool_input ?? {};
    this.rawResponse = init.rawResponse ?? init.raw_response ?? "";
    this.summarizedResponse = init.summarizedResponse ?? init.summarized_response ?? null;
    this.summarizedByTurn = init.summarizedByTurn ?? init.summarized_by_turn ?? null;
    this.tokensRaw = init.tokensRaw ?? init.tokens_raw ?? 0;
    this.tokensSummarized = init.tokensSummarized ?? init.tokens_summarized ?? null;
    this.timestamp = asIso(init.timestamp);
  }

  toJSON(): Record<string, unknown> {
    return {
      tc_id: this.tcId,
      tc_index: this.tcIndex,
      tool_name: this.toolName,
      tool_plugin: this.toolPlugin,
      call_id: this.callId,
      tool_input: this.toolInput,
      raw_response: this.rawResponse,
      summarized_response: this.summarizedResponse,
      summarized_by_turn: this.summarizedByTurn,
      tokens_raw: this.tokensRaw,
      tokens_summarized: this.tokensSummarized,
      timestamp: this.timestamp,
    };
  }
}

export class TurnRecord {
  turnIndex: number;
  userMessage: string | null;
  llmMessages: Array<Record<string, unknown>>;
  reasoning: string | null;
  toolCalls: ToolCallRecord[];
  contextUpdatesReceived: Array<Record<string, unknown>>;
  totalTokensIn: number;
  totalTokensOut: number;
  tokensSavedThisTurn: number;
  recurringSavingsThisTurn: number;
  mediaMetadata: Record<string, unknown>;
  durationMs: number;
  timestamp: string;
  status: TurnStatus;
  error: string | null;

  constructor(init: {
    turnIndex?: number;
    turn_index?: number;
    userMessage?: string | null;
    user_message?: string | null;
    llmMessages?: Array<Record<string, unknown>>;
    llm_messages?: Array<Record<string, unknown>>;
    reasoning?: string | null;
    toolCalls?: ToolCallRecord[];
    tool_calls?: ToolCallRecord[];
    contextUpdatesReceived?: Array<Record<string, unknown>>;
    context_updates_received?: Array<Record<string, unknown>>;
    totalTokensIn?: number;
    total_tokens_in?: number;
    totalTokensOut?: number;
    total_tokens_out?: number;
    tokensSavedThisTurn?: number;
    tokens_saved_this_turn?: number;
    recurringSavingsThisTurn?: number;
    recurring_savings_this_turn?: number;
    mediaMetadata?: Record<string, unknown>;
    media_metadata?: Record<string, unknown>;
    durationMs?: number;
    duration_ms?: number;
    timestamp?: string | Date;
    status?: TurnStatus;
    error?: string | null;
  }) {
    this.turnIndex = init.turnIndex ?? init.turn_index ?? 0;
    this.userMessage = init.userMessage ?? init.user_message ?? null;
    this.llmMessages = init.llmMessages ?? init.llm_messages ?? [];
    this.reasoning = init.reasoning ?? null;
    this.toolCalls = (init.toolCalls ?? init.tool_calls ?? []).map((tc) =>
      tc instanceof ToolCallRecord ? tc : new ToolCallRecord(tc),
    );
    this.contextUpdatesReceived =
      init.contextUpdatesReceived ?? init.context_updates_received ?? [];
    this.totalTokensIn = init.totalTokensIn ?? init.total_tokens_in ?? 0;
    this.totalTokensOut = init.totalTokensOut ?? init.total_tokens_out ?? 0;
    this.tokensSavedThisTurn = init.tokensSavedThisTurn ?? init.tokens_saved_this_turn ?? 0;
    this.recurringSavingsThisTurn =
      init.recurringSavingsThisTurn ?? init.recurring_savings_this_turn ?? 0;
    this.mediaMetadata = init.mediaMetadata ?? init.media_metadata ?? {};
    this.durationMs = init.durationMs ?? init.duration_ms ?? 0;
    this.timestamp = asIso(init.timestamp);
    this.status = init.status ?? "completed";
    this.error = init.error ?? null;
  }

  toJSON(): Record<string, unknown> {
    return {
      turn_index: this.turnIndex,
      user_message: this.userMessage,
      llm_messages: this.llmMessages,
      reasoning: this.reasoning,
      tool_calls: this.toolCalls.map((tc) => tc.toJSON()),
      context_updates_received: this.contextUpdatesReceived,
      total_tokens_in: this.totalTokensIn,
      total_tokens_out: this.totalTokensOut,
      tokens_saved_this_turn: this.tokensSavedThisTurn,
      recurring_savings_this_turn: this.recurringSavingsThisTurn,
      media_metadata: this.mediaMetadata,
      duration_ms: this.durationMs,
      timestamp: this.timestamp,
      status: this.status,
      error: this.error,
    };
  }
}

export class AgentSession {
  sessionId: string;
  agentId: string;
  tenantId: string | null;
  companyId: string | null;
  userId: string | null;
  userName: string | null;
  title: string;
  pinned: boolean;
  attachmentIds: string[];
  pendingInteractions: PendingInteraction[];
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  turns: TurnRecord[];
  tcCounter: number;
  metadata: Record<string, unknown>;
  summaryText: string;
  summaryThroughTurn: number;
  isActive: boolean;
  totalTokensSavedByRcs: number;
  cumulativeInputTokensSavedByRcs: number;
  rcsEnabled: boolean;
  streamSeq: number;

  constructor(init: {
    sessionId?: string;
    session_id?: string;
    agentId?: string;
    agent_id?: string;
    tenantId?: string | null;
    tenant_id?: string | null;
    companyId?: string | null;
    company_id?: string | null;
    userId?: string | null;
    user_id?: string | null;
    userName?: string | null;
    user_name?: string | null;
    title?: string;
    pinned?: boolean;
    attachmentIds?: string[];
    attachment_ids?: string[];
    pendingInteractions?: PendingInteraction[];
    pending_interactions?: PendingInteraction[];
    state?: Record<string, unknown>;
    createdAt?: string | Date;
    created_at?: string | Date;
    updatedAt?: string | Date;
    updated_at?: string | Date;
    turns?: TurnRecord[];
    tcCounter?: number;
    tc_counter?: number;
    metadata?: Record<string, unknown>;
    summaryText?: string;
    summary_text?: string;
    summaryThroughTurn?: number;
    summary_through_turn?: number;
    isActive?: boolean;
    is_active?: boolean;
    totalTokensSavedByRcs?: number;
    total_tokens_saved_by_rcs?: number;
    cumulativeInputTokensSavedByRcs?: number;
    cumulative_input_tokens_saved_by_rcs?: number;
    rcsEnabled?: boolean;
    rcs_enabled?: boolean;
    streamSeq?: number;
    stream_seq?: number;
  }) {
    this.sessionId = init.sessionId ?? init.session_id ?? "";
    this.agentId = init.agentId ?? init.agent_id ?? "";
    this.tenantId = init.tenantId ?? init.tenant_id ?? null;
    this.companyId = init.companyId ?? init.company_id ?? null;
    this.userId = init.userId ?? init.user_id ?? null;
    this.userName = init.userName ?? init.user_name ?? null;
    this.title = init.title ?? "";
    this.pinned = init.pinned ?? false;
    this.attachmentIds = init.attachmentIds ?? init.attachment_ids ?? [];
    this.pendingInteractions = (init.pendingInteractions ?? init.pending_interactions ?? []).map(
      (item) => (item instanceof PendingInteraction ? item : new PendingInteraction(item)),
    );
    this.state = init.state ?? {};
    this.createdAt = asIso(init.createdAt ?? init.created_at);
    this.updatedAt = asIso(init.updatedAt ?? init.updated_at);
    this.turns = (init.turns ?? []).map((turn) =>
      turn instanceof TurnRecord ? turn : new TurnRecord(turn),
    );
    this.tcCounter = init.tcCounter ?? init.tc_counter ?? 0;
    this.metadata = init.metadata ?? {};
    this.summaryText = init.summaryText ?? init.summary_text ?? "";
    this.summaryThroughTurn = init.summaryThroughTurn ?? init.summary_through_turn ?? -1;
    this.isActive = init.isActive ?? init.is_active ?? true;
    this.totalTokensSavedByRcs =
      init.totalTokensSavedByRcs ?? init.total_tokens_saved_by_rcs ?? 0;
    this.cumulativeInputTokensSavedByRcs =
      init.cumulativeInputTokensSavedByRcs ?? init.cumulative_input_tokens_saved_by_rcs ?? 0;
    this.rcsEnabled = init.rcsEnabled ?? init.rcs_enabled ?? false;
    this.streamSeq = init.streamSeq ?? init.stream_seq ?? 0;
  }

  get tokenUsage(): Record<string, unknown> {
    return {
      total_tokens_in: this.turns.reduce((sum, turn) => sum + turn.totalTokensIn, 0),
      total_tokens_out: this.turns.reduce((sum, turn) => sum + turn.totalTokensOut, 0),
      total_tokens_saved_by_rcs: this.totalTokensSavedByRcs,
      cumulative_input_tokens_saved_by_rcs: this.cumulativeInputTokensSavedByRcs,
      rcs_enabled: this.rcsEnabled,
    };
  }

  get token_usage(): Record<string, unknown> {
    return this.tokenUsage;
  }

  get turnCount(): number {
    return this.turns.length;
  }

  get turn_count(): number {
    return this.turnCount;
  }

  nextTcIndex(): number {
    const idx = this.tcCounter;
    this.tcCounter += 1;
    return idx;
  }

  updateTimestamp(): void {
    this.updatedAt = new Date().toISOString();
  }

  findTc(tcId: string): ToolCallRecord | undefined {
    for (const turn of this.turns) {
      for (const tc of turn.toolCalls) {
        if (tc.tcId === tcId) {
          return tc;
        }
      }
    }
    return undefined;
  }

  toScope(): SessionScope {
    return new SessionScope({
      tenantId: this.tenantId,
      companyId: this.companyId,
      userId: this.userId,
    });
  }

  toJSON(): Record<string, unknown> {
    return {
      session_id: this.sessionId,
      agent_id: this.agentId,
      tenant_id: this.tenantId,
      company_id: this.companyId,
      user_id: this.userId,
      user_name: this.userName,
      title: this.title,
      pinned: this.pinned,
      attachment_ids: this.attachmentIds,
      pending_interactions: this.pendingInteractions.map((item) => item.toJSON()),
      state: this.state,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
      turns: this.turns.map((turn) => turn.toJSON()),
      tc_counter: this.tcCounter,
      metadata: this.metadata,
      summary_text: this.summaryText,
      summary_through_turn: this.summaryThroughTurn,
      is_active: this.isActive,
      total_tokens_saved_by_rcs: this.totalTokensSavedByRcs,
      cumulative_input_tokens_saved_by_rcs: this.cumulativeInputTokensSavedByRcs,
      rcs_enabled: this.rcsEnabled,
      stream_seq: this.streamSeq,
      token_usage: this.tokenUsage,
    };
  }

  static fromJSON(data: Record<string, unknown>): AgentSession {
    const migrated = migrateSessionData({ ...data });
    return hydrateAgentSession(migrated);
  }
}

export function migrateSessionData(data: Record<string, unknown>): Record<string, unknown> {
  const version = Number(data.schema_version ?? 0);
  if (version < 1) {
    if (!("state" in data)) {
      data.state = {};
    }
    data.schema_version = 1;
  }
  return data;
}

function hydrateAgentSession(data: Record<string, unknown>): AgentSession {
  return new AgentSession({
    sessionId: String(pick(data, "sessionId", "session_id", "")),
    agentId: String(pick(data, "agentId", "agent_id", "")),
    tenantId: (pick(data, "tenantId", "tenant_id", null) as string | null) ?? null,
    companyId: (pick(data, "companyId", "company_id", null) as string | null) ?? null,
    userId: (pick(data, "userId", "user_id", null) as string | null) ?? null,
    userName: (pick(data, "userName", "user_name", null) as string | null) ?? null,
    title: String(data.title ?? ""),
    pinned: Boolean(data.pinned),
    attachmentIds: (pick(data, "attachmentIds", "attachment_ids", []) as string[]) ?? [],
    pendingInteractions: (
      (pick(data, "pendingInteractions", "pending_interactions", []) as Array<
        Record<string, unknown>
      >) ?? []
    ).map((item) => pendingInteractionFromJson(item)),
    state: (data.state as Record<string, unknown> | undefined) ?? {},
    createdAt: asIso(pick(data, "createdAt", "created_at", undefined)),
    updatedAt: asIso(pick(data, "updatedAt", "updated_at", undefined)),
    turns: ((pick(data, "turns", "turns", []) as Array<Record<string, unknown>>) ?? []).map(
      hydrateTurn,
    ),
    tcCounter: Number(pick(data, "tcCounter", "tc_counter", 0)),
    metadata: (data.metadata as Record<string, unknown> | undefined) ?? {},
    summaryText: String(pick(data, "summaryText", "summary_text", "")),
    summaryThroughTurn: Number(pick(data, "summaryThroughTurn", "summary_through_turn", -1)),
    isActive: Boolean(pick(data, "isActive", "is_active", true)),
    totalTokensSavedByRcs: Number(
      pick(data, "totalTokensSavedByRcs", "total_tokens_saved_by_rcs", 0),
    ),
    cumulativeInputTokensSavedByRcs: Number(
      pick(data, "cumulativeInputTokensSavedByRcs", "cumulative_input_tokens_saved_by_rcs", 0),
    ),
    rcsEnabled: Boolean(pick(data, "rcsEnabled", "rcs_enabled", false)),
    streamSeq: Number(pick(data, "streamSeq", "stream_seq", 0)),
  });
}

function hydrateTurn(data: Record<string, unknown>): TurnRecord {
  return new TurnRecord({
    turnIndex: Number(pick(data, "turnIndex", "turn_index", 0)),
    userMessage: (pick(data, "userMessage", "user_message", null) as string | null) ?? null,
    llmMessages:
      (pick(data, "llmMessages", "llm_messages", []) as Array<Record<string, unknown>>) ?? [],
    reasoning: (data.reasoning as string | null | undefined) ?? null,
    toolCalls: (
      (pick(data, "toolCalls", "tool_calls", []) as Array<Record<string, unknown>>) ?? []
    ).map((item) => new ToolCallRecord(item)),
    contextUpdatesReceived:
      (pick(data, "contextUpdatesReceived", "context_updates_received", []) as Array<
        Record<string, unknown>
      >) ?? [],
    totalTokensIn: Number(pick(data, "totalTokensIn", "total_tokens_in", 0)),
    totalTokensOut: Number(pick(data, "totalTokensOut", "total_tokens_out", 0)),
    tokensSavedThisTurn: Number(pick(data, "tokensSavedThisTurn", "tokens_saved_this_turn", 0)),
    recurringSavingsThisTurn: Number(
      pick(data, "recurringSavingsThisTurn", "recurring_savings_this_turn", 0),
    ),
    mediaMetadata:
      (pick(data, "mediaMetadata", "media_metadata", {}) as Record<string, unknown>) ?? {},
    durationMs: Number(pick(data, "durationMs", "duration_ms", 0)),
    timestamp: asIso(data.timestamp),
    status: (data.status as TurnStatus | undefined) ?? "completed",
    error: (data.error as string | null | undefined) ?? null,
  });
}

export function createAgentSession(
  init: ConstructorParameters<typeof AgentSession>[0],
): AgentSession {
  return new AgentSession(init);
}

export function createPendingInteraction(
  init: ConstructorParameters<typeof PendingInteraction>[0],
): PendingInteraction {
  return new PendingInteraction(init);
}

export function createToolCallRecord(
  init: ConstructorParameters<typeof ToolCallRecord>[0],
): ToolCallRecord {
  return new ToolCallRecord(init);
}

export function createTurnRecord(init: ConstructorParameters<typeof TurnRecord>[0]): TurnRecord {
  return new TurnRecord(init);
}

export function pendingInteractionFromJson(raw: Record<string, unknown>): PendingInteraction {
  return new PendingInteraction(raw);
}

export function pendingInteractionToJson(item: PendingInteraction): Record<string, unknown> {
  return item.toJSON();
}

export function nextTcIndex(session: AgentSession): number {
  return session.nextTcIndex();
}

export function updateSessionTimestamp(session: AgentSession): void {
  session.updateTimestamp();
}

export function findTc(session: AgentSession, tcId: string): ToolCallRecord | undefined {
  return session.findTc(tcId);
}
