export enum NexusEventType {
  AGENT_STARTED = "agent.started",
  AGENT_COMPLETED = "agent.completed",
  AGENT_ERROR = "agent.error",
  TURN_STARTED = "turn.started",
  TURN_COMPLETED = "turn.completed",
  TURN_ERROR = "turn.error",
  TOOL_CALL_STARTED = "tool_call.started",
  TOOL_CALL_COMPLETED = "tool_call.completed",
  TOOL_CALL_ERROR = "tool_call.error",
  RCS_TC_SUMMARIZED = "rcs.tc_summarized",
  RCS_CONTEXT_BUILT = "rcs.context_built",
  RCS_COMPACTOR_TRIGGERED = "rcs.compactor_triggered",
  RCS_COMPACTOR_COMPLETED = "rcs.compactor_completed",
  RCS_CROSS_SESSION_TC_REFERENCE = "rcs.cross_session_tc_reference",
  ENTITY_EXTRACTED = "memory.entity_extracted",
  CONTEXT_SUMMARIZED = "context.summarized",
  HUMAN_IN_LOOP_REQUESTED = "human_in_loop.requested",
  HUMAN_IN_LOOP_RESPONSE = "human_in_loop.response",
  LLM_CALL_STARTED = "llm.call_started",
  LLM_CALL_COMPLETED = "llm.call_completed",
  LLM_CALL_ERROR = "llm.call_error",
  LLM_STREAM_CHUNK = "llm.stream.chunk",
  SESSION_CREATED = "session.created",
  SESSION_LOADED = "session.loaded",
  SESSION_SAVED = "session.saved",
  AGENT_GROUP_STARTED = "agent_group.started",
  AGENT_GROUP_COMPLETED = "agent_group.completed",
  AGENT_HANDOFF = "agent.handoff",
  REALTIME_SESSION_STARTED = "realtime.session_started",
  REALTIME_SESSION_ENDED = "realtime.session_ended",
  REALTIME_TRANSCRIBED = "realtime.transcribed",
  REALTIME_BARGE_IN = "realtime.barge_in",
  REALTIME_RESPONSE_COMPLETED = "realtime.response_completed",
  REALTIME_ERROR = "realtime.error",
  REALTIME_RECONNECT = "realtime.reconnect",
}

export interface NexusEvent {
  eventId: string;
  eventType: NexusEventType;
  timestamp: string;
  sessionId?: string | null;
  agentId?: string | null;
  turnIndex?: number | null;
  data?: Record<string, unknown>;
}

export interface AgentStartedEvent extends NexusEvent {
  eventType: NexusEventType.AGENT_STARTED;
  agentName: string;
  userMessage?: string | null;
}

export interface AgentCompletedEvent extends NexusEvent {
  eventType: NexusEventType.AGENT_COMPLETED;
  turnsUsed: number;
  totalTokensIn?: number;
  totalTokensOut?: number;
  totalTokensSavedByRcs?: number;
  cumulativeTokensSavedByRcs?: number;
}

export interface AgentErrorEvent extends NexusEvent {
  eventType: NexusEventType.AGENT_ERROR;
  error: string;
  traceback?: string | null;
}

export interface TurnStartedEvent extends NexusEvent {
  eventType: NexusEventType.TURN_STARTED;
  turnIndex: number;
  userMessage?: string | null;
}

export interface TurnCompletedEvent extends NexusEvent {
  eventType: NexusEventType.TURN_COMPLETED;
  turnIndex: number;
  toolCallsCount?: number;
  tokensIn?: number;
  tokensOut?: number;
  tokensSaved?: number;
  recurringSavings?: number;
  durationMs?: number;
}

export interface ToolCallStartedEvent extends NexusEvent {
  eventType: NexusEventType.TOOL_CALL_STARTED;
  toolName: string;
  toolArgs?: Record<string, unknown> | null;
}

export interface ToolCallCompletedEvent extends NexusEvent {
  eventType: NexusEventType.TOOL_CALL_COMPLETED;
  toolName: string;
  toolOutputLength?: number;
  durationMs?: number;
}

export interface ToolCallErrorEvent extends NexusEvent {
  eventType: NexusEventType.TOOL_CALL_ERROR;
  toolName: string;
  error: string;
}

export interface RCSContextBuiltEvent extends NexusEvent {
  eventType: NexusEventType.RCS_CONTEXT_BUILT;
  contextTokens?: number;
  untrimmedTokens?: number;
  turnsInContext?: number;
  tcTagsCount?: number;
  tcSummarizedCount?: number;
  toolsDegradedCount?: number;
  turnsDropped?: number;
}

export interface RCSTCSummarizedEvent extends NexusEvent {
  eventType: NexusEventType.RCS_TC_SUMMARIZED;
  tcId: string;
  tokensRaw?: number;
  tokensSummarized?: number;
  tokensSaved?: number;
}

export interface RCSCompactorCompletedEvent extends NexusEvent {
  eventType: NexusEventType.RCS_COMPACTOR_COMPLETED;
  tcsCompacted?: string[];
  tokensSaved?: number;
}

export interface HumanInLoopRequestedEvent extends NexusEvent {
  eventType: NexusEventType.HUMAN_IN_LOOP_REQUESTED;
  kind: string;
  toolName?: string | null;
  tcId?: string | null;
  reason?: string;
}

export interface HumanInLoopResponseEvent extends NexusEvent {
  eventType: NexusEventType.HUMAN_IN_LOOP_RESPONSE;
  tcId?: string | null;
  kind?: string;
}

export interface LLMCallStartedEvent extends NexusEvent {
  eventType: NexusEventType.LLM_CALL_STARTED;
  provider: string;
  model: string;
  messagesCount?: number;
}

export interface LLMCallCompletedEvent extends NexusEvent {
  eventType: NexusEventType.LLM_CALL_COMPLETED;
  provider: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
}

export interface LLMCallErrorEvent extends NexusEvent {
  eventType: NexusEventType.LLM_CALL_ERROR;
  provider: string;
  error: string;
}

export interface LLMStreamChunkEvent extends NexusEvent {
  eventType: NexusEventType.LLM_STREAM_CHUNK;
  provider: string;
  model: string;
  turnIndex: number;
  contentDelta?: string | null;
  reasoningDelta?: string | null;
  hasToolCallDelta?: boolean;
}

export class EventEmitted implements NexusEvent {
  eventId: string;
  eventType: NexusEventType;
  timestamp: string;
  sessionId?: string | null;
  agentId?: string | null;
  turnIndex?: number | null;
  data: Record<string, unknown>;

  constructor(eventType: NexusEventType, data: Record<string, unknown> = {}) {
    this.eventId = crypto.randomUUID();
    this.eventType = eventType;
    this.timestamp = new Date().toISOString();
    this.data = data;
  }
}

export const ALL_EVENT_TYPES = Object.values(NexusEventType);

export function createBaseEvent(
  eventType: NexusEventType,
  partial: Partial<NexusEvent> = {},
): NexusEvent {
  return {
    eventId: partial.eventId ?? crypto.randomUUID(),
    eventType,
    timestamp: partial.timestamp ?? new Date().toISOString(),
    sessionId: partial.sessionId ?? null,
    agentId: partial.agentId ?? null,
    turnIndex: partial.turnIndex ?? null,
    data: partial.data ?? {},
  };
}

export function eventToDict(event: NexusEvent): Record<string, unknown> {
  return { ...event };
}
