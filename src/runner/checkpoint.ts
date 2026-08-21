import type { AgentSession } from "../session/models.js";
import { pendingInteractionFromJson } from "../session/models.js";

export interface RunCheckpoint {
  sessionId: string;
  turnIndex: number;
  pendingToolCalls: Array<Record<string, unknown>>;
  pendingInteractions: Array<Record<string, unknown>>;
  state: Record<string, unknown>;
  streamSeq: number;
}

export function checkpointFromSession(
  session: AgentSession,
  options: { turnIndex: number; streamSeq?: number } = { turnIndex: 0 },
): RunCheckpoint {
  return {
    sessionId: session.sessionId,
    turnIndex: options.turnIndex,
    pendingInteractions: session.pendingInteractions.map((p) => ({
      tc_id: p.tcId,
      call_id: p.callId,
      tool_name: p.toolName,
      args: p.args,
      kind: p.kind,
      created_at: p.createdAt,
    })),
    pendingToolCalls: [],
    state: { ...(session.state ?? {}) },
    streamSeq: options.streamSeq ?? session.streamSeq ?? 0,
  };
}

export function applyCheckpoint(session: AgentSession, checkpoint: RunCheckpoint): void {
  session.state = { ...checkpoint.state };
  session.pendingInteractions = checkpoint.pendingInteractions.map((raw) =>
    pendingInteractionFromJson(raw),
  );
  session.streamSeq = checkpoint.streamSeq;
}
