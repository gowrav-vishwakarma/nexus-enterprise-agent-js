export type AgentRunStatus =
  | "completed"
  | "max_turns_reached"
  | "error"
  | "interrupted"
  | "paused";

export interface AgentRunResult {
  sessionId: string;
  finalResponse?: string | null;
  structuredResult?: Record<string, unknown> | null;
  turnsUsed: number;
  totalTokensIn?: number;
  totalTokensOut?: number;
  totalTokensSavedByRcs?: number;
  cumulativeInputTokensSavedByRcs?: number;
  durationMs?: number;
  status: AgentRunStatus;
  error?: string | null;
  pendingInteractions?: Array<Record<string, unknown>>;
  state?: Record<string, unknown>;
}

export type AgentStreamEventType =
  | "content"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "client_tool_call"
  | "elicitation"
  | "paused"
  | "event"
  | "final_response"
  | "error";

export interface AgentStreamEvent {
  eventType: AgentStreamEventType;
  content?: string | null;
  data?: Record<string, unknown> | null;
}

export function createAgentStreamEvent(
  eventType: AgentStreamEventType,
  partial: Partial<AgentStreamEvent> = {},
): AgentStreamEvent {
  return {
    eventType,
    content: partial.content ?? null,
    data: partial.data ?? {},
  };
}
