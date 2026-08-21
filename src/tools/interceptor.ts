/** Context update interceptor to extract RCS updates before tool execution. */

import type { RuntimeContextSummarizerConfig } from "../config/rcs.js";
import { NexusEventType } from "../events/models.js";
import {
  AgentSession,
  ContextUpdate,
  type ToolCallRecord,
} from "../session/models.js";

export interface EventEmitterLike {
  emit(event: unknown): Promise<void> | void;
}

export interface StorageAdapterLike {
  updateTcSummary?(
    sessionId: string,
    tcId: string,
    summarizedResponse: string,
    summarizedByTurn: number,
    scope?: ReturnType<AgentSession["toScope"]> | null,
  ): Promise<void>;
}

function countString(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

export class ContextUpdateInterceptor {
  constructor(private readonly eventEmitter: EventEmitterLike | null = null) {}

  async intercept(
    toolName: string,
    toolInput: Record<string, unknown>,
    session: AgentSession,
    currentTurnIndex: number,
    storageAdapter: StorageAdapterLike,
    rcsConfig: RuntimeContextSummarizerConfig,
  ): Promise<[Record<string, unknown>, ContextUpdate[]]> {
    void toolName;
    if (!rcsConfig?.enabled) {
      return [toolInput, []];
    }

    const cleaned = { ...toolInput };
    const paramName = rcsConfig.context_updates_param_name;
    const updatesRaw = cleaned[paramName];
    delete cleaned[paramName];

    if (!Array.isArray(updatesRaw) || updatesRaw.length === 0) {
      return [cleaned, []];
    }

    const appliedUpdates: ContextUpdate[] = [];

    for (const item of updatesRaw) {
      if (typeof item !== "object" || item == null) {
        continue;
      }
      const record = item as Record<string, unknown>;
      const tcId = String(record.tc_id ?? record.tcId ?? "").trim();
      const summary = String(record.summary ?? "").trim();

      if (!tcId || !summary || summary === "[]") {
        continue;
      }

      let targetTc: ToolCallRecord | undefined;
      for (const turn of session.turns) {
        for (const tc of turn.toolCalls) {
          if (tc.tcId === tcId) {
            targetTc = tc;
            break;
          }
        }
        if (targetTc) {
          break;
        }
      }

      if (!targetTc) {
        if (this.eventEmitter) {
          await this.eventEmitter.emit({
            eventType: NexusEventType.RCS_CROSS_SESSION_TC_REFERENCE,
            sessionId: session.sessionId,
            agentId: session.agentId,
            turnIndex: currentTurnIndex,
            data: { tcId, summary },
          });
        }
        continue;
      }

      targetTc.summarizedResponse = summary;
      targetTc.summarizedByTurn = currentTurnIndex;

      try {
        if (typeof storageAdapter.updateTcSummary === "function") {
          await storageAdapter.updateTcSummary(
            session.sessionId,
            tcId,
            summary,
            currentTurnIndex,
            session.toScope(),
          );
        }
      } catch (error) {
        console.error("Failed to write TC summary to storage:", error);
      }

      const oldTokens =
        targetTc.tokensSummarized != null ? targetTc.tokensSummarized : targetTc.tokensRaw;
      const newTokens = countString(summary);
      targetTc.tokensSummarized = newTokens;

      const saved = Math.max(0, oldTokens - newTokens);
      session.totalTokensSavedByRcs += saved;

      appliedUpdates.push(
        new ContextUpdate({
          tcId,
          summary,
          tokensSaved: saved,
        }),
      );

      if (this.eventEmitter) {
        await this.eventEmitter.emit({
          eventType: NexusEventType.RCS_TC_SUMMARIZED,
          sessionId: session.sessionId,
          agentId: session.agentId,
          turnIndex: currentTurnIndex,
          tcId,
          tokensRaw: targetTc.tokensRaw,
          tokensSummarized: newTokens,
          tokensSaved: saved,
        });
      }
    }

    return [cleaned, appliedUpdates];
  }
}
