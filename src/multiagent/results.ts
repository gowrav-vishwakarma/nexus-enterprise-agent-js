/** Data models for multi-agent execution results. */

import type { AgentRunResult } from "../runner/result.js";

export type AgentGroupStatus = "completed" | "failed" | "interrupted";

export interface AgentGroupResult {
  sessionId: string;
  groupName: string;
  finalResponse?: string | null;
  memberResults: Record<string, AgentRunResult | AgentGroupResult | unknown>;
  turnsUsed: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalTokensSavedByRcs: number;
  cumulativeInputTokensSavedByRcs: number;
  durationMs: number;
  status: AgentGroupStatus;
  error?: string | null;
}

export function createAgentGroupResult(
  init: Partial<AgentGroupResult> & {
    sessionId: string;
    groupName: string;
    status?: AgentGroupStatus;
  },
): AgentGroupResult {
  return {
    finalResponse: null,
    memberResults: {},
    turnsUsed: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalTokensSavedByRcs: 0,
    cumulativeInputTokensSavedByRcs: 0,
    durationMs: 0,
    error: null,
    status: "completed",
    ...init,
  };
}

export function agentGroupResultToDict(result: AgentGroupResult): Record<string, unknown> {
  return { ...result };
}

export function agentGroupResultToJSON(result: AgentGroupResult): Record<string, unknown> {
  return agentGroupResultToDict(result);
}
